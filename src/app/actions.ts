"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, sessionToken } from "@/lib/auth";
import { db, unwrap } from "@/lib/db";
import { kindOf } from "@/lib/action-registry";
import { trustLevel } from "@/lib/trust";
import { getSettings, monthSpendCents } from "@/lib/queries";
import type { Action } from "@/lib/types";

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const refresh = () => revalidatePath("/", "layout");

// ---------- auth ----------
export async function login(form: FormData) {
  const pw = str(form, "password");
  if (!pw || pw !== process.env.APP_PASSWORD) redirect("/login?error=1");
  (await cookies()).set(COOKIE, await sessionToken(), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90,
  });
  redirect(str(form, "next") ?? "/");
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
  unwrap(await db().from("projects").update({ status }).eq("id", id).select());
  refresh();
}

// ---------- tasks ----------
export async function addTask(form: FormData) {
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
  const [t] = unwrap(await db().from("tasks").update({
    status, done_at: status === "done" ? new Date().toISOString() : null,
  }).eq("id", id).select());
  await touch(t?.project_id ?? null);
  refresh();
}
export async function deleteTask(id: string) {
  await db().from("tasks").delete().eq("id", id);
  refresh();
}

// ---------- ideas ----------
export async function addIdea(form: FormData) {
  const text = str(form, "text");
  if (!text) return;
  unwrap(await db().from("ideas").insert({ text }).select());
  refresh();
}
export async function triageIdea(id: string, decision: "promote" | "park" | "kill") {
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
  await db().from("focus_sessions").update({ ended_at: new Date().toISOString(), outcome: "switched" }).is("ended_at", null);
  const project_id = str(form, "project_id");
  unwrap(await db().from("focus_sessions").insert({
    project_id, task_id: str(form, "task_id"), planned_minutes: Number(str(form, "minutes") ?? 50),
  }).select());
  await touch(project_id);
  refresh();
}
export async function endFocus(form: FormData) {
  await db().from("focus_sessions").update({
    ended_at: new Date().toISOString(), outcome: str(form, "outcome") ?? "done",
  }).is("ended_at", null);
  refresh();
}

// ---------- approval queue ----------
export async function queueAction(input: {
  kind: string; title: string; reason?: string; payload?: Record<string, unknown>;
  cost_cents?: number; project_id?: string | null; requested_by?: string;
}): Promise<Action> {
  const k = kindOf(input.kind);
  const cost = Math.max(0, Math.round(input.cost_cents ?? 0));
  const s = await getSettings();
  let risk: Action["risk"] = cost > 0 ? "approval" : k.risk;
  let blockedWhy: string | null = null;
  if (cost > s.per_purchase_cap_cents) blockedWhy = "over per-purchase cap";
  else if (cost > 0 && (await monthSpendCents()) + cost > s.monthly_cap_cents) blockedWhy = "over monthly cap";
  if (blockedWhy) risk = "blocked";
  // Trust ladder: a trustable, free action type Thomas has approved N times in a row runs on its own.
  let trusted = false;
  if (!blockedWhy && risk === "approval" && cost === 0 && (await trustLevel(k.kind)).trusted) { risk = "auto"; trusted = true; }

  const [a] = unwrap(await db().from("actions").insert({
    kind: k.kind, title: input.title, reason: input.reason ?? null, payload: input.payload ?? {},
    cost_cents: cost, risk, project_id: input.project_id ?? null,
    requested_by: input.requested_by ?? "user",
    status: blockedWhy ? "rejected" : "pending",
    result: blockedWhy ? { blocked: blockedWhy } : null,
    decided_at: blockedWhy ? new Date().toISOString() : null,
    ...(trusted ? { reason: `${input.reason ? input.reason + " · " : ""}auto-approved by trust ladder` } : {}),
  }).select());
  if (risk === "auto") return await execute(a);
  refresh();
  return a;
}

async function execute(a: Action): Promise<Action> {
  const k = kindOf(a.kind);
  const now = new Date().toISOString();
  if (!k.execute) {
    // Nothing automatic to run: approved and handed to the agent / PC helper / you.
    const [r] = unwrap(await db().from("actions").update({ status: "approved", decided_at: a.decided_at ?? now }).eq("id", a.id).select());
    refresh();
    return r;
  }
  try {
    const result = await k.execute(a);
    const [r] = unwrap(await db().from("actions").update({ status: "executed", result, executed_at: now, decided_at: a.decided_at ?? now }).eq("id", a.id).select());
    refresh();
    return r;
  } catch (e) {
    const [r] = unwrap(await db().from("actions").update({ status: "failed", result: { error: String(e) }, executed_at: now }).eq("id", a.id).select());
    refresh();
    return r;
  }
}

export async function decideAction(id: string, approve: boolean) {
  const { data: a } = await db().from("actions").select("*").eq("id", id).single();
  if (!a || a.status !== "pending") return;
  const now = new Date().toISOString();
  if (!approve) {
    await db().from("actions").update({ status: "rejected", decided_at: now }).eq("id", id);
    refresh();
    return;
  }
  await execute({ ...a, decided_at: now });
}

export async function markActionDone(id: string, form: FormData) {
  await db().from("actions").update({
    status: "executed", executed_at: new Date().toISOString(), result: { note: str(form, "note") },
  }).eq("id", id).eq("status", "approved");
  refresh();
}

export async function requestAction(form: FormData) {
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
  await db().from("settings").update({ telegram_chat_id: null }).eq("id", 1);
  refresh();
}

export async function saveAssistant(form: FormData) {
  const time = (k: string, d: string) => (/^\d{2}:\d{2}$/.test(str(form, k) ?? "") ? str(form, k)! : d);
  await db().from("settings").update({
    assistant_name: (str(form, "assistant_name") ?? "Manager").slice(0, 24),
    brief_time: time("brief_time", "07:30"),
    quiet_start: time("quiet_start", "21:30"),
    checkin_hours: Math.max(0, Math.min(12, Number(str(form, "checkin_hours") ?? 3))),
    proactive: form.get("proactive") === "on",
  }).eq("id", 1);
  refresh();
}

export async function toggleWatch(form: FormData) {
  const id = str(form, "id");
  if (!id) return;
  const { data } = await db().from("projects").select("watch").eq("id", id).single();
  await db().from("projects").update({ watch: !data?.watch }).eq("id", id);
  refresh();
}

export async function setAutonomy(form: FormData) {
  const v = str(form, "autonomy");
  if (v && ["ask", "balanced", "decide"].includes(v)) await db().from("settings").update({ autonomy: v }).eq("id", 1);
  refresh();
}

export async function completeReview() {
  await db().from("settings").update({ last_review_at: new Date().toISOString() }).eq("id", 1);
  refresh();
  redirect("/");
}
