"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, managerKey, sameText, sessionToken } from "@/lib/auth";
import { db, unwrap } from "@/lib/db";
import * as q from "@/lib/action-queue";
import { kindOf } from "@/lib/action-registry";
import { getSettings } from "@/lib/queries";
import type { Action } from "@/lib/types";

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const refresh = () => revalidatePath("/", "layout");

// ---------- auth ----------
/** Every server action can be called straight over the network, so each one checks the login itself
 *  (the cookie, or the key header the phone bot and the assistant's bridge use), not just the middleware. */
async function requireAuth() {
  if (sameText((await cookies()).get(COOKIE)?.value, await sessionToken())) return;
  if (sameText((await headers()).get("x-manager-key"), await managerKey())) return;
  throw new Error("Not signed in");
}

// Slows down password guessing: after 5 wrong tries, wait 15 minutes.
const tries: number[] = [];
export async function login(form: FormData) {
  const now = Date.now();
  while (tries.length && now - tries[0] > 15 * 60_000) tries.shift();
  if (tries.length >= 5) redirect("/login?error=wait");
  const pw = str(form, "password");
  if (!pw || !sameText(pw, process.env.APP_PASSWORD ?? "")) { tries.push(now); redirect("/login?error=1"); }
  (await cookies()).set(COOKIE, await sessionToken(), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90,
  });
  // Only go back to a page on this site, never to another website.
  const next = str(form, "next") ?? "/";
  redirect(next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/");
}
export async function logout() {
  (await cookies()).delete(COOKIE);
  redirect("/login");
}

// ---------- projects ----------
async function touch(projectId: string | null) {
  if (projectId) await db().from("projects").update({ last_touched_at: new Date().toISOString() }).eq("id", projectId);
}

export async function saveProject(form: FormData) {
  await requireAuth();
  const id = str(form, "id");
  const status = str(form, "status") ?? "active";
  const prev = id ? (await db().from("projects").select("status").eq("id", id).maybeSingle()).data : null;
  if (status === "active" && prev?.status !== "active") {
    const s = await getSettings();
    const { count } = await db().from("projects").select("id", { count: "exact", head: true })
      .eq("status", "active").neq("id", id ?? "00000000-0000-0000-0000-000000000000");
    if ((count ?? 0) >= s.max_active_projects && str(form, "force") !== "1") {
      // Soft cap: keeps you from spreading thin. Pause something first, or force it.
      redirect(`/projects/${id ?? "new"}?cap=1`);
    }
  }
  const row = {
    name: str(form, "name") ?? "Untitled",
    status,
    priority: Number(str(form, "priority") ?? 3),
    next_action: str(form, "next_action"),
    goal: str(form, "goal"),
    notes: str(form, "notes"),
    github_repo: str(form, "github_repo"),
    vercel_project: str(form, "vercel_project"),
    deadline: str(form, "deadline"),
    last_touched_at: new Date().toISOString(),
  };
  if (id) unwrap(await db().from("projects").update(row).eq("id", id).select());
  else {
    const [p] = unwrap(await db().from("projects").insert(row).select());
    refresh();
    redirect(`/projects/${p.id}`);
  }
  refresh();
}

export async function setProjectStatus(id: string, status: string) {
  await requireAuth();
  unwrap(await db().from("projects").update({ status }).eq("id", id).select());
  refresh();
}

// ---------- tasks ----------
export async function addTask(form: FormData) {
  await requireAuth();
  const title = str(form, "title");
  if (!title) return;
  const project_id = str(form, "project_id");
  unwrap(await db().from("tasks").insert({
    title, project_id, due: str(form, "due"), priority: Number(str(form, "priority") ?? 3),
  }).select());
  await touch(project_id);
  refresh();
}
export async function setTaskStatus(id: string, status: "todo" | "doing" | "done") {
  await requireAuth();
  const [t] = unwrap(await db().from("tasks").update({
    status, done_at: status === "done" ? new Date().toISOString() : null,
  }).eq("id", id).select());
  await touch(t?.project_id ?? null);
  refresh();
}
export async function deleteTask(id: string) {
  await requireAuth();
  await db().from("tasks").delete().eq("id", id);
  refresh();
}

// ---------- ideas ----------
export async function addIdea(form: FormData) {
  await requireAuth();
  const text = str(form, "text");
  if (!text) return;
  unwrap(await db().from("ideas").insert({ text }).select());
  refresh();
}
export async function triageIdea(id: string, decision: "promote" | "park" | "kill") {
  await requireAuth();
  const now = new Date().toISOString();
  if (decision === "promote") {
    const { data: idea } = await db().from("ideas").select("*").eq("id", id).single();
    const [p] = unwrap(await db().from("projects").insert({
      name: idea.text.slice(0, 80), status: "idea", priority: 3, notes: idea.text,
    }).select());
    await db().from("ideas").update({ status: "promoted", project_id: p.id, triaged_at: now }).eq("id", id);
  } else {
    await db().from("ideas").update({ status: decision === "park" ? "parked" : "killed", triaged_at: now }).eq("id", id);
  }
  refresh();
}

// ---------- quick capture ----------
// "idea: ..." -> idea inbox, "#Project ..." -> task on that project, otherwise everyday task.
export async function quickCapture(form: FormData) {
  await requireAuth();
  const raw = str(form, "text");
  if (!raw) return;
  if (/^idea[:\s]/i.test(raw)) {
    unwrap(await db().from("ideas").insert({ text: raw.replace(/^idea[:\s]+/i, "") }).select());
  } else {
    let project_id: string | null = null;
    let title = raw;
    const m = raw.match(/^#(\S+)\s+(.*)$/);
    if (m) {
      const { data: projects } = await db().from("projects").select("id,name");
      const key = m[1].toLowerCase();
      const hit = projects?.find((p) => p.name.toLowerCase().replace(/\s+/g, "").startsWith(key));
      if (hit) { project_id = hit.id; title = m[2]; }
    }
    unwrap(await db().from("tasks").insert({ title, project_id }).select());
    await touch(project_id);
  }
  refresh();
}

// ---------- focus ----------
export async function startFocus(form: FormData) {
  await requireAuth();
  await db().from("focus_sessions").update({ ended_at: new Date().toISOString(), outcome: "switched" }).is("ended_at", null);
  const project_id = str(form, "project_id");
  unwrap(await db().from("focus_sessions").insert({
    project_id, task_id: str(form, "task_id"), planned_minutes: Number(str(form, "minutes") ?? 50),
  }).select());
  await touch(project_id);
  refresh();
}
export async function endFocus(form: FormData) {
  await requireAuth();
  await db().from("focus_sessions").update({
    ended_at: new Date().toISOString(), outcome: str(form, "outcome") ?? "done",
  }).is("ended_at", null);
  refresh();
}

// ---------- approval queue (the work is in lib/action-queue.ts) ----------
export async function queueAction(input: Parameters<typeof q.queueAction>[0]): Promise<Action> {
  await requireAuth();
  return q.queueAction(input);
}
export async function decideAction(id: string, approve: boolean) {
  await requireAuth();
  return q.decideAction(id, approve);
}

export async function markActionDone(id: string, form: FormData) {
  await requireAuth();
  const { data: a } = await db().from("actions").select("kind,payload,status").eq("id", id).maybeSingle();
  if (a?.status === "approved") await q.syncCampaign(a, "done");
  await db().from("actions").update({
    status: "executed", executed_at: new Date().toISOString(), result: { note: str(form, "note") },
  }).eq("id", id).eq("status", "approved");
  refresh();
}

export async function requestAction(form: FormData) {
  await requireAuth();
  const dollars = Number(str(form, "cost") ?? 0);
  const kind = str(form, "kind") ?? "other";
  const payload: Record<string, unknown> = {};
  for (const k of ["repo", "project", "url", "body"]) if (str(form, k)) payload[k] = str(form, k);
  if (kind === "github.create_issue") payload.title = str(form, "title");
  await queueAction({
    kind, title: str(form, "title") ?? kindOf(kind).label, reason: str(form, "reason") ?? undefined,
    payload, cost_cents: Math.round(dollars * 100), project_id: str(form, "project_id"),
  });
}

export async function saveSettings(form: FormData) {
  await requireAuth();
  const n = (k: string, d: number) => Number(str(form, k) ?? d);
  await db().from("settings").update({
    max_active_projects: n("max_active_projects", 3),
    per_purchase_cap_cents: Math.round(n("per_purchase_cap", 50) * 100),
    monthly_cap_cents: Math.round(n("monthly_cap", 200) * 100),
    focus_minutes: n("focus_minutes", 50),
    trust_after: Math.max(0, n("trust_after", 3)),
  }).eq("id", 1);
  refresh();
}

export async function unpairPhone() {
  await requireAuth();
  await db().from("settings").update({ telegram_chat_id: null }).eq("id", 1);
  refresh();
}

export async function saveAssistant(form: FormData) {
  await requireAuth();
  const time = (k: string, d: string) => (/^\d{2}:\d{2}$/.test(str(form, k) ?? "") ? str(form, k)! : d);
  const patch: Record<string, unknown> = {
    assistant_name: (str(form, "assistant_name") ?? "MyManager").slice(0, 24),
    brief_time: time("brief_time", "07:30"),
    quiet_start: time("quiet_start", "21:00"),
  };
  if (form.has("checkin_hours")) patch.checkin_hours = Math.max(0, Math.min(12, Number(str(form, "checkin_hours") ?? 3)));
  if (form.has("proactive_present")) patch.proactive = form.get("proactive") === "on";
  await db().from("settings").update(patch).eq("id", 1);
  refresh();
}

export async function toggleWatch(form: FormData) {
  await requireAuth();
  const id = str(form, "id");
  if (!id) return;
  const { data } = await db().from("projects").select("watch").eq("id", id).single();
  await db().from("projects").update({ watch: !data?.watch }).eq("id", id);
  refresh();
}

export async function setAutonomy(form: FormData) {
  await requireAuth();
  const v = str(form, "autonomy");
  if (v && ["ask", "balanced", "decide"].includes(v)) await db().from("settings").update({ autonomy: v }).eq("id", 1);
  refresh();
}

export async function completeReview() {
  await requireAuth();
  await db().from("settings").update({ last_review_at: new Date().toISOString() }).eq("id", 1);
  refresh();
  redirect("/");
}

// ---------- client jobs ----------
const cents = (v: string | null | undefined) => Math.round(Number((v ?? "0").replace(/[$,\s]/g, "")) * 100) || 0;

export async function saveClientSettings(form: FormData) {
  await requireAuth();
  const id = str(form, "project_id");
  if (!id) return;
  await db().from("projects").update({ client_name: str(form, "client_name"), hourly_rate_cents: cents(str(form, "rate")) || null }).eq("id", id);
  refresh();
}

export async function logTime(form: FormData) {
  await requireAuth();
  const project_id = str(form, "project_id");
  const h = Number(str(form, "hours") ?? 0);
  const minutes = Math.round(h * 60);
  if (!project_id || !(minutes > 0)) return;
  await db().from("time_entries").insert({ project_id, minutes, note: str(form, "note"), worked_on: str(form, "worked_on") ?? undefined });
  await touch(project_id);
  refresh();
}

export async function deleteTimeEntry(form: FormData) {
  await requireAuth();
  const id = str(form, "id");
  if (id) await db().from("time_entries").delete().eq("id", id).is("invoice_id", null);
  refresh();
}

/** Turns all unbilled hours into a draft invoice (hours × rate, or a fixed amount if given). */
export async function createInvoice(form: FormData) {
  await requireAuth();
  const project_id = str(form, "project_id");
  if (!project_id) return;
  // One locked database step numbers the invoice and claims the unbilled hours (no double billing on a double click).
  unwrap(await db().rpc("mm_create_invoice", { p_project: project_id, p_fixed_cents: cents(str(form, "amount")) || 0, p_note: str(form, "note") }));
  refresh();
}

export async function setInvoiceStatus(form: FormData) {
  await requireAuth();
  const id = str(form, "id");
  const status = str(form, "status");
  if (!id || !status || !["draft", "sent", "paid", "void"].includes(status)) return;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date());
  const due = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date(Date.now() + 14 * 86_400_000));
  const patch: Record<string, unknown> = { status };
  if (status === "sent") Object.assign(patch, { issued_on: today, due_on: due });
  if (status === "paid") patch.paid_on = today;
  if (status === "void") await db().from("time_entries").update({ invoice_id: null }).eq("invoice_id", id);
  await db().from("invoices").update(patch).eq("id", id);
  refresh();
}

// ---------- subscriptions ----------
export async function saveSubscription(form: FormData) {
  await requireAuth();
  const name = str(form, "name");
  if (!name) return;
  const cycle = str(form, "cycle") ?? "monthly";
  await db().from("subscriptions").insert({
    name, amount_cents: cents(str(form, "amount")), cycle: ["monthly", "yearly", "weekly"].includes(cycle) ? cycle : "monthly",
    project_id: str(form, "project_id"), next_renewal: str(form, "next_renewal"), url: str(form, "url"),
    status: str(form, "status") === "trial" ? "trial" : "active",
  });
  refresh();
}

export async function setSubscriptionStatus(form: FormData) {
  await requireAuth();
  const id = str(form, "id");
  const status = str(form, "status");
  if (id && status && ["active", "cancelled", "trial"].includes(status)) await db().from("subscriptions").update({ status }).eq("id", id);
  refresh();
}

// ---------- what Manager knows ----------
export async function addMemory(form: FormData) {
  await requireAuth();
  const fact = str(form, "fact");
  const category = str(form, "category") ?? "general";
  if (fact) await db().from("memories").insert({ fact: fact.slice(0, 500), category, source: "user" });
  refresh();
}

export async function deleteMemory(form: FormData) {
  await requireAuth();
  const id = str(form, "id");
  if (id) await db().from("memories").delete().eq("id", id);
  refresh();
}

// ---------- guided setup (paste a key in the app instead of editing files) ----------
const back = (q: string) => redirect(`/settings?${q}`);

export async function connectTelegram(form: FormData) {
  await requireAuth();
  const { setLocalEnv } = await import("@/lib/local-env");
  const token = (str(form, "token") ?? "").trim();
  if (!/^\d+:[\w-]{20,}$/.test(token)) back("err=telegram-format#phone");
  const api = process.env.TELEGRAM_API ?? "https://api.telegram.org";
  let name: string | null = null;
  try {
    const r = await fetch(`${api}/bot${token}/getMe`, { cache: "no-store" });
    const j = await r.json();
    if (j.ok) name = j.result?.username ?? null;
  } catch {}
  if (!name) back("err=telegram-rejected#phone");
  setLocalEnv("TELEGRAM_BOT_TOKEN", token);
  await db().from("settings").update({ telegram_bot_name: name, telegram_chat_id: null }).eq("id", 1);
  refresh();
  back("ok=telegram#phone");
}

export async function disconnectTelegram() {
  await requireAuth();
  const { setLocalEnv } = await import("@/lib/local-env");
  setLocalEnv("TELEGRAM_BOT_TOKEN", "");
  await db().from("settings").update({ telegram_bot_name: null, telegram_chat_id: null }).eq("id", 1);
  refresh();
  back("ok=telegram-off#phone");
}

export async function connectUp(form: FormData) {
  await requireAuth();
  const { setLocalEnv } = await import("@/lib/local-env");
  const token = (str(form, "token") ?? "").trim();
  if (token.length < 10 || /\s/.test(token)) back("err=up-format#bank");
  let ok = false;
  try {
    const r = await fetch(`${process.env.UP_API ?? "https://api.up.com.au/api/v1"}/util/ping`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    ok = r.ok;
  } catch {}
  if (!ok) back("err=up-rejected#bank");
  setLocalEnv("UP_TOKEN", token);
  refresh();
  back("ok=up#bank");
}

export async function disconnectUp() {
  await requireAuth();
  const { setLocalEnv } = await import("@/lib/local-env");
  setLocalEnv("UP_TOKEN", "");
  refresh();
  back("ok=up-off#bank");
}

export async function dismissWelcome() {
  await requireAuth();
  (await cookies()).set("welcomed", "1", { maxAge: 60 * 60 * 24 * 3650, path: "/", sameSite: "lax" });
  refresh();
}

export async function connectGithub(form: FormData) {
  await requireAuth();
  const { setLocalEnv } = await import("@/lib/local-env");
  const token = (str(form, "token") ?? "").trim();
  if (token.length < 20 || /\s/.test(token)) back("err=github-format#code");
  let ok = false;
  try {
    const r = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }, cache: "no-store" });
    ok = r.ok;
  } catch {}
  if (!ok) back("err=github-rejected#code");
  setLocalEnv("GITHUB_TOKEN", token);
  refresh();
  back("ok=github#code");
}

export async function disconnectGithub() {
  await requireAuth();
  const { setLocalEnv } = await import("@/lib/local-env");
  setLocalEnv("GITHUB_TOKEN", "");
  refresh();
  back("ok=github-off#code");
}

// ---------- undo what the assistant did ----------
const UNDO_TABLES = new Set(["tasks", "projects", "memories", "time_entries", "subscriptions", "ideas", "campaigns", "missions"]);
export async function undoActivity(form: FormData) {
  await requireAuth();
  const id = str(form, "id");
  if (!id) return;
  const { data: a } = await db().from("activity").select("*").eq("id", id).maybeSingle();
  const u = a?.undo as { op?: string; table?: string; id?: string; values?: Record<string, unknown> } | null;
  if (!a || a.undone || !u?.table || !u.id || !UNDO_TABLES.has(u.table)) return;
  if (u.op === "delete") await db().from(u.table).delete().eq("id", u.id);
  else if (u.op === "update" && u.values) await db().from(u.table).update(u.values).eq("id", u.id);
  await db().from("activity").update({ undone: true }).eq("id", id);
  refresh();
}

/** Private usage log: which screens, how long. Never leaves this PC's database. */
export async function logUsage(path: string, seconds: number, device: string) {
  await requireAuth();
  if (!path || path.startsWith("/login") || !(seconds >= 0)) return;
  await db().from("usage_events").insert({ path: path.slice(0, 120), seconds: Math.min(3600, Math.round(seconds)), device: device === "phone" ? "phone" : "desktop" });
}

export async function setMessageMode(form: FormData) {
  await requireAuth();
  const m = str(form, "mode");
  if (!m || !["needed", "daily", "more"].includes(m)) return;
  await db().from("settings").update({ message_mode: m, proactive: true, checkin_hours: m === "daily" ? 0 : 3 }).eq("id", 1);
  refresh();
}

export async function pauseProjects(form: FormData) {
  await requireAuth();
  const ids = form.getAll("id").map(String).filter(Boolean).slice(0, 20);
  for (const id of ids) {
    await db().from("projects").update({ status: "paused" }).eq("id", id);
    const { data } = await db().from("projects").select("name").eq("id", id).maybeSingle();
    await db().from("activity").insert({ title: `Paused ${data?.name ?? "a project"} (you said yes)`, undo: { op: "update", table: "projects", id, values: { status: "active" } } });
  }
  refresh();
}

// ---------- recurring jobs ----------
export async function saveJob(form: FormData) {
  await requireAuth();
  const { DAYS } = await import("@/lib/jobs");
  const id = str(form, "id");
  const days = form.getAll("days").map(String).filter((d) => (DAYS as readonly string[]).includes(d));
  const at = str(form, "at_time") ?? "09:00";
  const row = {
    project_id: str(form, "project_id"),
    name: (str(form, "name") ?? "Weekly job").slice(0, 80),
    instructions: (str(form, "instructions") ?? "").slice(0, 4000),
    days: (days.length ? days : ["mon"]).join(","),
    at_time: /^\d{2}:\d{2}$/.test(at) ? at : "09:00",
    source_url: str(form, "source_url"),
  };
  if (!row.instructions) return;
  if (id) await db().from("jobs").update(row).eq("id", id);
  else await db().from("jobs").insert({ ...row, enabled: true });
  refresh();
}

export async function toggleJob(form: FormData) {
  await requireAuth();
  const id = str(form, "id");
  if (!id) return;
  const { data } = await db().from("jobs").select("enabled").eq("id", id).single();
  await db().from("jobs").update({ enabled: !data?.enabled }).eq("id", id);
  refresh();
}

export async function deleteJob(form: FormData) {
  await requireAuth();
  const id = str(form, "id");
  if (id) await db().from("jobs").delete().eq("id", id);
  refresh();
}

/** Run a job now and watch it work in the assistant screen. */
export async function runJobNow(form: FormData) {
  await requireAuth();
  const id = str(form, "id");
  if (!id) return;
  const { goalFor } = await import("@/lib/jobs");
  const { data: j } = await db().from("jobs").select("*").eq("id", id).single();
  if (!j) return;
  const { data: p } = j.project_id ? await db().from("projects").select("name").eq("id", j.project_id).maybeSingle() : { data: null };
  await db().from("jobs").update({ last_run_at: new Date().toISOString() }).eq("id", id);
  redirect(`/agent?ask=${encodeURIComponent(goalFor(j, p?.name ?? null))}`);
}

// ---------- ads ----------
const centsOf = (v: string | null) => Math.round(Number((v ?? "0").replace(/[$,\s]/g, "")) * 100) || 0;

/** Save a campaign draft. Launching it is a separate, approved step. */
export async function saveCampaign(form: FormData) {
  await requireAuth();
  const row = {
    project_id: str(form, "project_id"), name: (str(form, "name") ?? "New campaign").slice(0, 80),
    platform: str(form, "platform") ?? "meta", goal: str(form, "goal"), audience: str(form, "audience"), creative: str(form, "creative"),
    daily_budget_cents: centsOf(str(form, "daily")), days: Math.max(1, Math.min(90, Number(str(form, "days") ?? 7))),
  };
  const id = str(form, "id");
  if (id) await db().from("campaigns").update(row).eq("id", id);
  else await db().from("campaigns").insert(row);
  refresh();
}

/** Ask to launch: total budget goes through Approvals and the spend limits. */
export async function requestLaunch(form: FormData) {
  await requireAuth();
  const id = str(form, "id");
  const { data: c } = await db().from("campaigns").select("*").eq("id", id).single();
  if (!c) return;
  const total = c.daily_budget_cents * c.days;
  const a = await queueAction({
    kind: "ads.launch", title: `Launch ad: ${c.name} (${c.platform === "meta" ? "Facebook + Instagram" : c.platform})`, requested_by: "user", project_id: c.project_id,
    cost_cents: total, reason: `$${(c.daily_budget_cents / 100).toFixed(0)}/day for ${c.days} days${c.goal ? ` · goal: ${c.goal}` : ""}`,
    payload: { campaign_id: c.id, platform: c.platform, audience: c.audience, creative: c.creative, daily_budget_cents: c.daily_budget_cents, days: c.days },
  });
  await db().from("campaigns").update({ status: a.status === "rejected" ? "draft" : "waiting", notes: a.status === "rejected" ? `Blocked: ${(a.result as { blocked?: string })?.blocked ?? "over a spend limit"}. Raise the limit in Settings or lower the budget.` : null }).eq("id", c.id);
  refresh();
}

export async function setCampaignStatus(form: FormData) {
  await requireAuth();
  const id = str(form, "id");
  const status = str(form, "status");
  if (!id || !status || !["live", "paused", "ended"].includes(status)) return;
  await db().from("campaigns").update({ status, ...(status === "live" ? { started_on: new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date()) } : {}) }).eq("id", id);
  refresh();
}

/** Record spend and results from the ads dashboard (or the assistant can do it). */
export async function logCampaignResults(form: FormData) {
  await requireAuth();
  const id = str(form, "id");
  if (!id) return;
  const n = (k: string) => Math.max(0, Math.round(Number(str(form, k) ?? 0)) || 0);
  await db().from("campaigns").update({ spend_cents: centsOf(str(form, "spend")), installs: n("installs"), clicks: n("clicks"), impressions: n("impressions") }).eq("id", id);
  refresh();
}

// ---------- supervise ----------
/** Start supervising from the Supervise screen: goal + steps (one per line). */
export async function startMission(form: FormData) {
  await requireAuth();
  const projectId = str(form, "project_id");
  const goal = str(form, "goal");
  if (!projectId || !goal) return;
  const hours = Math.max(0.25, Math.min(24, Number(str(form, "every") ?? 1) || 1));
  const workDir = str(form, "work_dir");
  const [m] = unwrap(await db().from("missions").insert({
    project_id: projectId, goal: goal.slice(0, 1000), check_every_minutes: Math.round(hours * 60), work_dir: workDir,
    next_check_at: new Date(Date.now() + 30_000).toISOString(),
  }).select());
  const steps = (str(form, "steps") ?? "").split(/\r?\n/).map((x) => x.replace(/^[-*\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 20);
  if (steps.length) await db().from("tasks").insert(steps.map((t) => ({ title: t.slice(0, 200), project_id: projectId, mission_id: m.id, priority: 2 })));
  const { logMission } = await import("@/lib/missions");
  await logMission(m.id, "note", `Started: ${goal}`);
  if (workDir) {
    await db().from("projects").update({ local_path: workDir }).eq("id", projectId);
    const { data: p } = await db().from("projects").select("name").eq("id", projectId).single();
    await queueAction({
      kind: "mission.code", title: `Let MyManager work on the ${p?.name ?? "project"} code`, requested_by: "user", project_id: projectId, cost_cents: 0,
      reason: `For "${goal.slice(0, 120)}": it edits files in ${workDir} on a separate branch, commits, and never pushes or deploys.`,
      payload: { mission_id: m.id, folder: workDir },
    });
  }
  refresh();
  redirect(`/supervise?m=${m.id}`);
}

export async function answerMissionForm(form: FormData) {
  await requireAuth();
  const id = str(form, "id");
  const answer = str(form, "answer");
  if (!id || !answer) return;
  const { answerMission } = await import("@/lib/missions");
  await answerMission(id, answer);
  refresh();
}

export async function checkMissionNow(form: FormData) {
  await requireAuth();
  const id = str(form, "id");
  if (!id) return;
  await db().from("missions").update({ next_check_at: new Date().toISOString() }).eq("id", id);
  const { checkMission } = await import("@/lib/missions");
  void checkMission(id).catch(() => {});
  refresh();
}

export async function setMissionStatus(form: FormData) {
  await requireAuth();
  const id = str(form, "id");
  const status = str(form, "status");
  if (!id || !status) return;
  const { finishMission } = await import("@/lib/missions");
  if (status === "done" || status === "stopped") await finishMission(id, status);
  else if (status === "running") await db().from("missions").update({ status: "running", question: null, finished_at: null, next_check_at: new Date().toISOString() }).eq("id", id);
  refresh();
}

// ---------- project folders on this PC ----------
export async function findProjectFolders() {
  await requireAuth();
  const { linkProjectFolders } = await import("@/lib/local-repos");
  const r = await linkProjectFolders();
  refresh();
  redirect(`/projects?found=${r.linked.length}&scanned=${r.scanned}`);
}

export async function setProjectFolder(form: FormData) {
  await requireAuth();
  const id = str(form, "id");
  if (!id) return;
  await db().from("projects").update({ local_path: str(form, "local_path") }).eq("id", id);
  refresh();
}

// ---------- project briefs ----------
export async function saveBrief(form: FormData) {
  await requireAuth();
  const id = str(form, "id");
  if (!id) return;
  await db().from("projects").update({ brief: str(form, "brief"), brief_updated_at: new Date().toISOString(), brief_edited_by_you: true }).eq("id", id);
  await (await import("@/lib/project-notes")).writeNotes(id).catch(() => "");
  refresh();
}

export async function saveRules(form: FormData) {
  await requireAuth();
  const id = str(form, "id");
  if (!id) return;
  await db().from("projects").update({ rules: str(form, "rules") }).eq("id", id);
  await (await import("@/lib/project-notes")).writeNotes(id).catch(() => "");
  refresh();
}

/** Study the project now and watch it happen in the assistant screen. */
export async function studyNow(form: FormData) {
  await requireAuth();
  const id = str(form, "id");
  if (!id) return;
  const { data: p } = await db().from("projects").select("*").eq("id", id).single();
  if (!p) return;
  const { studyGoal } = await import("@/lib/briefs");
  redirect(`/agent?ask=${encodeURIComponent(studyGoal(p))}`);
}

// ---------- runbooks ----------
export async function runbookStepDone(form: FormData) {
  await requireAuth();
  const id = str(form, "id"), step = str(form, "step");
  if (!id || !step) return;
  const { resolveStep } = await import("@/lib/runbooks");
  await resolveStep(id, step, str(form, "outcome") === "skipped" ? "skipped" : "done");
  refresh();
}

export async function runbookStop(form: FormData) {
  await requireAuth();
  const id = str(form, "id");
  if (!id) return;
  const { stopRunbook } = await import("@/lib/runbooks");
  await stopRunbook(id);
  refresh();
}

