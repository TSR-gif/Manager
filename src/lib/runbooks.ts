import "server-only";
import { commandProblem, isLoginCommand, isReadOnlyCommand } from "@/lib/command-safety.mjs";
import { checkSignIn, signInService } from "@/lib/services";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { db } from "@/lib/db";
import { notify } from "@/lib/notify";
import { allProcesses } from "@/lib/activity";
import { workerEnv } from "@/lib/worker-env";
import { nextMove } from "@/lib/runbook-order.mjs";

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
  /** start_job / watch_process: true = later steps don't wait for this job to finish. By default they wait. */
  independent?: boolean;
  /** How it really ended, when that's known: finished (exit 0), failed, interrupted (stopped with no exit code),
   *  not_found (watch: it wasn't running), unverified (it stopped, but nothing says how). */
  outcome?: "finished" | "failed" | "interrupted" | "not_found" | "unverified";
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
/** Saves the runbook. Unless force is set it only saves while it's still running or waiting, so the runner can't
 *  undo a Stop that Thomas pressed while a step was going. Returns false when it was stopped meanwhile. */
async function save(r: Runbook, extra: Partial<Runbook> = {}, force = false) {
  Object.assign(r, extra);
  let q = db().from("runbooks").update({ steps: r.steps, status: r.status, last_update: r.last_update, started_at: r.started_at, finished_at: r.finished_at }).eq("id", r.id);
  if (!force) q = q.in("status", ["running", "waiting"]);
  const { data, error } = await q.select("id");
  if (error) throw new Error(`Couldn't save the runbook: ${error.message}`);
  return (data ?? []).length > 0;
}
/** True while the runbook may still do things (checked right before every step that changes something). */
async function stillOn(id: string) {
  const { data } = await db().from("runbooks").select("status").eq("id", id).maybeSingle();
  return !!data && ["running", "waiting"].includes(data.status as string);
}
const now = () => new Date().toISOString();
const alive = (pid?: number) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };
/** The real path (links and junctions followed) of rel inside base, or null if it would land outside base. */
const realish = (p: string) => {
  let cur = path.resolve(p);
  const rest: string[] = [];
  while (!fs.existsSync(cur)) { const up = path.dirname(cur); if (up === cur) break; rest.unshift(path.basename(cur)); cur = up; }
  try { cur = fs.realpathSync.native(cur); } catch { /* keep */ }
  return path.join(cur, ...rest);
};
const inside = (base: string, rel: string) => {
  if (!base || !rel) return null;
  const full = path.resolve(base, rel);
  const r = path.relative(realish(base), realish(full));
  return r && !r.startsWith("..") && !path.isAbsolute(r) ? full : null;
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
    else if (s.kind === "handoff" && s.command && !isLoginCommand(s.command)) out.push(`"${s.label}": a hand-over can only open a sign-in (gh auth login, vercel login, supabase login, npm login). Make "${s.command}" a run_command step so it asks first.`);
    if (s.kind === "stop_process" && !(s.match ?? "").trim()) out.push(`"${s.label}": say which program to close.`);
    if (/password|card number|cvv|2fa code/i.test(`${s.command ?? ""} ${s.text ?? ""}`) && s.kind !== "handoff") out.push(`"${s.label}": passwords and card details are never typed by MyManager. Make it a hand-over step.`);
  }
  return out;
}

export function stepSummary(s: Step) {
  const opt = s.optional ? " (optional, asks first)" : "";
  switch (s.kind) {
    case "watch_process": return `Watch ${s.match} (already running) and tell you when it finishes or stalls`;
    case "start_job": return `Start ${s.file}${s.expect_hours ? `, about ${s.expect_hours} h` : ""}, keep the PC awake and watch it${s.independent ? " (the next steps don't wait for it)" : " (the next steps wait until it finishes)"}${opt}`;
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
  await save(r, { status: "running", started_at: r.started_at ?? now(), last_update: "Started" }, true);
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
  await save(r, { status: "stopped", finished_at: now(), last_update: "Stopped by you. Jobs already started keep running." }, true);
  await logRunbook(id, "Stopped by Thomas. Anything already started keeps running.");
}

/** Thomas pressed Done / Not needed on a hand-over step, or a step's own approval was decided. */
export async function resolveStep(id: string, stepId: string, outcome: "done" | "skipped" | "approved" | "rejected") {
  const { data } = await db().from("runbooks").select("*").eq("id", id).maybeSingle();
  const r = data as Runbook | null;
  const s = r?.steps.list.find((x) => x.id === stepId);
  if (!r || !s) return;
  if (!["running", "waiting"].includes(r.status)) return; // stopped or finished: nothing more happens
  const verified = outcome === "done" && s.kind === "handoff" && s.command ? await checkSignIn(s.command) : null;
  if (outcome === "approved") { s.status = "todo"; s.note = "approved"; }
  else if (outcome === "rejected") { s.status = "skipped"; s.note = "You said no, so I skipped it."; s.finished_at = now(); }
  else if (outcome === "done" && verified === false) {
    // "Done" on a sign-in counts only once it really works. If it doesn't, open the sign-in again (window, then link).
    s.status = "todo"; s.url = undefined;
    s.note = `${signInService(s.command!) ?? "It"} still says MyManager isn't signed in, so I'm opening the sign-in again.`;
  }
  else if (outcome === "done" && s.kind !== "handoff") { s.status = "todo"; s.blocking = undefined; s.approval_id = undefined; s.outcome = undefined; s.note = "You fixed it, trying again."; }
  else { s.status = outcome; s.finished_at = now(); s.note = outcome !== "done" ? "Not needed." : verified ? `Signed in to ${signInService(s.command!) ?? "it"}. I checked, it works.` : "You did this."; }
  if (r.status === "waiting") r.status = "running";
  await save(r);
  await logRunbook(id, `${s.label}: ${s.note}`);
  void advance(id);
}

const advancing = new Set<string>();
const isJob = (s: Step) => s.kind === "start_job" || s.kind === "watch_process";
/** Run the next steps until one has to wait. Safe to call often.
 *  Steps run in order and each waits for the one before it: a step that failed stops the ones after it (Thomas can
 *  try it again, skip it, or stop), and a running job holds up the next step unless it was marked independent. */
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
      const move = nextMove(list);
      if (move.do === "wait_you") {
        const msg = `Waiting on you: ${move.step!.label}`;
        if (r.status !== "waiting" || r.last_update !== msg) await save(r, { status: "waiting", last_update: msg });
        return;
      }
      if (move.do === "hold_failed") {
        // A required step failed: hold here and ask Thomas, don't run what depends on it.
        const b = move.step!;
        b.status = "waiting"; b.blocking = true; b.approval_id = undefined;
        b.note = `Didn't work: ${b.note ?? "it failed"}. The steps after it are on hold. Try it again, skip it, or stop.`;
        await save(r, { status: "waiting", last_update: `Stuck at: ${b.label}` });
        void notify(`⚠️ **${r.title}**: "${b.label}" didn't work, so I held the rest. Try again, skip it, or stop, on the Running screen.`);
        await logRunbook(id, `${b.label} failed; holding the steps after it.`);
        return;
      }
      if (move.do === "wait_job") {
        // A job that's still going holds up the next step unless it was marked independent.
        const msg = `Waiting for ${move.step!.file ?? move.step!.match ?? move.step!.label} to finish before: ${move.next!.label}`;
        if (r.status !== "running" || r.last_update !== msg) await save(r, { status: "running", last_update: msg });
        return;
      }
      const next = move.do === "run" ? move.step! : undefined;
      if (!next) {
        const jobs = list.filter((s) => isJob(s) && s.status === "running");
        const softWaiting = list.filter((s) => s.status === "waiting");
        if (jobs.length) { await save(r, { status: "running", last_update: `All steps done. Watching ${jobs.map((j) => j.file ?? j.match).join(", ")}.` }); return; }
        for (const s of softWaiting) { s.status = "skipped"; s.note = "Wasn't needed."; }
        const failed = list.filter((s) => s.status === "failed");
        const unsure = list.filter((s) => s.outcome === "unverified");
        const ok = await save(r, { status: failed.length ? "failed" : "done", finished_at: now(), last_update: failed.length ? `Finished, but ${failed.length} step${failed.length > 1 ? "s" : ""} didn't work: ${failed.map((f) => f.label).join("; ")}` : unsure.length ? `Finished, but I couldn't confirm how ${unsure.map((u) => u.label).join("; ")} ended. Check its log.` : "All done." });
        if (!ok) return;
        await logRunbook(id, failed.length ? "Finished with problems." : unsure.length ? "Finished; some results unconfirmed." : "All done.");
        void import("@/lib/missions").then((m) => m.wakeHelpers("runbook_finished", `${r.title}: ${failed.length ? "finished with problems" : unsure.length ? "finished, not confirmed" : "all done"}`, r.project_id)).catch(() => {});
        void notify(failed.length ? `⚠️ **${r.title}** finished, but ${failed.map((f) => `"${f.label}"`).join(", ")} didn't work. Details are on the Running screen.` : unsure.length ? `☑️ **${r.title}** finished, but I couldn't confirm ${unsure.map((u) => `"${u.label}"`).join(", ")} worked. Check its log.` : `✅ **${r.title}** is done.`);
        return;
      }
      // Stop pressed since this pass began? Then do nothing more.
      if (!(await stillOn(id))) return;
      await doStep(r, next);
      if (!(await save(r))) { await logRunbook(id, `Stopped while "${next.label}" was going; nothing after it runs.`); return; }
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
        if (!hits.length) { s.status = "failed"; s.outcome = "not_found"; s.note = "It isn't running, so I can't tell whether it finished or never started. Check its log or output."; break; }
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
        // Started through scripts/job-runner.mjs, which writes the exit code to <log>.exit, so how it ended is
        // still known after MyManager restarts. MyManager's own keys and tokens aren't passed to the job.
        try { fs.rmSync(`${log}.exit`, { force: true }); } catch { /* none */ }
        if (!(await stillOn(r.id))) { fs.closeSync(fd); s.status = "skipped"; s.note = "Stopped before it started."; return; }
        const runner = path.join(process.cwd(), "scripts", "job-runner.mjs");
        const child = spawn(process.execPath, [runner, `${log}.exit`, cmd as string, ...(args as string[])], { cwd: path.dirname(file), detached: true, windowsHide: true, stdio: ["ignore", fd, fd], env: workerEnv({ PYTHONUNBUFFERED: "1" }) });
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
        if (!(await stillOn(r.id))) { s.status = "done"; s.note = `Committed ${staged.length} files. Stopped before pushing.`; break; }
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
        if (!(await stillOn(r.id))) { s.status = "skipped"; s.note = "Stopped before deleting."; break; }
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
        if (s.command && isLoginCommand(s.command)) {
          // a sign-in: don't ask him for one that already works, and don't send him looking for a window that never opened
          const service = signInService(s.command) ?? "it";
          if (await checkSignIn(s.command)) { s.status = "done"; s.finished_at = now(); s.note = `Already signed in to ${service}, so nothing to do.`; break; }
          const way = await openSignIn(s.command, dir || os.homedir(), s.label);
          if (way.link) s.url = way.link;
          s.status = "waiting";
          s.note = way.how === "window" ? `A ${service} sign-in window is open on your PC. Finish it there; I'll notice by myself when it works.`
            : way.how === "link" ? `The sign-in window wouldn't open, so I opened the ${service} sign-in page in your browser instead. Confirm it there; I'll notice by myself when it works.`
            : `I couldn't open a ${service} sign-in on your PC (${way.why}). Ask me to try another way, or press Not needed.`;
          void notify(`🙋 **${r.title}**: ${s.note}${s.url ? `\n${s.url}` : ""}`);
          await logRunbook(r.id, `Handed over to Thomas: ${s.label} (${way.how}${way.why ? `: ${way.why}` : ""})`);
          watchSignIn(r.id, s.id, s.command);
          return;
        }
        if (s.url) openThing(s.url);
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
        if (!(await stillOn(r.id))) { s.status = "skipped"; s.note = "Stopped before it ran."; break; }
        // Windows: hand cmd the line exactly as written (what Node's own shell option does). Letting Node quote it
        // turns any "quoted words" into \"…\", which cmd doesn't understand.
        const out = await run(isWin ? "cmd.exe" : "sh", isWin ? ["/d", "/s", "/c", `"${c}"`] : ["-c", c], { cwd: dir || os.homedir(), timeout: 10 * 60_000, maxBuffer: 16 << 20, windowsHide: true, windowsVerbatimArguments: isWin, env: workerEnv() })
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

/* Windows' `start` reads its own quotes, and Node's automatic quoting (\"…\") confuses it: a window title of
   "Sign in to Vercel" became the program "in" ("Windows cannot find 'in'"). So both openers build cmd's line
   themselves (windowsVerbatimArguments) from text that can't contain quotes. */
function openThing(target: string) {
  if (!/^https:\/\/[^\s"<>^|]+$/i.test(target)) return;
  if (isWin) spawn("cmd.exe", ["/d", "/c", `start "" "${target}"`], { detached: true, windowsHide: true, stdio: "ignore", windowsVerbatimArguments: true }).on("error", () => {}).unref();
  else spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
}

/** A visible window running a sign-in command (e.g. `vercel login`) so Thomas can finish it himself. */
function openTerminal(command: string, cwd: string, title: string) {
  if (!isLoginCommand(command)) return; // hand-overs only ever open a sign-in
  if (isWin) spawn("cmd.exe", ["/d", "/c", terminalLine(command, title)], { cwd, detached: true, stdio: "ignore", windowsVerbatimArguments: true }).on("error", () => {}).unref();
}

/**
 * Open a sign-in for Thomas, trying the next way when one fails:
 * 1. a visible window running the sign-in command, checked a few seconds later to be really open;
 * 2. otherwise the same command run in the background, and the sign-in link it prints opened in his browser
 *    (Vercel and GitHub sign in by link, and he's already signed in to them in his browser).
 */
async function openSignIn(command: string, cwd: string, title: string): Promise<{ how: "window" | "link" | "none"; link?: string; why?: string }> {
  if (!isLoginCommand(command)) return { how: "none", why: "that isn't a sign-in command" };
  if (!isWin) return { how: "none", why: "sign-in windows are only set up for Windows" };
  openTerminal(command, cwd, title);
  await new Promise((res) => setTimeout(res, 4000));
  if (await windowOpen(command)) return { how: "window" };
  const link = await signInLink(command, cwd);
  if (link) { openThing(link); return { how: "link", link }; }
  return { how: "none", why: "the window didn't open and the sign-in didn't give a link" };
}

/** Is a cmd window running this sign-in command? (Read-only look at running programs.) */
async function windowOpen(command: string) {
  const want = command.replace(/'/g, "").toLowerCase();
  const ps = `@(Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains('/k ${want}') }).Count`;
  const out = await run("powershell.exe", ["-NoProfile", "-Command", ps], { timeout: 20_000, windowsHide: true }).then((x) => x.stdout.trim(), () => "0");
  return Number(out) > 0;
}

/** Run the sign-in in the background and catch the link it prints. It keeps waiting (up to 10 minutes) so the sign-in can finish. */
function signInLink(command: string, cwd: string) {
  return new Promise<string | null>((resolve) => {
    let out = "";
    let done = false;
    const finish = (v: string | null) => { if (!done) { done = true; resolve(v); } };
    const child = spawn("cmd.exe", ["/d", "/s", "/c", `"${command}"`], { cwd, windowsHide: true, windowsVerbatimArguments: true, env: workerEnv({ BROWSER: "none" }) });
    const look = (b: Buffer) => {
      out += b.toString();
      const m = out.match(/https:\/\/[^\s"'<>]+/g)?.find((u) => /vercel\.com|github\.com\/login\/device|supabase\.com/i.test(u));
      if (m) finish(m.replace(/[).,]+$/, ""));
    };
    child.stdout?.on("data", look);
    child.stderr?.on("data", look);
    child.on("error", () => finish(null));
    child.on("exit", () => finish(null));
    if (/\bgh\s+auth\s+login\b/.test(command)) child.stdin?.write("\n"); // "press Enter to open the browser"
    setTimeout(() => finish(null), 25_000);
    setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 10 * 60_000).unref();
  });
}

/** Keep checking a handed-over sign-in and tick the step off by itself once it really works (up to 15 minutes). */
const watchingSignIns = new Set<string>();
function watchSignIn(runbookId: string, stepId: string, command: string) {
  const key = `${runbookId}:${stepId}`;
  if (watchingSignIns.has(key)) return;
  watchingSignIns.add(key);
  const until = Date.now() + 15 * 60_000;
  const tick = async () => {
    try {
      const { data } = await db().from("runbooks").select("status,steps").eq("id", runbookId).maybeSingle();
      const step = (data as Runbook | null)?.steps.list.find((x) => x.id === stepId);
      if (!data || step?.status !== "waiting" || !["running", "waiting"].includes((data as Runbook).status)) { watchingSignIns.delete(key); return; }
      if (await checkSignIn(command)) {
        watchingSignIns.delete(key);
        await resolveStep(runbookId, stepId, "done");
        void notify(`✅ MyManager is signed in to ${signInService(command) ?? "it"} now.`);
        return;
      }
    } catch { /* try again next time */ }
    if (Date.now() < until) setTimeout(tick, 8000).unref();
    else watchingSignIns.delete(key);
  };
  setTimeout(tick, 8000).unref();
}

/** cmd's line for a sign-in window: `start "<title>" cmd.exe /d /k <command>`. The command already passed
 *  isLoginCommand (letters, dashes, dots only); the title keeps only plain characters. Exported for tests. */
export function terminalLine(command: string, title: string) {
  const t = title.replace(/[^\w ,.()-]/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || "MyManager";
  return `start "${t}" cmd.exe /d /k ${command}`;
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
      // How did it end? A job MyManager started leaves its exit code in <log>.exit (scripts/job-runner.mjs).
      let code: number | null | undefined = exits.get(s.pid ?? -1);
      if (code === undefined && s.kind === "start_job" && s.log) {
        try { const ex = JSON.parse(fs.readFileSync(`${s.log}.exit`, "utf8")) as { code?: number | null }; code = ex.code ?? null; } catch { /* no record */ }
      }
      s.exit_code = code ?? null;
      const last = tail(s.log, 3);
      const took = hours < 1 ? `${Math.round(hours * 60)} min` : `${hours.toFixed(1)} h`;
      if (code === 0 && !/traceback/i.test(last)) { s.status = "done"; s.outcome = "finished"; }
      else if (code != null) { s.status = "failed"; s.outcome = "failed"; }
      else if (s.kind === "start_job") { s.status = "failed"; s.outcome = "interrupted"; } // ours, but no exit code: closed or the PC restarted
      else if (/traceback|error|failed/i.test(last)) { s.status = "failed"; s.outcome = "failed"; }
      else { s.status = "done"; s.outcome = "unverified"; } // someone else's program: we can only say it stopped
      s.finished_at = now();
      const head = { finished: "Finished", failed: `Stopped with a problem${code != null ? ` (exit code ${code})` : ""}`, interrupted: "Stopped without saying how it ended (it was closed, or the PC restarted)", unverified: "Stopped running. I can't see how it ended, so check it worked", not_found: "Not running" }[s.outcome!];
      s.note = `${head} after ${took}.${last ? ` Last lines: ${last.replace(/\n/g, " / ").slice(0, 300)}` : ""}`;
      const bad = s.status === "failed";
      await logRunbook(r.id, `${s.file ?? s.match}: ${s.note}`);
      void notify(`${bad ? "⚠️" : s.outcome === "unverified" ? "☑️" : "✅"} **${s.file ?? s.match}** ${s.note}`);
      void import("@/lib/missions").then((m) => m.wakeHelpers("job_finished", `${s.file ?? s.match}: ${s.note}`, r.project_id)).catch(() => {});
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
