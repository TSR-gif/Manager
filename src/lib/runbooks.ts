import "server-only";
import { commandProblem, isReadOnlyCommand } from "@/lib/command-safety.mjs";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { db } from "@/lib/db";
import { notify } from "@/lib/notify";
import { allProcesses } from "@/lib/activity";

/**
 * Runbooks: a list of steps MyManager carries out on Thomas's PC and watches.
 * - Nothing runs until Thomas approves the whole list (action "runbook.run").
 * - Deleting a folder and any command that can create accounts, cost money or change settings asks again at that step.
 * - Sign-ins are handed to Thomas: MyManager opens the page or a sign-in window, he types the password, then presses Done.
 *   It never stores or types passwords.
 */
const run = promisify(execFile);
const isWin = process.platform === "win32";

export type StepKind = "start_job" | "watch_process" | "stop_process" | "git_commit_push" | "delete_folder" | "open_link" | "handoff" | "run_command";
export interface Step {
  id: string;
  kind: StepKind;
  label: string;
  optional?: boolean;
  /** start_job / run_command: a file in the project folder (start_job) or a command line (run_command / handoff) */
  file?: string; command?: string;
  /** start_job: how long it normally takes */
  expect_hours?: number;
  /** stop_process: text that identifies the program (e.g. run_queue) */
  match?: string;
  /** git_commit_push */
  message?: string;
  /** delete_folder: path inside the project folder */
  path?: string;
  /** open_link / handoff */
  url?: string; text?: string;
  /** handoff: false = doesn't hold up the rest (e.g. "sign in if asked") */
  blocking?: boolean;
  status: "todo" | "running" | "waiting" | "done" | "skipped" | "failed";
  note?: string;
  started_at?: string; finished_at?: string;
  pid?: number; log?: string; exit_code?: number | null; warned?: string;
  approval_id?: string;
}
export interface Runbook {
  id: string; project_id: string | null; title: string; work_dir: string | null;
  status: "draft" | "queued" | "running" | "waiting" | "done" | "stopped" | "failed";
  steps: { list: Step[] }; last_update: string | null; created_at: string; started_at: string | null; finished_at: string | null;
}

const LOG_DIR = path.join(process.cwd(), ".localdb-logs");
const SECRET = /(^|[\\/])\.env|\.env$|secret|credential|\.pem$|\.key$|keys?\.(json|txt)$/i;
const BULKY = /(^|\/)(\.?venv[^/]*|node_modules|__pycache__|\.next|dist|build)(\/|$)/i;

export async function logRunbook(id: string, text: string) {
  await db().from("runbook_log").insert({ runbook_id: id, text: text.slice(0, 2000) });
}
async function save(r: Runbook, extra: Partial<Runbook> = {}) {
  Object.assign(r, extra);
  await db().from("runbooks").update({ steps: r.steps, status: r.status, last_update: r.last_update, started_at: r.started_at, finished_at: r.finished_at }).eq("id", r.id);
}
const now = () => new Date().toISOString();
const alive = (pid?: number) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };
const inside = (base: string, rel: string) => {
  const full = path.resolve(base, rel);
  const b = path.resolve(base);
  return full !== b && full.toLowerCase().startsWith((b + path.sep).toLowerCase()) ? full : null;
};

/** Checks a drafted list before Thomas sees it. Returns problems in plain words. */
export function checkSteps(steps: Step[], dir: string | null): string[] {
  const out: string[] = [];
  for (const s of steps) {
    const needDir = ["start_job", "stop_process", "git_commit_push", "delete_folder"].includes(s.kind);
    if (needDir && !dir) out.push(`"${s.label}" needs the project's folder on this PC.`);
    if (s.kind === "start_job" && dir && (!s.file || !inside(dir, s.file) || !fs.existsSync(inside(dir, s.file)!))) out.push(`"${s.label}": couldn't find ${s.file} in ${dir}.`);
    if (s.kind === "start_job" && s.file && !/\.(bat|cmd|py|ps1|sh)$/i.test(s.file)) out.push(`"${s.label}": only .bat, .cmd, .py, .ps1 or .sh files can be started.`);
    if (s.kind === "delete_folder" && dir && (!s.path || !inside(dir, s.path) || /(^|[\\/])\.git([\\/]|$)/.test(s.path))) out.push(`"${s.label}": can only delete a folder inside the project (never the project itself or .git).`);
    if ((s.kind === "run_command" || (s.kind === "handoff" && s.command)) && commandProblem(s.command)) out.push(`"${s.label}": ${commandProblem(s.command)}`);
    if (s.kind === "stop_process" && !(s.match ?? "").trim()) out.push(`"${s.label}": say which program to close.`);
    if (/password|card number|cvv|2fa code/i.test(`${s.command ?? ""} ${s.text ?? ""}`) && s.kind !== "handoff") out.push(`"${s.label}": passwords and card details are never typed by MyManager. Make it a hand-over step.`);
  }
  return out;
}

export function stepSummary(s: Step) {
  const opt = s.optional ? " (optional, asks first)" : "";
  switch (s.kind) {
    case "watch_process": return `Watch ${s.match} (already running) and tell you when it finishes or stalls`;
    case "start_job": return `Start ${s.file}${s.expect_hours ? `, about ${s.expect_hours} h` : ""}, keep the PC awake and watch it${opt}`;
    case "stop_process": return `Close ${s.match} if it's running${opt}`;
    case "git_commit_push": return `Commit everything new (skipping key files and venv folders) and push to GitHub${opt}`;
    case "delete_folder": return `Delete the folder ${s.path} (asks you again first)`;
    case "open_link": return `Open ${s.url} for you${opt}`;
    case "handoff": return `Hand over to you: ${s.text ?? s.label}${s.command ? ` (opens a window running \`${s.command}\`)` : ""}${s.blocking === false ? " (only if needed)" : ""}`;
    case "run_command": return `Run \`${s.command}\`${isReadOnlyCommand(s.command) ? "" : " (asks you again first)"}${opt}`;
  }
}

/** Make a draft and put "run it" in Approvals. */
export async function draftRunbook(input: { project_id: string | null; work_dir: string | null; title: string; steps: Omit<Step, "id" | "status">[] }) {
  const steps: Step[] = input.steps.map((s, i) => ({ ...s, id: `s${i + 1}`, status: "todo" }));
  const problems = checkSteps(steps, input.work_dir);
  if (problems.length) return { ok: false as const, problems };
  const { data: r } = await db().from("runbooks").insert({ project_id: input.project_id, title: input.title, work_dir: input.work_dir, steps: { list: steps }, status: "queued", last_update: "Waiting for your OK" }).select().single();
  const a = await askApproval({
    kind: "runbook.run", title: `Run on your PC: ${input.title}`, project_id: input.project_id,
    reason: steps.map((s, i) => `${i + 1}. ${stepSummary(s)}`).join("\n"), payload: { runbook_id: r.id, folder: input.work_dir },
  });
  return { ok: true as const, id: r.id as string, action: a.id };
}

/** Called when Thomas approves the whole runbook. */
export async function startRunbook(id: string) {
  const { data } = await db().from("runbooks").select("*").eq("id", id).maybeSingle();
  const r = data as Runbook | null;
  if (!r) throw new Error("Runbook not found");
  if (!["queued", "draft", "stopped", "failed"].includes(r.status)) return { note: `Already ${r.status}` };
  await save(r, { status: "running", started_at: r.started_at ?? now(), last_update: "Started" });
  await logRunbook(id, "Thomas approved it. Starting.");
  void notify(`▶️ Started: **${r.title}**. I'll tell you when something needs you.`);
  ensureLoop();
  void advance(id);
  return { note: "Started" };
}

export async function stopRunbook(id: string) {
  const { data } = await db().from("runbooks").select("*").eq("id", id).maybeSingle();
  const r = data as Runbook | null;
  if (!r) return;
  for (const s of r.steps.list) if (s.status === "todo" || s.status === "waiting") s.status = "skipped";
  await save(r, { status: "stopped", finished_at: now(), last_update: "Stopped by you. Jobs already started keep running." });
  await logRunbook(id, "Stopped by Thomas. Anything already started keeps running.");
}

/** Thomas pressed Done / Not needed on a hand-over step, or a step's own approval was decided. */
export async function resolveStep(id: string, stepId: string, outcome: "done" | "skipped" | "approved" | "rejected") {
  const { data } = await db().from("runbooks").select("*").eq("id", id).maybeSingle();
  const r = data as Runbook | null;
  const s = r?.steps.list.find((x) => x.id === stepId);
  if (!r || !s) return;
  if (outcome === "approved") { s.status = "todo"; s.note = "approved"; }
  else if (outcome === "rejected") { s.status = "skipped"; s.note = "You said no, so I skipped it."; s.finished_at = now(); }
  else if (outcome === "done" && s.kind !== "handoff") { s.status = "todo"; s.blocking = undefined; s.note = "You fixed it, trying again."; }
  else { s.status = outcome; s.finished_at = now(); s.note = outcome === "done" ? "You did this." : "Not needed."; }
  if (r.status === "waiting") r.status = "running";
  await save(r);
  await logRunbook(id, `${s.label}: ${s.note}`);
  void advance(id);
}

const advancing = new Set<string>();
/** Run the next steps until one has to wait. Safe to call often. */
export async function advance(id: string): Promise<void> {
  if (advancing.has(id)) return;
  advancing.add(id);
  try {
    for (let guard = 0; guard < 20; guard++) {
      const { data } = await db().from("runbooks").select("*").eq("id", id).maybeSingle();
      const r = data as Runbook | null;
      if (!r || !["running", "waiting"].includes(r.status)) return;
      await watchJobs(r);
      const list = r.steps.list;
      const blocked = list.find((s) => s.status === "waiting" && s.blocking !== false);
      if (blocked) { if (r.status !== "waiting") await save(r, { status: "waiting", last_update: `Waiting on you: ${blocked.label}` }); return; }
      const next = list.find((s) => s.status === "todo");
      if (!next) {
        const jobs = list.filter((s) => (s.kind === "start_job" || s.kind === "watch_process") && s.status === "running");
        const softWaiting = list.filter((s) => s.status === "waiting");
        if (jobs.length) { await save(r, { status: "running", last_update: `All steps done. Watching ${jobs.map((j) => j.file).join(", ")}.` }); return; }
        for (const s of softWaiting) { s.status = "skipped"; s.note = "Wasn't needed."; }
        const failed = list.filter((s) => s.status === "failed");
        await save(r, { status: failed.length ? "failed" : "done", finished_at: now(), last_update: failed.length ? `Finished, but ${failed.length} step${failed.length > 1 ? "s" : ""} didn't work: ${failed.map((f) => f.label).join("; ")}` : "All done." });
        await logRunbook(id, failed.length ? "Finished with problems." : "All done.");
        void notify(failed.length ? `⚠️ **${r.title}** finished, but ${failed.map((f) => `"${f.label}"`).join(", ")} didn't work. Details are on the Running screen.` : `✅ **${r.title}** is done.`);
        return;
      }
      await doStep(r, next);
      await save(r);
      if (next.status === "waiting" && next.blocking !== false) continue; // loop sees it and stops
    }
  } catch (e) {
    await logRunbook(id, `Something went wrong: ${String(e).slice(0, 300)}`);
  } finally {
    advancing.delete(id);
  }
}

/** Always a pending approval: runbooks never go through the trust ladder. Works outside a page request too. */
async function askApproval(input: { kind: string; title: string; reason: string; project_id: string | null; payload: Record<string, unknown> }) {
  const { data } = await db().from("actions").insert({ ...input, cost_cents: 0, risk: "approval", requested_by: "agent", status: "pending" }).select().single();
  return data as { id: string };
}

async function needsOk(r: Runbook, s: Step, why: string) {
  if (s.note === "approved") return false;
  if (s.approval_id) { s.status = "waiting"; return true; }
  const a = await askApproval({ kind: "runbook.step", title: `${s.label}`, reason: `${why}\nPart of "${r.title}".`, project_id: r.project_id, payload: { runbook_id: r.id, step_id: s.id } });
  s.approval_id = a.id; s.status = "waiting"; s.note = "Waiting for your OK in Approvals";
  await logRunbook(r.id, `${s.label}: asked for your OK.`);
  void notify(`✋ **${r.title}** needs your OK for: ${s.label}. It's in Approvals.`);
  return true;
}

async function doStep(r: Runbook, s: Step) {
  const dir = r.work_dir ?? "";
  s.started_at = now();
  try {
    switch (s.kind) {
      case "watch_process": {
        const procs = (await allProcesses()) ?? [];
        const m = (s.match ?? "").toLowerCase();
        const hits = procs.filter((p) => p.cmd.toLowerCase().includes(m) && p.pid !== process.pid && !/get-ciminstance/i.test(p.cmd));
        if (!hits.length) { s.status = "done"; s.note = "It isn't running (already finished, or not started yet)."; break; }
        // follow the top-most one (the window), and the newest matching log if one was named
        const top = hits.find((h) => /cmd\.exe|^sh$|bash/i.test(h.name)) ?? hits[0];
        s.pid = top.pid; s.status = "running";
        if (s.file && dir && inside(dir, s.file)) s.log = inside(dir, s.file)!;
        s.started_at = top.started ?? s.started_at;
        s.note = `Watching ${top.name} (started ${top.started ? new Date(top.started).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" }) : "earlier"}). ${keepAwake(top.pid)}`;
        await logRunbook(r.id, `Watching ${s.match}: ${top.cmd.slice(0, 160)}`);
        return;
      }
      case "start_job": {
        if (s.optional && (await needsOk(r, s, "This step is optional."))) return;
        const file = inside(dir, s.file!)!;
        fs.mkdirSync(LOG_DIR, { recursive: true });
        const log = path.join(LOG_DIR, `${r.id.slice(0, 8)}-${s.id}.log`);
        const fd = fs.openSync(log, "a");
        const ext = path.extname(file).toLowerCase();
        const [cmd, args] = isWin
          ? ext === ".py" ? ["py", ["-u", file]] : ext === ".ps1" ? ["powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file]] : ["cmd.exe", ["/d", "/c", file]]
          : ext === ".py" ? ["python3", ["-u", file]] : ["sh", [file]];
        const child = spawn(cmd, args as string[], { cwd: path.dirname(file), detached: true, windowsHide: true, stdio: ["ignore", fd, fd], env: { ...process.env, PYTHONUNBUFFERED: "1" } });
        fs.closeSync(fd);
        child.on("exit", (code) => { exits.set(child.pid ?? -1, code); });
        child.unref();
        s.pid = child.pid; s.log = log; s.status = "running";
        s.note = `Started. ${keepAwake(child.pid)}`;
        await logRunbook(r.id, `Started ${s.file} (it normally takes ${s.expect_hours ?? "?"} h). ${s.note}`);
        return;
      }
      case "stop_process": {
        const procs = (await allProcesses()) ?? [];
        const m = s.match!.toLowerCase();
        const dirLow = path.resolve(dir).toLowerCase();
        const hits = procs.filter((p) => {
          const c = p.cmd.toLowerCase();
          return c.includes(m) && (c.includes(dirLow) || fs.readdirSync(dir).some((f) => f.toLowerCase().startsWith(m.split(/[\\/]/).pop()!.replace(/\.(bat|py|cmd)$/, ""))) ) && p.pid !== process.pid;
        });
        if (!hits.length) { s.status = "done"; s.note = "It wasn't running."; break; }
        for (const p of hits) {
          if (isWin) await run("taskkill", ["/PID", String(p.pid), "/T", "/F"], { windowsHide: true }).catch(() => null);
          else { try { process.kill(p.pid, "SIGTERM"); } catch { /* gone */ } }
        }
        s.status = "done"; s.note = `Closed ${hits.length} program${hits.length > 1 ? "s" : ""} (${[...new Set(hits.map((h) => h.name))].join(", ")}).`;
        break;
      }
      case "git_commit_push": {
        if (s.optional && (await needsOk(r, s, "This step is optional."))) return;
        const git = (...a: string[]) => run("git", ["-C", dir, ...a], { timeout: 120_000, maxBuffer: 16 << 20, windowsHide: true }).then((x) => x.stdout);
        const status = await git("status", "--porcelain", "--untracked-files=all");
        const files = status.split("\n").filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, "").split(" -> ").pop()!);
        const secrets = files.filter((f) => SECRET.test(f) && !BULKY.test(f));
        const big = files.filter((f) => !BULKY.test(f)).filter((f) => { try { return fs.statSync(path.join(dir, f)).size > 50 << 20; } catch { return false; } });
        if (secrets.length || big.length) {
          s.status = "waiting"; s.blocking = true;
          s.note = `I didn't commit, because these shouldn't go to GitHub: ${[...secrets, ...big].slice(0, 6).join(", ")}. Add them to .gitignore (or tell me to), then press "Fixed it, try again".`;
          void notify(`✋ **${r.title}**: I stopped before committing. ${s.note}`);
          break;
        }
        if (!files.length) { s.status = "done"; s.note = "Nothing new to commit."; break; }
        await git("add", "-A", "--", ".", ":!*.env", ":!**/*.env", ":!.venv*", ":!**/.venv*", ":!venv", ":!**/node_modules", ":!**/__pycache__");
        const staged = (await git("diff", "--cached", "--name-only")).split("\n").filter(Boolean);
        if (staged.length) await git("commit", "-m", s.message || `Save work (${new Date().toISOString().slice(0, 10)})`);
        const branch = (await git("rev-parse", "--abbrev-ref", "HEAD")).trim();
        const pushed = await git("push", "-u", "origin", branch).then(() => true, (e) => { s.note = `Committed ${staged.length} files, but the push failed: ${String(e.stderr ?? e).slice(0, 200)}`; return false; });
        s.status = pushed ? "done" : "failed";
        if (pushed) s.note = `Committed ${staged.length} file${staged.length === 1 ? "" : "s"} and pushed to ${branch}.`;
        break;
      }
      case "delete_folder": {
        const full = inside(dir, s.path!);
        if (!full) { s.status = "failed"; s.note = "That folder isn't inside the project."; break; }
        if (!fs.existsSync(full)) { s.status = "done"; s.note = "It was already gone."; break; }
        if (await needsOk(r, s, `Deletes ${full}. This can't be undone.`)) return;
        fs.rmSync(full, { recursive: true, force: true, maxRetries: 3 });
        s.status = "done"; s.note = "Deleted.";
        break;
      }
      case "open_link": {
        openThing(s.url!);
        s.status = "done"; s.note = "Opened it on your PC.";
        break;
      }
      case "handoff": {
        if (s.url) openThing(s.url);
        if (s.command) openTerminal(s.command, dir || os.homedir(), s.label);
        s.status = "waiting";
        s.note = s.blocking === false ? "Only if needed. Press Done or Not needed." : "Your turn. Press Done when you've finished.";
        void notify(`🙋 **${r.title}**: ${s.text ?? s.label}${s.url || s.command ? " I've opened it on your PC." : ""} Press Done in MyManager when you've finished.`);
        await logRunbook(r.id, `Handed over to Thomas: ${s.label}`);
        return;
      }
      case "run_command": {
        const c = (s.command ?? "").trim();
        const bad = commandProblem(c);
        if (bad) {
          s.status = "failed"; s.note = `Not run: ${bad}`;
          await logRunbook(r.id, `Refused to run \`${c}\`: ${bad}`);
          break;
        }
        if (!isReadOnlyCommand(c) && (await needsOk(r, s, `Runs \`${c}\` on your PC. It may create something or change a setting.`))) return;
        const out = await run(isWin ? "cmd.exe" : "sh", isWin ? ["/d", "/c", c] : ["-c", c], { cwd: dir || os.homedir(), timeout: 10 * 60_000, maxBuffer: 16 << 20, windowsHide: true })
          .then((x) => ({ ok: true, text: `${x.stdout}${x.stderr}` }), (e) => ({ ok: false, text: `${e.stdout ?? ""}${e.stderr ?? e.message ?? e}` }));
        s.status = out.ok ? "done" : "failed";
        s.note = out.text.trim().split(/\r?\n/).slice(-6).join(" / ").slice(0, 600) || (out.ok ? "Done." : "It failed.");
        break;
      }
    }
  } catch (e) {
    s.status = "failed"; s.note = String((e as Error).message ?? e).slice(0, 300);
  }
  if (["done", "failed", "skipped"].includes(s.status as string)) s.finished_at = now();
  await logRunbook(r.id, `${s.label}: ${s.note ?? s.status}`);
}

const exits = ((globalThis as unknown as { __mmExits?: Map<number, number | null> }).__mmExits ??= new Map());

/** Keep the PC from going to sleep while the job runs. Uses the same switch video players use; no settings change. */
function keepAwake(pid?: number) {
  if (!pid) return "";
  if (!isWin) return "";
  const ps = `$t = Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);' -Name P -Namespace MM -PassThru; $null = $t::SetThreadExecutionState([uint32]2147483649); Wait-Process -Id ${pid} -ErrorAction SilentlyContinue`;
  spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], { detached: true, windowsHide: true, stdio: "ignore" }).on("error", () => {}).unref();
  return "The PC won't go to sleep until it finishes.";
}

function openThing(target: string) {
  if (!/^https:\/\//i.test(target)) return;
  if (isWin) spawn("cmd.exe", ["/d", "/c", "start", "", target], { detached: true, windowsHide: true, stdio: "ignore" }).on("error", () => {}).unref();
  else spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
}

/** A visible window running a sign-in command (e.g. `vercel login`) so Thomas can finish it himself. */
function openTerminal(command: string, cwd: string, title: string) {
  if (commandProblem(command)) return;
  if (isWin) spawn("cmd.exe", ["/d", "/c", "start", `"${title.replace(/"/g, "")}"`, "cmd.exe", "/k", command], { cwd, detached: true, stdio: "ignore", windowsVerbatimArguments: false }).on("error", () => {}).unref();
}

function tail(file?: string, n = 3) {
  if (!file) return "";
  try {
    const st = fs.statSync(file);
    const len = Math.min(st.size, 16 * 1024);
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    return buf.toString("utf8").split(/\r?\n/).filter((l) => l.trim()).slice(-n).join("\n");
  } catch { return ""; }
}
export const jobTail = tail;

/** Watch running jobs: finished? quiet for too long? taking longer than usual? */
async function watchJobs(r: Runbook) {
  let changed = false;
  for (const s of r.steps.list.filter((x) => (x.kind === "start_job" || x.kind === "watch_process") && x.status === "running")) {
    const started = new Date(s.started_at ?? now()).getTime();
    const hours = (Date.now() - started) / 3600_000;
    if (!alive(s.pid)) {
      const code = exits.get(s.pid ?? -1);
      s.exit_code = code ?? null;
      const last = tail(s.log, 3);
      const bad = (code != null && code !== 0) || /traceback|error|failed/i.test(last);
      s.status = bad ? "failed" : "done"; s.finished_at = now();
      s.note = `${bad ? "Stopped with a problem" : "Finished"} after ${hours < 1 ? `${Math.round(hours * 60)} min` : `${hours.toFixed(1)} h`}.${last ? ` Last lines: ${last.replace(/\n/g, " / ").slice(0, 300)}` : ""}`;
      await logRunbook(r.id, `${s.file}: ${s.note}`);
      void notify(`${bad ? "⚠️" : "✅"} **${s.file}** ${s.note}`);
      changed = true;
      continue;
    }
    let quietMin = 0;
    try { quietMin = (Date.now() - fs.statSync(s.log!).mtimeMs) / 60_000; } catch { /* no log yet */ }
    if (quietMin > 45 && s.warned !== "quiet") {
      s.warned = "quiet"; changed = true;
      void notify(`👀 **${s.file}** is still running but hasn't printed anything for ${Math.round(quietMin)} minutes. It may just be busy. I'll keep watching.`);
      await logRunbook(r.id, `${s.file}: no output for ${Math.round(quietMin)} min.`);
    }
    if (s.expect_hours && hours > s.expect_hours * 1.5 && s.warned !== "long") {
      s.warned = "long"; changed = true;
      void notify(`⏱ **${s.file}** has been running ${hours.toFixed(1)} h, longer than the usual ${s.expect_hours} h. Still going; I'll keep watching.`);
    }
    const last = tail(s.log, 1);
    if (last && s.note !== `Running ${hours.toFixed(1)} h. Latest: ${last.slice(0, 160)}`) { s.note = `Running ${hours < 1 ? `${Math.round(hours * 60)} min` : `${hours.toFixed(1)} h`}. Latest: ${last.slice(0, 160)}`; changed = true; }
  }
  if (changed) await save(r);
}

/** Every 30 seconds while anything is running (also kicked from the 5-minute tick). */
export function ensureLoop() {
  const g = globalThis as unknown as { __mmRunbookLoop?: NodeJS.Timeout };
  if (g.__mmRunbookLoop) return;
  g.__mmRunbookLoop = setInterval(() => { void runDueRunbooks(); }, 30_000);
  g.__mmRunbookLoop.unref?.();
}

export async function runDueRunbooks() {
  const { data } = await db().from("runbooks").select("id,status").in("status", ["running", "waiting"]);
  for (const r of (data ?? []) as { id: string }[]) await advance(r.id);
  if ((data ?? []).length) ensureLoop();
}

/** Watch something Thomas started himself. Read-only (plus keeping the PC awake), so it starts straight away, no approval. */
export async function watchJob(input: { project_id: string | null; work_dir: string | null; match: string; log?: string; expect_hours?: number; title?: string }) {
  const step: Step = { id: "s1", kind: "watch_process", label: `Watch ${input.match}`, match: input.match, file: input.log, expect_hours: input.expect_hours, status: "todo" };
  const { data: r } = await db().from("runbooks").insert({ project_id: input.project_id, title: input.title ?? `Watching ${input.match}`, work_dir: input.work_dir, steps: { list: [step] }, status: "running", started_at: now(), last_update: "Looking for it" }).select().single();
  ensureLoop();
  await advance(r.id);
  const { data: after } = await db().from("runbooks").select("steps,last_update").eq("id", r.id).single();
  return (after as Runbook).steps.list[0];
}
