import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { vercelAuth } from "@/lib/vercel-auth";
import { findVercelProject } from "@/lib/vercel-link";

/**
 * Putting MyManager online, done by MyManager itself on the PC: it sets up the online database's tables, reads what the Vercel project already has, takes
 * the database keys straight from Supabase's own tool (signed in on this PC) and sets them on Vercel, deploys the
 * live site, then copies its data to the online database and switches the PC over to it, so the PC and the phone
 * see the same things. Keys go from Supabase to Vercel and .env.local only: they're never shown, logged or
 * passed to the assistant.
 */
const run = promisify(execFile);
const isWin = process.platform === "win32";
const VERCEL = "https://api.vercel.com";
export const ONLINE_PROJECT = "manager"; // the Vercel project for MyManager itself

async function cli(cmd: string, args: string[], timeout = 60_000) {
  const attempt = (c: string, a: string[]) => {
    const p = run(isWin ? "cmd.exe" : c, isWin ? ["/d", "/c", c, ...a] : a, { timeout, windowsHide: true, maxBuffer: 4 << 20 });
    p.child.stdin?.end(); // nothing to type: a question it asks gets "no answer" instead of waiting forever
    return p.then((x) => ({ ok: true, text: `${x.stdout}${x.stderr}` }), (e) => ({ ok: false, text: `${e.stdout ?? ""}${e.stderr ?? ""}` }));
  };
  const direct = await attempt(cmd, args);
  if (direct.ok || !/not recognized|not found|ENOENT/i.test(direct.text)) return direct;
  return attempt("npx", ["--no-install", cmd, ...args]);
}

const WEAK = ["", "manager", "password", "changeme", "mymanager", "admin", "123456", "12345678"];
/** Online, anyone can reach the login page, so the password has to be his own and not easy to guess. */
export function passwordProblem(pw = process.env.APP_PASSWORD ?? "") {
  if (WEAK.includes(pw.toLowerCase())) return "Your MyManager password is still the starting one.";
  if (pw.length < 10) return "Your MyManager password is shorter than 10 characters.";
  return null;
}

/** The secret database key for a Supabase project, from Supabase's own tool. Never returned to the screens. */
async function serviceKey(ref: string): Promise<string | null> {
  for (const args of [["projects", "api-keys", "--project-ref", ref, "--reveal", "-o", "json"], ["projects", "api-keys", "--project-ref", ref, "-o", "json"], ["projects", "api-keys", `--remote=${ref}`, "--reveal", "-o", "json"]]) {
    const r = await cli("supabase", args);
    if (!r.ok) continue;
    try {
      const list = JSON.parse(r.text.slice(r.text.indexOf("["))) as { name?: string; type?: string; api_key?: string }[];
      const legacy = list.find((k) => k.name === "service_role" && k.api_key && !/\*/.test(k.api_key));
      const secret = list.find((k) => k.type === "secret" && k.api_key && !/\*|···/.test(k.api_key));
      const key = legacy?.api_key ?? secret?.api_key;
      if (key) return key;
    } catch { /* try the next form */ }
  }
  return null;
}

type Env = { id: string; key: string; type: string; value?: string; target?: string[] };
async function vercel(pathname: string, teamId: string, init: RequestInit = {}) {
  const { token } = vercelAuth();
  if (!token) throw new Error("MyManager isn't signed in to Vercel on this PC.");
  const sep = pathname.includes("?") ? "&" : "?";
  const res = await fetch(`${VERCEL}${pathname}${sep}teamId=${encodeURIComponent(teamId)}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) }, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Vercel said ${res.status}: ${(body as { error?: { message?: string } }).error?.message ?? "no reason given"}`);
  return body;
}

/** The migration files, oldest first. */
function migrationFiles() {
  return fs.readdirSync(path.join(process.cwd(), "supabase", "migrations")).filter((x) => /^\d+_.*\.sql$/.test(x)).sort();
}
const SCHEMA_MARK = () => path.join(process.cwd(), ".localdb", "online-schema.txt"); // the newest migration the online database has

/**
 * Step 0: give the online database MyManager's tables (and their locks), using Supabase's own tool on this PC. It keeps
 * its own list of what it has applied online, so running it again only adds what's new. No database password is
 * needed or kept: the tool signs in with the account it already has.
 */
export async function setOnlineSchema(ref: string): Promise<string> {
  const link = await cli("supabase", ["link", "--project-ref", ref, "--yes"], 2 * 60_000);
  if (!link.ok && !/already linked|Finished supabase link/i.test(link.text)) throw new Error(schemaTrouble("link this folder to the new database", link.text));
  const push = await cli("supabase", ["db", "push", "--linked", "--include-all", "--yes"], 5 * 60_000);
  if (!push.ok) throw new Error(schemaTrouble("set up the tables in the new database", push.text));
  const files = migrationFiles();
  try { fs.mkdirSync(path.dirname(SCHEMA_MARK()), { recursive: true }); fs.writeFileSync(SCHEMA_MARK(), files.at(-1) ?? ""); } catch { /* only a note to itself */ }
  return /up to date/i.test(push.text) ? "The online database already had all of MyManager's tables." : `Set up MyManager's tables in the online database (${files.length} updates, with the same locks as on your PC).`;
}

function schemaTrouble(what: string, text: string) {
  if (/password/i.test(text)) return `Supabase's tool on this PC asked for the database password to ${what}, and I don't keep one. I'll find another way.`;
  if (/not logged in|access token|login/i.test(text)) return "MyManager isn't signed in to Supabase on this PC.";
  const last = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? "no reason given";
  return `Supabase's tool couldn't ${what}: "${last.slice(0, 160)}"`;
}

/**
 * Once the PC uses the online database, new updates to MyManager can bring new migration files. Apply them online
 * on their own, once each (checked every 10 minutes); if that fails, say so once in plain words.
 */
let lastSchemaLook = 0;
let lastSchemaFail = "";
export async function keepOnlineSchemaCurrent() {
  if (process.env.VERCEL || Date.now() - lastSchemaLook < 10 * 60_000) return;
  lastSchemaLook = Date.now();
  const m = (process.env.SUPABASE_URL ?? "").match(/^https:\/\/([a-z0-9]{20})\.supabase\.co/);
  if (!m) return; // still on the PC's own database
  const newest = migrationFiles().at(-1) ?? "";
  let had = "";
  try { had = fs.readFileSync(SCHEMA_MARK(), "utf8").trim(); } catch { /* never noted */ }
  if (had === newest) return;
  try {
    await setOnlineSchema(m[1]);
    lastSchemaFail = "";
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    if (why !== lastSchemaFail) { lastSchemaFail = why; const { notify } = await import("@/lib/notify"); void notify(`⚠️ MyManager has a database update the online database doesn't have yet. ${why}`); }
  }
}

/** Step 1: the online site's settings. Returns what changed, in plain words (names only, never values). */
export async function setOnlineSettings(ref: string): Promise<string> {
  const bad = passwordProblem();
  if (bad) throw new Error(`${bad} Choose your own first (on the card), then I'll carry on.`);
  const p = await findVercelProject(ONLINE_PROJECT);
  if (!p || typeof p === "string") throw new Error(p === "no_auth" ? "MyManager isn't signed in to Vercel on this PC." : `I couldn't find the Vercel project "${ONLINE_PROJECT}".`);
  const key = await serviceKey(ref);
  if (!key) throw new Error(`Supabase's tool on this PC couldn't give me the keys for the new database (${ref}). Its sign-in may not be the account that owns it.`);
  const { envs = [] } = (await vercel(`/v10/projects/${p.id}/env`, p.orgId)) as { envs?: Env[] };
  const url = `https://${ref}.supabase.co`;
  const want: { key: string; value: string; type: "plain" | "sensitive"; target: string[] }[] = [
    { key: "SUPABASE_URL", value: url, type: "plain", target: ["production", "preview", "development"] },
    { key: "SUPABASE_SERVICE_ROLE_KEY", value: key, type: "sensitive", target: ["production", "preview"] },
    { key: "APP_PASSWORD", value: process.env.APP_PASSWORD!, type: "sensitive", target: ["production", "preview"] },
  ];
  if (!envs.some((e) => e.key === "AUTH_SECRET") && process.env.AUTH_SECRET) want.push({ key: "AUTH_SECRET", value: process.env.AUTH_SECRET, type: "sensitive", target: ["production", "preview"] });
  if (!envs.some((e) => e.key === "VERCEL_TEAM_ID")) want.push({ key: "VERCEL_TEAM_ID", value: p.orgId, type: "plain", target: ["production", "preview", "development"] });
  const said: string[] = [];
  for (const w of want) {
    const old = envs.filter((e) => e.key === w.key);
    // a sensitive value can't be edited into another type, so replace it: remove the old entries, add the new one
    for (const o of old) await vercel(`/v9/projects/${p.id}/env/${o.id}`, p.orgId, { method: "DELETE" });
    await vercel(`/v10/projects/${p.id}/env`, p.orgId, { method: "POST", body: JSON.stringify({ key: w.key, value: w.value, type: w.type, target: w.target }) });
    const was = old.find((o) => o.type === "plain")?.value;
    said.push(w.key === "SUPABASE_URL" ? `the database address${was && was !== url ? ` (was ${was.replace(/^https:\/\//, "")}, now ${ref}.supabase.co)` : ""}`
      : w.key === "SUPABASE_SERVICE_ROLE_KEY" ? "the database key (straight from Supabase)" : w.key === "APP_PASSWORD" ? "your password (the same one as on your PC)" : w.key.toLowerCase());
  }
  return `Set on Vercel: ${said.join(", ")}. Nothing else there was changed.`;
}

/** Step 2: deploy the live site from GitHub's main branch and wait until it's up. Returns its address. */
export async function deployOnline(): Promise<{ url: string; note: string }> {
  const p = await findVercelProject(ONLINE_PROJECT);
  if (!p || typeof p === "string") throw new Error("I couldn't find the Vercel project for MyManager.");
  const proj = (await vercel(`/v9/projects/${p.id}`, p.orgId)) as { link?: { type?: string; org?: string; repo?: string; repoId?: number; productionBranch?: string }; ssoProtection?: { deploymentType?: string } | null };
  const link = proj.link;
  if (link?.type !== "github" || !link.repoId) throw new Error("MyManager's Vercel project isn't connected to its GitHub repo, so I can't deploy it from there.");
  const d = (await vercel(`/v13/deployments`, p.orgId, { method: "POST", body: JSON.stringify({ name: ONLINE_PROJECT, project: p.id, target: "production", gitSource: { type: "github", repoId: link.repoId, ref: link.productionBranch ?? "main" } }) })) as { id: string; url: string };
  const until = Date.now() + 12 * 60_000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 10_000));
    const s = (await vercel(`/v13/deployments/${d.id}`, p.orgId)) as { readyState?: string; alias?: string[] };
    if (s.readyState === "READY") {
      const url = `https://${s.alias?.find((a) => !/-git-|[a-z0-9]{9}-/.test(a)) ?? s.alias?.[0] ?? d.url}`;
      // Vercel's own sign-in wall would stop his phone before MyManager's login page. Keep it on test copies only:
      // the live site is still behind his MyManager password (checked to be his own before this step).
      let opened = "";
      const wall = proj.ssoProtection?.deploymentType;
      let walled = false;
      if (wall && wall !== "preview") {
        const ok = await vercel(`/v9/projects/${p.id}`, p.orgId, { method: "PATCH", body: JSON.stringify({ ssoProtection: { deploymentType: "preview" } }) }).then(() => true, () => false);
        if (ok) opened = " Vercel's extra sign-in is now only on test copies, so your phone goes straight to your MyManager login.";
        else { walled = true; opened = " Vercel wouldn't let me take its extra sign-in off, so the first time on your phone it asks you to sign in to Vercel (with GitHub, like on your PC), then shows your MyManager login."; }
      }
      const check = await fetch(`${url}/login`, { redirect: "manual", cache: "no-store" }).then((r) => r.status, () => 0);
      if (check !== 200 && !(walled && [401, 302, 307].includes(check))) throw new Error(`The live site is up at ${url}, but its login page didn't open (${check || "no answer"}). I'll look into it.`);
      if (walled) return { url, note: `The live site is up at ${url}.${opened}` };
      return { url, note: `The live site is up at ${url} and its login page opens.${opened}` };
    }
    if (s.readyState === "ERROR" || s.readyState === "CANCELED") throw new Error(`Vercel couldn't build the live site (${s.readyState?.toLowerCase()}). I'll look at the build log.`);
    if (Date.now() > until) throw new Error("Vercel is taking more than 12 minutes to build it. I'll keep an eye on it.");
  }
}

/** The tables, in the order the migrations create them (so ones that point at others come after them). */
function tables() {
  const dir = path.join(process.cwd(), "supabase", "migrations");
  const out: string[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    for (const m of fs.readFileSync(path.join(dir, f), "utf8").matchAll(/create table (?:if not exists )?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * Step 3: copy everything from the database on the PC to the online one, then point the PC at the online one.
 * The PC's old settings file is kept as a copy first. Nothing is deleted from the PC's own database.
 */
export async function switchPcToOnline(ref: string): Promise<string> {
  const key = await serviceKey(ref);
  if (!key) throw new Error("Supabase's tool couldn't give me the new database's key.");
  const fromUrl = process.env.SUPABASE_URL!;
  const fromKey = process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY !== "local" ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.MM_LOCAL_DB_KEY!;
  const toUrl = `https://${ref}.supabase.co`;
  if (fromUrl.replace(/\/$/, "") === toUrl) return "Your PC already uses the online database.";
  const h = (k: string) => ({ apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json" });
  let rows = 0;
  const skipped: string[] = [];
  // can the online database be reached at all? If not, say so plainly and leave the PC as it is
  const reach = await fetch(`${toUrl}/rest/v1/agent_runs?select=id&limit=1`, { headers: h(key), cache: "no-store" }).then((r) => r.status, () => 0);
  if (!reach) throw new Error(`I couldn't reach the online database (${ref}.supabase.co) from this PC, so I left your PC on its own database.`);
  if (reach === 404) throw new Error("The online database doesn't have MyManager's tables yet, so I left your PC on its own database.");
  for (const t of tables()) {
    const r = await fetch(`${fromUrl}/rest/v1/${t}?select=*`, { headers: h(fromKey), cache: "no-store" });
    if (!r.ok) { skipped.push(t); continue; }
    const data = (await r.json()) as unknown[];
    for (let i = 0; i < data.length; i += 500) {
      const w = await fetch(`${toUrl}/rest/v1/${t}`, { method: "POST", headers: { ...h(key), Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(data.slice(i, i + 500)) });
      if (!w.ok) { skipped.push(`${t} (${(await w.text()).slice(0, 80)})`); break; }
    }
    rows += data.length;
  }
  if (skipped.length > 3) throw new Error(`Copying to the online database didn't work for ${skipped.length} tables (first: ${skipped[0]}), so I left your PC on its own database.`);
  const file = path.join(process.cwd(), ".env.local");
  fs.copyFileSync(file, `${file}.before-online`);
  const { setLocalEnv } = await import("@/lib/local-env");
  setLocalEnv("SUPABASE_URL", toUrl);
  setLocalEnv("SUPABASE_SERVICE_ROLE_KEY", key);
  (await import("@/lib/db")).resetDb();
  return `Copied ${rows} records to the online database and switched your PC to it, so your PC and phone now see the same things.${skipped.length ? ` (${skipped.length} small table${skipped.length > 1 ? "s" : ""} didn't copy: ${skipped.join(", ")}.)` : ""} Your old settings are kept in .env.local.before-online.`;
}

/**
 * When the database for going online exists (a Supabase project called MyManager that its sign-in can see) and the
 * PC isn't using it yet, MyManager plans the whole thing itself and asks once: one OK on the Dashboard and in the chat.
 * Older hand-made plans for the same job are closed so he only sees one card.
 */
let lastOfferLook = 0;
export async function maybeOfferOnline() {
  if (process.env.VERCEL || Date.now() - lastOfferLook < 10 * 60_000) return;
  lastOfferLook = Date.now();
  if (!/localhost|127\.0\.0\.1/.test(process.env.SUPABASE_URL ?? "")) return; // already online
  const { db } = await import("@/lib/db");
  const { data: mine } = await db().from("runbooks").select("id,status").eq("title", ONLINE_TITLE).in("status", ["queued", "running", "waiting", "done"]);
  if ((mine ?? []).length) return;
  const r = await cli("supabase", ["projects", "list", "-o", "json"]);
  if (!r.ok) return;
  let ref: string | undefined;
  try { ref = (JSON.parse(r.text.slice(r.text.indexOf("["))) as { id?: string; ref?: string; name: string }[]).find((p) => /^my\s?manager$/i.test(p.name))?.ref; } catch { return; }
  if (!ref) return;
  const { data: projs } = await db().from("projects").select("id,name");
  const proj = ((projs ?? []) as { id: string; name: string }[]).find((p) => /^(my)?manager$/i.test(p.name.trim()));
  const { draftRunbook } = await import("@/lib/runbooks");
  const res = await draftRunbook({
    project_id: proj?.id ?? null, work_dir: process.cwd(), title: ONLINE_TITLE,
    steps: [
      { kind: "auto", task: "online_password", label: "Make sure your MyManager password is your own" },
      { kind: "auto", task: "online_schema", ref, label: "Set up MyManager's tables in the online database" },
      { kind: "auto", task: "online_settings", ref, label: "Set the live site's database and password on Vercel (straight from Supabase)" },
      { kind: "auto", task: "online_deploy", label: "Put the live site up and check it works" },
      { kind: "auto", task: "online_switch", ref, label: "Copy your data online and switch your PC to it, so your phone sees the same things" },
    ],
  }, true);
  if (!res.ok) return;
  const { data: open } = await db().from("runbooks").select("id,title,steps").in("status", ["queued", "running", "waiting"]).neq("id", res.id);
  for (const o of ((open ?? []) as { id: string; title: string; steps?: { approval_id?: string } }[]).filter((x) => /\bonline\b/i.test(x.title))) {
    await db().from("runbooks").update({ status: "stopped", last_update: `Replaced by "${ONLINE_TITLE}", which does it all by itself.` }).eq("id", o.id);
    if (o.steps?.approval_id) await db().from("actions").update({ status: "rejected", result: { note: "replaced" } }).eq("id", o.steps.approval_id).eq("status", "pending");
  }
  const { notify } = await import("@/lib/notify");
  void notify(`🌐 Your online database is ready. I've planned putting MyManager online, all done by me: one OK on your Dashboard starts it.`);
}
export const ONLINE_TITLE = "Put MyManager online";
