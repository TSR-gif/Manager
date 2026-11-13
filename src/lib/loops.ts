import "server-only";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { notify } from "@/lib/notify";
import { guarded } from "@/lib/agent/guard";
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

const isWin = process.platform === "win32";
const git = (cwd: string, args: string[]) => new Promise<{ ok: boolean; out: string }>((resolve) => {
  execFile("git", args, { cwd, timeout: 60_000, windowsHide: true }, (e, so, se) => resolve({ ok: !e, out: `${so}${se}`.trim() }));
});

/** A separate working copy for this mission: ~/.mymanager/worktrees/<id>, on branch mymanager/<id>. */
export async function ensureWorktree(m: Mission): Promise<{ dir: string; note?: string }> {
  if (!m.work_dir) throw new Error("No folder");
  if (m.worktree && fs.existsSync(m.worktree)) return { dir: m.worktree };
  const top = await git(m.work_dir, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) return { dir: m.work_dir, note: "Not a git folder, so it works in the folder itself." };
  const id = shortId(m.id);
  const branch = `mymanager/${id}`;
  const dir = path.join(os.homedir(), ".mymanager", "worktrees", id);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const exists = (await git(m.work_dir, ["branch", "--list", branch])).out.length > 0;
  const r = await git(m.work_dir, exists ? ["worktree", "add", dir, branch] : ["worktree", "add", "-b", branch, dir]);
  if (!r.ok) return { dir: m.work_dir, note: `Couldn't make a separate copy (${r.out.slice(0, 160)}), so it works in the folder on its own branch.` };
  await db().from("missions").update({ worktree: dir }).eq("id", m.id);
  return { dir, note: `Working in a separate copy at ${dir}, so your own folder isn't touched.` };
}

function run(cmd: string, cwd: string, ms = 15 * 60_000) {
  return new Promise<{ code: number; out: string }>((resolve) => {
    const child = spawn(cmd, { cwd, shell: true, windowsHide: true, env: { ...process.env, CI: "1", FORCE_COLOR: "0" } });
    let out = "";
    const add = (d: Buffer) => { out = (out + d.toString()).slice(-20_000); };
    child.stdout.on("data", add); child.stderr.on("data", add);
    const t = setTimeout(() => { child.kill(); out += "\n(stopped after 15 minutes)"; }, ms);
    child.on("error", (e) => { clearTimeout(t); resolve({ code: 1, out: e.message }); });
    child.on("close", (code) => { clearTimeout(t); resolve({ code: code ?? 1, out }); });
  });
}

/** The second opinion: a read-only Claude that only looks at the diff. */
function review(m: Mission, dir: string, base: string) {
  const prompt = `You are reviewing a change another agent made for Thomas. You can only read.
The job was: ${m.goal}
The check \`${m.done_check}\` now passes.
Look at the change with \`git diff ${base}...HEAD\` and \`git log ${base}..HEAD\`. Judge it: does it really do the job (not just make the check pass, e.g. by deleting or skipping tests), is it small and safe, any obvious bug, secret or real-money code?
End with exactly one line: "VERDICT: approve - <one line>" or "VERDICT: changes - <the specific changes needed>".`;
  const tools = ["Read", "Glob", "Grep", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git status:*)"];
  const guard = guarded(null, `review-${shortId(m.id)}`); // read-only: the guard blocks any change, whatever the reviewer tries
  const args = ["-p", "--output-format", "json", "--allowedTools", tools.join(","), "--disallowedTools", "Edit,Write,NotebookEdit,Task,WebFetch", ...guard.args];
  const argv = isWin ? args.map((a) => (/[\s&()^|<>]/.test(a) ? `"${a}"` : a)) : args;
  return new Promise<{ ok: boolean; text: string }>((resolve) => {
    const child = spawn(process.env.CLAUDE_BIN ?? (isWin ? "claude.cmd" : "claude"), argv, { cwd: dir, shell: isWin, env: guard.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
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
    const m = data as (Mission & { done_check: string | null; rounds: number; max_rounds: number; worktree: string | null }) | null;
    if (!m || !m.done_check || m.status !== "running" || !m.can_code || m.worker === "working") return;
    if (!isSafeCheck(m.done_check)) { await askThomas(id, `The check "${m.done_check}" isn't one I'm allowed to run over and over. What test or build command should I use instead?`); return; }
    const wt = await ensureWorktree(m);
    if (wt.note && !m.worktree) await logMission(id, "note", wt.note);
    const ran = await run(m.done_check, wt.dir);
    const passed = ran.code === 0;
    await logMission(id, "check", `${m.done_check}: ${passed ? "passes" : "fails"} (round ${m.rounds + 1} of ${m.max_rounds})`);
    await db().from("missions").update({ last_check_at: new Date().toISOString(), next_check_at: new Date(Date.now() + (m.check_every_minutes || 60) * 60_000).toISOString(), last_update: passed ? "Check passes, getting it reviewed" : `Round ${m.rounds + 1}: check still failing, fixing it` }).eq("id", id);

    if (m.rounds >= m.max_rounds) {
      await askThomas(id, `I've had ${m.max_rounds} goes and "${m.done_check}" ${passed ? "passes, but the review still wants changes" : "still fails"}. Last thing it said: ${tail(ran.out, 300).split("\n").filter(Boolean).pop() ?? ""}. Keep going, change the plan, or stop?`);
      return;
    }
    if (!passed) {
      await db().from("missions").update({ rounds: m.rounds + 1 }).eq("id", id);
      await startCodingStep(id, `${note ? `Thomas said: ${note}\n` : ""}Make \`${m.done_check}\` pass for the job "${m.goal}". Fix the real cause; never skip, delete or weaken tests to get green. Here is the end of the failing output:\n${tail(ran.out)}`);
      return;
    }
    const base = (await git(wt.dir, ["merge-base", "HEAD", "origin/HEAD"])).out.split("\n")[0] || (await git(wt.dir, ["rev-parse", "HEAD~1"])).out || "HEAD~1";
    const rv = await review(m, wt.dir, base.trim());
    await logMission(id, "review", `${rv.ok ? "Approved" : "Changes asked"}: ${rv.text}`);
    if (!rv.ok) {
      await db().from("missions").update({ rounds: m.rounds + 1 }).eq("id", id);
      await startCodingStep(id, `The reviewer asked for changes: ${rv.text}\nMake them, keep \`${m.done_check}\` passing, and commit.`);
      return;
    }
    await db().from("missions").update({ last_update: `Done: "${m.done_check}" passes and the review approved it. Branch mymanager/${shortId(id)} is ready.` }).eq("id", id);
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
