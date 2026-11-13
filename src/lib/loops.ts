import "server-only";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { notify } from "@/lib/notify";
import { checkLaunch, claudeLaunch } from "@/lib/sandbox";
import { askThomas, finishMission, logMission, shortId, startCodingStep, type Mission } from "@/lib/missions";

/**
 * Loops: "keep going until the tests pass". Deterministic, so a model can't talk its way past the check:
 *   run the check → failing? code a fix with the failure output → passing? a second, read-only agent reviews the diff
 *   → approved? done, and the branch is ready to push (that still asks Thomas) → changes asked? code them.
 * After max_rounds without passing, it stops and asks Thomas instead of burning through his usage.
 */

/** Only checks that are safe to run over and over: tests, type checks, linters, builds. */
const SAFE_CHECK = /^(npm (test|run [\w:-]+)|npx (tsc|eslint|vitest|jest|playwright test|prettier --check)( [\w./:=@-]+)*|pnpm (test|run [\w:-]+)|yarn (test|[\w:-]+)|py(thon3?)? -m (pytest|unittest|mypy|ruff)( [\w./:=-]+)*|pytest( [\w./:=-]+)*|ruff check( [\w./-]+)*|cargo (test|check|clippy)|go (test|vet) [\w./-]+)$/;
/** Scripts that sound like they ship or wipe something are never run as a check, whatever the script holds. */
const RISKY_SCRIPT = /\b(deploy|release|publish|push|ship|prod|clean|reset|drop|seed|migrate|start|serve|dev)\b/i;
export const isSafeCheck = (cmd: string) => SAFE_CHECK.test(cmd.trim()) && !RISKY_SCRIPT.test(cmd);

const git = (cwd: string, args: string[]) => new Promise<{ ok: boolean; out: string }>((resolve) => {
  execFile("git", args, { cwd, timeout: 60_000, windowsHide: true }, (e, so, se) => resolve({ ok: !e, out: `${so}${se}`.trim() }));
});

/** A separate working copy for this mission: ~/.mymanager/worktrees/<id>, on branch mymanager/<id>.
 *  Throws (with a plain reason) when it can't make one: work never falls back to Thomas's own folder.
 *  Records the commit it started from (base_sha), which the review compares against. */
export async function ensureWorktree(m: Mission): Promise<{ dir: string; note?: string }> {
  if (!m.work_dir) throw new Error("the mission has no project folder");
  const id = shortId(m.id);
  const branch = `mymanager/${id}`;
  if (m.worktree && fs.existsSync(m.worktree)) {
    const on = await git(m.worktree, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (on.ok && on.out.trim() === branch) return { dir: m.worktree };
    throw new Error(`its separate copy at ${m.worktree} isn't on ${branch} any more`);
  }
  const top = await git(m.work_dir, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) throw new Error(`${m.work_dir} isn't a git project, so there's no safe separate copy to work in`);
  const head = await git(m.work_dir, ["rev-parse", "HEAD"]);
  if (!head.ok) throw new Error("the project has no commits yet");
  const dir = path.join(os.homedir(), ".mymanager", "worktrees", id);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const exists = (await git(m.work_dir, ["branch", "--list", branch])).out.length > 0;
  const r = await git(m.work_dir, exists ? ["worktree", "add", dir, branch] : ["worktree", "add", "-b", branch, dir]);
  if (!r.ok) throw new Error(`git couldn't make a separate copy: ${r.out.slice(0, 160)}`);
  const base = m.base_sha ?? (exists ? (await git(m.work_dir, ["merge-base", branch, "HEAD"])).out.trim() : head.out.trim());
  await db().from("missions").update({ worktree: dir, base_sha: base || null }).eq("id", m.id);
  Object.assign(m, { worktree: dir, base_sha: base || null });
  const deps = fs.existsSync(path.join(dir, "package.json")) && !fs.existsSync(path.join(dir, "node_modules"))
    ? " It doesn't have node_modules yet, so the first step may need npm install." : "";
  return { dir, note: `Working in a separate copy at ${dir} (from commit ${base.slice(0, 7)}), so your own folder isn't touched.${deps}` };
}

async function run(command: string, cwd: string, ms = 15 * 60_000) {
  // The check runs the project's own scripts, so it gets none of MyManager's keys or tokens, and runs inside the
  // sandbox when that's switched on (never outside it if the sandbox is on but broken).
  const how = await checkLaunch(command, cwd);
  if ("problem" in how) return { code: 1, out: `The sandbox isn't working (${how.problem}), so the check didn't run.`, blocked: how.problem };
  return new Promise<{ code: number; out: string; blocked?: string }>((resolve) => {
    const child = spawn(how.cmd, how.args, { cwd, shell: how.shell, windowsHide: true, env: how.env });
    let out = "";
    const add = (d: Buffer) => { out = (out + d.toString()).slice(-20_000); };
    child.stdout.on("data", add); child.stderr.on("data", add);
    const t = setTimeout(() => { child.kill(); out += "\n(stopped after 15 minutes)"; }, ms);
    child.on("error", (e) => { clearTimeout(t); resolve({ code: 1, out: e.message }); });
    child.on("close", (code) => { clearTimeout(t); resolve({ code: code ?? 1, out }); });
  });
}

/** The second opinion: a read-only Claude that only looks at the diff. */
async function review(m: Mission, dir: string, base: string): Promise<{ ok: boolean; text: string; blocked?: string }> {
  const prompt = `You are reviewing a change another agent made for Thomas. You can only read.
The job was: ${m.goal}
The check \`${m.done_check}\` now passes.
Look at the change with \`git diff ${base}...HEAD\` and \`git log ${base}..HEAD\`. Judge it: does it really do the job (not just make the check pass, e.g. by deleting or skipping tests), is it small and safe, any obvious bug, secret or real-money code?
End with exactly one line: "VERDICT: approve - <one line>" or "VERDICT: changes - <the specific changes needed>".`;
  const tools = ["Read", "Glob", "Grep", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git status:*)"];
  // read-only: the guard (and the sandbox, when on) blocks any change, whatever the reviewer tries
  const how = await claudeLaunch({ workDir: dir, readOnly: true, tag: `review-${shortId(m.id)}`,
    args: ["-p", "--output-format", "json", "--allowedTools", tools.join(","), "--disallowedTools", "Edit,Write,NotebookEdit,Task,WebFetch"] });
  if ("problem" in how) return { ok: false, text: `The reviewer's sandbox isn't working (${how.problem}), so it didn't run.`, blocked: how.problem };
  return new Promise<{ ok: boolean; text: string; blocked?: string }>((resolve) => {
    const child = spawn(how.cmd, how.args, { cwd: dir, shell: how.shell, env: how.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stdin.write(prompt); child.stdin.end();
    const t = setTimeout(() => child.kill(), 20 * 60_000);
    child.on("error", () => { clearTimeout(t); resolve({ ok: false, text: "The reviewer couldn't start." }); });
    child.on("close", () => {
      clearTimeout(t);
      let r = ""; try { r = String(JSON.parse(out).result ?? ""); } catch { r = out.slice(-1500); }
      const v = r.match(/VERDICT:\s*(approve|changes)\s*[-–:]\s*(.+)/i);
      resolve(v ? { ok: v[1].toLowerCase() === "approve", text: v[2].trim() } : { ok: false, text: "The reviewer didn't give a clear answer, so treat it as needing another look." });
    });
  });
}

const looping = new Set<string>();
const tail = (s: string, n = 3500) => (s.length > n ? "…" + s.slice(-n) : s);

/** One round of a loop. Called when the loop starts, after every coding step, and after Thomas answers. */
export async function loopRound(id: string, note?: string) {
  if (looping.has(id)) return;
  looping.add(id);
  try {
    const { data } = await db().from("missions").select("*").eq("id", id).maybeSingle();
    const m = data as (Mission & { done_check: string | null; rounds: number; max_rounds: number; worktree: string | null; base_sha: string | null }) | null;
    if (!m || !m.done_check || m.status !== "running" || !m.can_code || m.worker === "working") return;
    if (!isSafeCheck(m.done_check)) { await askThomas(id, `The check "${m.done_check}" isn't one I'm allowed to run over and over. What test or build command should I use instead?`); return; }
    const hadCopy = !!m.worktree;
    const wt = await ensureWorktree(m).catch((e: Error) => ({ dir: "", note: e.message }));
    if (!wt.dir) { await askThomas(id, `I couldn't make a separate copy of the project to work in (${wt.note}), so I haven't touched your folder. What should I do?`); return; }
    if (wt.note && !hadCopy) await logMission(id, "note", wt.note);
    const ran = await run(m.done_check, wt.dir);
    if (ran.blocked) { await askThomas(id, `${ran.out} Fix the sandbox, or turn it off (CODER_SANDBOX in .env.local) to run checks without it.`); return; }
    const passed = ran.code === 0;
    await logMission(id, "check", `${m.done_check}: ${passed ? "passes" : "fails"} (round ${m.rounds + 1} of ${m.max_rounds})`);
    await db().from("missions").update({ last_check_at: new Date().toISOString(), next_check_at: new Date(Date.now() + (m.check_every_minutes || 60) * 60_000).toISOString(), last_update: passed ? "Check passes, getting it reviewed" : `Round ${m.rounds + 1}: check still failing, fixing it` }).eq("id", id);

    const outOfRounds = m.rounds >= m.max_rounds;
    if (!passed && outOfRounds) {
      await askThomas(id, `I've had ${m.max_rounds} goes and "${m.done_check}" still fails. Last thing it said: ${tail(ran.out, 300).split("\n").filter(Boolean).pop() ?? ""}. Keep going, change the plan, or stop?`);
      return;
    }
    if (!passed) {
      await db().from("missions").update({ rounds: m.rounds + 1 }).eq("id", id);
      await startCodingStep(id, `${note ? `Thomas said: ${note}\n` : ""}Make \`${m.done_check}\` pass for the job "${m.goal}". Fix the real cause; never skip, delete or weaken tests to get green. Here is the end of the failing output:\n${tail(ran.out)}`);
      return;
    }
    // Passing isn't enough: there has to be new work since the mission started (a check that already passed
    // doesn't prove the job was done), and the reviewer has to approve exactly this commit.
    const base = m.base_sha || (await git(wt.dir, ["merge-base", "HEAD", "origin/HEAD"])).out.split("\n")[0];
    if (!base) { await askThomas(id, "I can't tell which commit this work started from, so I can't review it safely. Should I start it again?"); return; }
    const head = (await git(wt.dir, ["rev-parse", "HEAD"])).out.trim();
    const dirty = (await git(wt.dir, ["status", "--porcelain"])).out.trim();
    if (head === base.trim()) {
      if (outOfRounds) { await askThomas(id, `"${m.done_check}" passes, but nothing has been changed yet, so it doesn't show the job "${m.goal}" is done. Keep going, change the check, or stop?`); return; }
      await db().from("missions").update({ rounds: m.rounds + 1 }).eq("id", id);
      await startCodingStep(id, `${note ? `Thomas said: ${note}\n` : ""}\`${m.done_check}\` already passes, but the job "${m.goal}" isn't done yet: nothing has been committed since the start. Do the job, keep the check passing, and commit.`);
      return;
    }
    if (dirty) {
      await db().from("missions").update({ rounds: m.rounds + 1 }).eq("id", id);
      await startCodingStep(id, `There are changes that aren't committed. Commit them (or undo them if they're not needed), keep \`${m.done_check}\` passing.`);
      return;
    }
    const rv = await review(m, wt.dir, base.trim());
    if (rv.blocked) { await askThomas(id, `${rv.text} Fix the sandbox, or turn it off (CODER_SANDBOX in .env.local) to review without it.`); return; }
    await logMission(id, "review", `${rv.ok ? "Approved" : "Changes asked"} (commit ${head.slice(0, 7)}): ${rv.text}`);
    const moved = (await git(wt.dir, ["rev-parse", "HEAD"])).out.trim() !== head;
    if (rv.ok && moved) { await logMission(id, "note", "The branch changed while it was being reviewed, so I'll check and review it again."); setTimeout(() => { void loopRound(id).catch(() => {}); }, 2000); return; }
    if (!rv.ok && outOfRounds) {
      await askThomas(id, `I've had ${m.max_rounds} goes. "${m.done_check}" passes, but the review still wants changes: ${rv.text}. Keep going, change the plan, or stop?`);
      return;
    }
    if (!rv.ok) {
      await db().from("missions").update({ rounds: m.rounds + 1 }).eq("id", id);
      await startCodingStep(id, `The reviewer asked for changes: ${rv.text}\nMake them, keep \`${m.done_check}\` passing, and commit.`);
      return;
    }
    await db().from("missions").update({ last_update: `Done: "${m.done_check}" passes and the review approved commit ${head.slice(0, 7)}. Branch mymanager/${shortId(id)} is ready.` }).eq("id", id);
    await logMission(id, "check", `Verified: ${m.done_check} passed at commit ${head} and the review approved that commit.`);
    await finishMission(id, "done");
    const { remember } = await import("@/lib/project-notes");
    await remember(m.project_id, `Loop "${m.goal.slice(0, 80)}" finished in ${m.rounds + 1} round(s); check: ${m.done_check}. Review: ${rv.text}`).catch(() => {});
    await notify(`Branch mymanager/${shortId(id)} is ready. Say "push it" and I'll ask for your OK to push it to GitHub.`).catch(() => false);
  } catch (e) {
    await logMission(id, "note", `The loop hit a problem: ${(e as Error).message}`);
  } finally {
    looping.delete(id);
  }
}
