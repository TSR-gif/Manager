// Checks for the fixes from the outside program review (docs/WORKLOG.md, 2026-11-14). Run with: npm test
// Uses a throwaway built-in database, so nothing on this PC is touched.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isLoginCommand, isReadOnlyCommand } from "../src/lib/command-safety.mjs";
import { nextMove } from "../src/lib/runbook-order.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = fs.realpathSync(os.tmpdir());

// ---------- the command check reads every word ----------
test("git branch only counts as read-only when it lists", () => {
  for (const c of ["git branch", "git branch -a", "git branch -v", "git branch --list feat*", "git branch --show-current"]) assert.equal(isReadOnlyCommand(c), true, c);
  for (const c of ["git branch review-fixture", "git branch -D review-fixture", "git branch -d x", "git branch -m a b", "git branch --delete x", "git branch -f main HEAD~3", "git branch -a -D x"]) assert.equal(isReadOnlyCommand(c), false, c);
});

test("git log/diff/show/remote only take flags that read", () => {
  for (const c of ["git log --oneline -5", "git log -n 5", "git diff --stat", "git show HEAD~1 --stat", "git remote -v", "git status --porcelain"]) assert.equal(isReadOnlyCommand(c), true, c);
  for (const c of ["git log --output=x", "git diff --ext-diff", "git diff --output x", "git remote add x y", "git remote remove origin", "git show --textconv x", "git status %USERPROFILE%"]) assert.equal(isReadOnlyCommand(c), false, c);
});

test("a hand-over can only open a sign-in", () => {
  for (const c of ["gh auth login", "vercel login", "npx vercel login", "supabase login", "npm login"]) assert.equal(isLoginCommand(c), true, c);
  for (const c of ["npm install evil", "git push --force", "vercel --prod", "gh auth login & del x", "claude", "npx evil login"]) assert.equal(isLoginCommand(c), false, c);
});

// ---------- runbook order ----------
const st = (id, kind, status, more = {}) => ({ id, kind, status, label: id, ...more });
test("a failed step holds the steps after it", () => {
  const m = nextMove([st("a", "run_command", "failed"), st("b", "git_commit_push", "todo")]);
  assert.equal(m.do, "hold_failed");
  assert.equal(m.step.id, "a");
});
test("an optional failed step doesn't hold the rest", () => {
  assert.equal(nextMove([st("a", "run_command", "failed", { optional: true }), st("b", "run_command", "todo")]).do, "run");
});
test("a running job holds the next step unless it's independent", () => {
  assert.equal(nextMove([st("a", "start_job", "running"), st("b", "delete_folder", "todo")]).do, "wait_job");
  assert.equal(nextMove([st("a", "start_job", "running", { independent: true }), st("b", "open_link", "todo")]).do, "run");
});
test("a hand-over waiting on Thomas holds everything; a soft one doesn't", () => {
  assert.equal(nextMove([st("a", "handoff", "waiting"), st("b", "run_command", "todo")]).do, "wait_you");
  assert.equal(nextMove([st("a", "handoff", "waiting", { blocking: false }), st("b", "run_command", "todo")]).do, "run");
  assert.equal(nextMove([st("a", "run_command", "done")]).do, "finish");
});

// ---------- the guard ----------
const guard = (tool_name, tool_input, env = {}) => spawnSync(process.execPath, [path.join(ROOT, "scripts", "guard.mjs")], {
  input: JSON.stringify({ tool_name, tool_input, cwd: ROOT }), env: { ...process.env, ...env }, encoding: "utf8",
}).status;

test("guard blocks inline code, reading the environment and calling MyManager directly", () => {
  for (const c of [
    "node -e \"require('fs').writeFileSync('../x','y')\"", "node --eval x", "python -c \"open('../x','w')\"", "py -c 1",
    "powershell -c whoami", "pwsh -Command ls", "node -p process.env", "printenv", "set", "env",
    "curl http://127.0.0.1:3000/api/bot", "curl -X POST localhost:3001/actions", "npx tsx fetch-localhost:3000",
    "type C:/Users/tomsc/Documents/MyManager/.env.local",
  ]) assert.equal(guard("Bash", { command: c }), 2, `should block: ${c}`);
  for (const c of ["npm test", "npx tsc -p tsconfig.json", "node scripts/check.js", "git log -p", "python -m pytest"]) assert.equal(guard("Bash", { command: c }), 0, `should allow: ${c}`);
});

test("guard follows links: a link inside the work folder can't be used to write outside it", { skip: process.platform === "win32" }, () => {
  const work = fs.mkdtempSync(path.join(TMP, "mm-work-"));
  const outside = fs.mkdtempSync(path.join(TMP, "mm-out-"));
  fs.symlinkSync(outside, path.join(work, "escape"));
  assert.equal(guard("Write", { file_path: path.join(work, "escape", "x.txt") }, { MANAGER_GUARD_DIR: work }), 2);
  assert.equal(guard("Write", { file_path: path.join(work, "ok.txt") }, { MANAGER_GUARD_DIR: work }), 0);
  assert.equal(guard("Write", { file_path: path.join(work + "-evil", "x.txt") }, { MANAGER_GUARD_DIR: work }), 2);
  fs.rmSync(work, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true });
});

// ---------- workers don't get MyManager's keys; the tool pass can't approve ----------
const tsEval = (code, env = {}) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", code], { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8" });

test("a worker's environment has none of MyManager's keys", () => {
  const r = tsEval(`import { workerEnv } from "./src/lib/worker-env.ts"; console.log(JSON.stringify(workerEnv({ CI: "1" })));`,
    { APP_PASSWORD: "pw", AUTH_SECRET: "s", SUPABASE_SERVICE_ROLE_KEY: "k", TELEGRAM_BOT_TOKEN: "t", MM_FAKE_API_KEY: "synthetic", GITHUB_TOKEN: "g", ANTHROPIC_API_KEY: "a", PATH: process.env.PATH });
  assert.equal(r.status, 0, r.stderr);
  const env = JSON.parse(r.stdout);
  for (const k of ["APP_PASSWORD", "AUTH_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "TELEGRAM_BOT_TOKEN", "MM_FAKE_API_KEY", "GITHUB_TOKEN", "ANTHROPIC_API_KEY"]) assert.equal(env[k], undefined, k);
  assert.ok(env.PATH && env.CI === "1");
});

test("a run's tool pass works only for that run, expires, and isn't the helper key", () => {
  const r = tsEval(`import * as a from "./src/lib/auth.ts";
    const t = await a.toolToken("run-1"); const old = await a.toolToken("run-1", -1000);
    const [id, exp, sig] = t.split(".");
    console.log(JSON.stringify({ ok: await a.checkToolToken(t), expired: await a.checkToolToken(old), forged: await a.checkToolToken(id + "." + exp + "." + "0".repeat(64)),
      otherRun: await a.checkToolToken("run-2." + exp + "." + sig), isKey: t === (await a.managerKey()) || sig === (await a.managerKey()) }));`,
    { APP_PASSWORD: "pw", AUTH_SECRET: "s" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { ok: "run-1", expired: null, forged: null, otherRun: null, isKey: false });
});

test("the tool pass is only accepted by the tool route; approvals need the helper key or the login", () => {
  const mw = fs.readFileSync(path.join(ROOT, "src", "middleware.ts"), "utf8");
  assert.match(mw, /\["\/api\/bot", "\/api\/proactive", "\/api\/agent"\]\.includes\(pathname\) && sameText\(req\.headers\.get\("x-manager-key"\)/);
  const bot = fs.readFileSync(path.join(ROOT, "src", "app", "api", "bot", "route.ts"), "utf8");
  assert.doesNotMatch(bot, /x-manager-tool|checkToolToken/);
  const cc = fs.readFileSync(path.join(ROOT, "src", "lib", "agent", "claude-code.ts"), "utf8");
  assert.doesNotMatch(cc, /managerKey/);
  assert.match(cc, /MANAGER_TOOL_TOKEN: await toolToken\(id\)/);
});

// ---------- the database: key check, row-level security and the spend cap under pressure ----------
let dbProc, dbDir, base;
const KEY = crypto.randomBytes(16).toString("hex");
const call = (p, init = {}) => fetch(`${base}/${p}`, { ...init, headers: { "Content-Type": "application/json", apikey: KEY, ...(init.headers ?? {}) } });
const rpc = (fn, args) => call(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) }).then(async (r) => { if (!r.ok) throw new Error(await r.text()); return r.json(); });

before(async () => {
  dbDir = fs.mkdtempSync(path.join(TMP, "mm-db-"));
  const port = 39000 + Math.floor(Math.random() * 2000);
  base = `http://127.0.0.1:${port}`;
  dbProc = spawn(process.execPath, [path.join(ROOT, "scripts", "dev-rest.mjs")], { env: { ...process.env, LOCALDB_DIR: path.join(dbDir, "db"), LOCALDB_BACKUPS: path.join(dbDir, "backups"), PORT_DB: String(port), SUPABASE_SERVICE_ROLE_KEY: KEY }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    let out = "";
    const t = setTimeout(() => reject(new Error(`database didn't start: ${out}`)), 90_000);
    const on = (d) => { out += d; if (out.includes("database ready")) { clearTimeout(t); resolve(); } };
    dbProc.stdout.on("data", on); dbProc.stderr.on("data", on);
    dbProc.on("exit", (c) => { clearTimeout(t); reject(new Error(`database exited ${c}: ${out}`)); });
  });
});
after(() => { dbProc?.kill(); try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch { /* windows may hold it briefly */ } });

const paid = (cost, title = "Buy a thing") => rpc("mm_queue_paid_action", { p_kind: "purchase", p_title: title, p_reason: null, p_payload: {}, p_cost: cost, p_project: null, p_requested_by: "agent" });
const reset = async () => { await call("actions?cost_cents=gt.0", { method: "DELETE" }); await call("settings?id=eq.1", { method: "PATCH", body: JSON.stringify({ per_purchase_cap_cents: 5000, monthly_cap_cents: 20000 }) }); };

test("the database refuses requests without its key", async () => {
  assert.equal((await fetch(`${base}/actions`)).status, 401);
  assert.equal((await fetch(`${base}/actions`, { headers: { apikey: "local" } })).status, 401);
  assert.equal((await call("actions?limit=1")).status, 200);
});

test("runbook tables have row-level security like the rest", async () => {
  const sql = fs.readFileSync(path.join(ROOT, "supabase", "migrations", "0020_review_fixes.sql"), "utf8");
  assert.match(sql, /alter table runbooks enable row level security/);
  assert.match(sql, /alter table runbook_log enable row level security/);
  const all = fs.readdirSync(path.join(ROOT, "supabase", "migrations")).map((f) => fs.readFileSync(path.join(ROOT, "supabase", "migrations", f), "utf8")).join("\n");
  const tables = [...all.matchAll(/create table (?:if not exists )?([a-z_]+)/gi)].map((m) => m[1]);
  for (const t of tables) assert.match(all, new RegExp(`alter table ${t} enable row level security`), `${t} needs row-level security`);
  // and in a freshly migrated database
  const rows = await (await call("pg_class?select=relname,relrowsecurity&relname=in.(runbooks,runbook_log)")).json();
  assert.equal(rows.length, 2);
  for (const r of rows) assert.equal(r.relrowsecurity, true, r.relname);
});

test("five $50 requests at once can't reserve more than the $200 a month", async () => {
  await reset();
  const rows = (await Promise.all([1, 2, 3, 4, 5].map((i) => paid(5000, `req ${i}`)))).flat();
  const pending = rows.filter((r) => r.status === "pending");
  assert.equal(pending.length, 4);
  assert.equal(rows.filter((r) => r.status === "rejected").length, 1);
  assert.equal(await rpc("mm_budget_used", { p_exclude: null, p_include_pending: true }), 20000);
});

test("approving them all at once can't spend more than the cap, and each runs once", async () => {
  await reset();
  const rows = (await Promise.all([1, 2, 3, 4].map(() => paid(5000)))).flat();
  await call("settings?id=eq.1", { method: "PATCH", body: JSON.stringify({ monthly_cap_cents: 15000 }) }); // he lowered the cap meanwhile
  const claims = (await Promise.all([...rows, ...rows].map((r) => rpc("mm_claim_action", { p_id: r.id, p_approve: true })))).flat();
  assert.equal(claims.length, 4, "each action is claimed exactly once, even when approved twice at once");
  assert.equal(claims.filter((c) => c.status === "approved").length, 3);
  assert.equal(await rpc("mm_budget_used", { p_exclude: null, p_include_pending: false }), 15000);
});

test("saying no releases the money", async () => {
  await reset();
  const [a] = await paid(5000);
  assert.equal(await rpc("mm_budget_used", { p_exclude: null, p_include_pending: true }), 5000);
  await rpc("mm_claim_action", { p_id: a.id, p_approve: false });
  assert.equal(await rpc("mm_budget_used", { p_exclude: null, p_include_pending: true }), 0);
});

test("money counts in the month it was approved, in Melbourne time", async () => {
  await reset();
  const [a] = await paid(5000);
  const [b] = await paid(4000);
  // a was approved last month (Melbourne); b was asked last month but is approved now
  await call(`actions?id=eq.${a.id}`, { method: "PATCH", body: JSON.stringify({ status: "executed", spent_at: new Date(Date.now() - 40 * 86_400_000).toISOString(), created_at: new Date(Date.now() - 40 * 86_400_000).toISOString() }) });
  await call(`actions?id=eq.${b.id}`, { method: "PATCH", body: JSON.stringify({ created_at: new Date(Date.now() - 40 * 86_400_000).toISOString() }) });
  await rpc("mm_claim_action", { p_id: b.id, p_approve: true });
  assert.equal(await rpc("mm_budget_used", { p_exclude: null, p_include_pending: false }), 4000);
  // the month starts at Melbourne midnight, not the server's
  const r = await call("rpc/mm_budget_used", { method: "POST", body: JSON.stringify({}) });
  assert.equal(r.status, 200);
});

test("the database only runs the functions it lists", async () => {
  const r = await call("rpc/pg_sleep", { method: "POST", body: JSON.stringify({ p_seconds: 1 }) });
  assert.equal(r.status, 404);
});

test("two invoices at once can't bill the same hours twice, and numbers never repeat", async () => {
  const [p] = await (await call("projects", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ name: `Invoice test ${Date.now()}`, hourly_rate_cents: 10000 }) })).json();
  await call("time_entries", { method: "POST", body: JSON.stringify([{ project_id: p.id, minutes: 60 }, { project_id: p.id, minutes: 30 }]) });
  const made = (await Promise.all([1, 2, 3].map(() => rpc("mm_create_invoice", { p_project: p.id, p_fixed_cents: 0, p_note: null })))).flat();
  assert.equal(made.length, 1, "only one invoice gets the hours");
  assert.equal(made[0].amount_cents, 15000);
  const fixed = (await Promise.all([1, 2].map(() => rpc("mm_create_invoice", { p_project: p.id, p_fixed_cents: 5000, p_note: "fixed" })))).flat();
  const numbers = [...made, ...fixed].map((i) => i.number);
  assert.equal(new Set(numbers).size, numbers.length, `numbers repeat: ${numbers}`);
});

test("a backup can be brought back, and restoring never overwrites the current database", async () => {
  await call("ideas", { method: "POST", body: JSON.stringify({ text: "backup marker" }) });
  dbProc.kill();
  await new Promise((r) => setTimeout(r, 1500));
  // starting again takes the day's backup (the first start was a fresh database, so there wasn't one yet)
  const env = { ...process.env, LOCALDB_DIR: path.join(dbDir, "db"), LOCALDB_BACKUPS: path.join(dbDir, "backups"), PORT_DB: String(Number(new URL(base).port) + 1), SUPABASE_SERVICE_ROLE_KEY: KEY };
  const start = (e, args = []) => new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, "scripts", "dev-rest.mjs"), ...args], { env: e, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const on = (d) => { out += d; if (out.includes("database ready")) resolve({ p, out }); };
    p.stdout.on("data", on); p.stderr.on("data", on);
    p.on("exit", (code) => resolve({ p, out, code }));
  });
  const second = await start(env);
  assert.match(second.out, /backed up the database/);
  second.p.kill();
  await new Promise((r) => setTimeout(r, 1500));
  const file = path.join(dbDir, "backups", fs.readdirSync(path.join(dbDir, "backups")).find((f) => f.endsWith(".tar.gz")));
  const refused = await start(env, ["--restore", file]);
  assert.equal(refused.code, 1, "won't restore over an existing database");
  const env2 = { ...env, LOCALDB_DIR: path.join(dbDir, "restored"), PORT_DB: String(Number(env.PORT_DB) + 1) };
  const restored = await start(env2, ["--restore", file]);
  try {
    const r = await fetch(`http://127.0.0.1:${env2.PORT_DB}/ideas?text=eq.backup%20marker`, { headers: { apikey: KEY } });
    assert.equal((await r.json()).length, 1);
  } finally { restored.p.kill(); }
});
