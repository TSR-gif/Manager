import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { db } from "@/lib/db";
import { runAgent } from "@/lib/agent/run";
import { notify } from "@/lib/notify";

/**
 * Supervise: "Day trader is doing X, Y and Z, make sure it gets finished."
 * A mission is a goal plus steps (tasks with mission_id). MyManager checks on it on a schedule,
 * ticks off what's really done, asks Thomas (app + Telegram) when it needs him, and carries on when he answers.
 * Coding steps run only after Thomas approves "work on the code" for that mission, and never push.
 */
export interface Mission {
  id: string; project_id: string | null; goal: string; status: "running" | "waiting" | "done" | "stopped";
  question: string | null; last_update: string | null; check_every_minutes: number; next_check_at: string | null;
  last_check_at: string | null; checks: number; work_dir: string | null; can_code: boolean; worker: "idle" | "working";
  created_at: string; finished_at: string | null;
  done_check?: string | null; rounds?: number; max_rounds?: number; worktree?: string | null; base_sha?: string | null;
  ongoing?: boolean; wake_on?: string[];
}
export interface MissionLog { id: string; mission_id: string; kind: string; text: string; created_at: string }

export const shortId = (id: string) => id.replace(/-/g, "").slice(0, 8);

export async function logMission(missionId: string, kind: string, text: string) {
  await db().from("mission_log").insert({ mission_id: missionId, kind, text: text.slice(0, 4000) });
}

const checking = new Set<string>();
const MAX_CHECKS = 200; // safety stop so a stuck mission can't run forever

async function projectName(id: string | null) {
  if (!id) return null;
  const { data } = await db().from("projects").select("name").eq("id", id).maybeSingle();
  return (data?.name as string) ?? null;
}

export async function missionPrompt(m: Mission, answer?: string) {
  const name = await projectName(m.project_id);
  const [{ data: steps }, { data: log }] = await Promise.all([
    db().from("tasks").select("id,title,status").eq("mission_id", m.id).order("created_at"),
    db().from("mission_log").select("kind,text,created_at").eq("mission_id", m.id).order("created_at", { ascending: false }).limit(10),
  ]);
  const stepLines = ((steps ?? []) as { id: string; title: string; status: string }[])
    .map((s) => `- [${s.status === "done" ? "x" : " "}] ${s.title} (task id ${s.id})`).join("\n") || "- (no steps yet: add them with add_mission_step)";
  const logLines = ((log ?? []) as { kind: string; text: string; created_at: string }[]).reverse()
    .map((l) => `- ${l.created_at.slice(0, 16).replace("T", " ")} ${l.kind}: ${l.text.slice(0, 600)}`).join("\n") || "- (nothing yet)";
  const { data: proj } = m.project_id ? await db().from("projects").select("*").eq("id", m.project_id).maybeSingle() : { data: null };
  const { briefHeader } = await import("@/lib/briefs");
  const know = proj ? `\n${briefHeader(proj)}\n` : "";
  const coding = m.can_code && m.work_dir
    ? `You may do coding steps yourself with run_coding_step (it works in ${m.work_dir} on Thomas's PC, on its own branch, and never pushes). The coder is ${m.worker === "working" ? "busy right now: don't start another, just check back" : "free"}.`
    : m.work_dir
      ? "Coding steps need Thomas's OK first (he hasn't approved it for this mission). Don't ask again if a request is already waiting."
      : "You can't change the code yourself on this mission. For coding work, write the step clearly so Thomas (or a Claude session he starts) can do it.";
  if (m.ongoing) return helperPrompt(m, name, know, logLines, answer);
  return `Supervising mission ${m.id} for ${name ?? "an everyday goal"}. Thomas said: "${m.goal}". He wants this seen through to the end. This is check number ${m.checks + 1}; he isn't watching right now.
${answer ? `\nTHOMAS JUST ANSWERED YOUR QUESTION ("${m.question ?? ""}"): ${answer}\nAct on his answer first.\n` : ""}
${know}
Steps:
${stepLines}

Recent history:
${logLines}

${coding}

What to do now:
1. Look at the real progress${name ? ` with inspect_project("${name}")` : ""}. Don't take a step as done unless you can see it's done (a commit, a closed issue, a passing check, or Thomas said so).
2. Tick off steps that are really done (complete_task with the task id). Add a missing step with add_mission_step only if it's genuinely needed to finish.
3. If something needs Thomas (a decision, a login, a key, money, anything only he can do or know), call ask_thomas with one short, clear question. Ask only when you truly can't move without him.
4. If you can do coding steps and the coder is free, start the next one with run_coding_step: one clear, small step at a time.
5. When every step is done and the work is committed on its branch, call request_push once so Thomas can review it and push it to GitHub (skip this if a push is already waiting or done).
6. Always finish by calling mission_update with one plain line on where it's at (no jargon). Use status "done" only when every step is really finished.
Never spend money, sign up, post, push code or deploy. Anything like that goes through request_approval.`;
}

/** Events a helper can wake on, besides its schedule. */
export const HELPER_EVENTS = ["approval_decided", "runbook_finished", "job_finished", "mission_finished"] as const;

/** The always-on helper's turn: it owns a responsibility, so there's no "done", and it stays quiet unless it matters. */
function helperPrompt(m: Mission, name: string | null | undefined, know: string, logLines: string, answer?: string) {
  return `You are Thomas's always-on helper ${m.id} for ${name ?? "his everyday life"}. Your standing job, in his words: "${m.goal}".
You work in the background; he isn't watching. This is wake-up number ${m.checks + 1}. You wake every ${Math.round(m.check_every_minutes / 60 * 10) / 10} hour(s)${m.wake_on?.length ? ` and when any of these happen: ${m.wake_on.join(", ")}` : ""}. The newest "event" lines in the history say why you woke now, if it wasn't the schedule.
${answer ? `\nTHOMAS JUST ANSWERED YOUR QUESTION ("${m.question ?? ""}"): ${answer}\nAct on his answer first.\n` : ""}
${know}
Recent history (yours):
${logLines}

What to do now:
1. Look at what changed since your last wake-up${name ? ` (inspect_project("${name}"), check_project_activity)` : ""} and anything your job covers. Check things yourself before asking him anything.
2. Do what your job needs within his rules: tasks, notes, runbook drafts, coding steps if allowed. Anything that spends money, signs up, posts, sends email as him, pushes code, deletes or changes settings goes through request_approval or a runbook he approves. Never do those directly.
3. Only interrupt him for two things: a decision only he can make (ask_thomas, one short question) or a result worth knowing (tell_thomas, one or two plain lines). Most wake-ups should send him nothing.
4. Always finish with mission_update: one plain line on where things stand. Keep status "running"; helpers don't finish, he stops them.`;
}

/** Something happened that helpers may care about: wake the ones that asked for it (and that cover this project). */
export async function wakeHelpers(event: (typeof HELPER_EVENTS)[number], text: string, projectId?: string | null) {
  const { data } = await db().from("missions").select("id,project_id,wake_on,worker").eq("status", "running").eq("ongoing", true);
  const hit = ((data ?? []) as Pick<Mission, "id" | "project_id" | "wake_on" | "worker">[])
    .filter((h) => (h.wake_on ?? []).includes(event) && (!h.project_id || !projectId || h.project_id === projectId));
  for (const h of hit) {
    await logMission(h.id, "event", `${event}: ${text.slice(0, 300)}`);
    if (h.worker !== "working") void checkMission(h.id).catch(() => {});
  }
}

/** One supervisor pass over a mission. */
export async function checkMission(id: string, answer?: string) {
  if (checking.has(id)) return null;
  checking.add(id);
  try {
    const { data } = await db().from("missions").select("*").eq("id", id).maybeSingle();
    const m = data as Mission | null;
    if (!m || m.status === "done" || m.status === "stopped") return null;
    if (m.status === "waiting" && !answer) return null;
    const now = new Date();
    await db().from("missions").update({
      last_check_at: now.toISOString(), checks: m.checks + 1,
      next_check_at: new Date(now.getTime() + m.check_every_minutes * 60_000).toISOString(),
      ...(answer ? { status: "running", question: null } : {}),
    }).eq("id", id);
    if (!m.ongoing && m.checks + 1 >= MAX_CHECKS) {
      await db().from("missions").update({ status: "waiting", question: "I've checked on this a lot without finishing. Keep going, change the plan, or stop?" }).eq("id", id);
      return null;
    }
    const goal = await missionPrompt(m, answer);
    let summary = "";
    const runId = await runAgent(goal, (e) => { if (e.type === "done") summary = e.summary; }, undefined, { kind: "mission" });
    await logMission(id, "check", summary.split(/\n\s*\n/)[0]?.slice(0, 600) || "Checked in.");
    return runId;
  } finally {
    checking.delete(id);
  }
}

let busy = false;
/** Called from the proactive tick: check every running mission that's due. */
export async function runDueMissions() {
  if (busy) return [];
  busy = true;
  try {
    // After a restart no coder is really running: put "working" missions back to idle so they don't hang forever.
    const { data: stale } = await db().from("missions").select("id").eq("worker", "working");
    for (const s of (stale ?? []) as { id: string }[]) {
      if (coders.has(s.id) || starting.has(s.id)) continue;
      await db().from("missions").update({ worker: "idle" }).eq("id", s.id).eq("worker", "working");
      await logMission(s.id, "note", "The coder was interrupted (MyManager restarted). Anything it didn't commit is still in its copy of the project.");
    }
    const { data } = await db().from("missions").select("id,next_check_at,worker,done_check,can_code").eq("status", "running");
    const due = ((data ?? []) as Pick<Mission, "id" | "next_check_at" | "worker" | "done_check" | "can_code">[])
      .filter((m) => m.worker !== "working" && (!m.next_check_at || new Date(m.next_check_at).getTime() <= Date.now()));
    const { loopRound } = await import("@/lib/loops");
    for (const m of due) await (m.done_check && m.can_code ? loopRound(m.id) : checkMission(m.id));
    return due.map((m) => m.id);
  } finally {
    busy = false;
  }
}

/** Thomas answered a mission's question (in the app, on Telegram, or by telling the assistant). */
export async function answerMission(id: string, text: string) {
  const { data } = await db().from("missions").select("id,question,status,done_check,can_code").eq("id", id).maybeSingle();
  if (!data) return false;
  await logMission(id, "answer", text);
  if (data.done_check && data.can_code) {
    // A loop: "stop" ends it; anything else is a fresh set of rounds with his answer passed to the coder.
    if (/^\s*(stop|cancel|leave it|no)\b/i.test(text)) { await finishMission(id, "stopped"); return true; }
    await db().from("missions").update({ status: "running", question: null, rounds: 0 }).eq("id", id);
    const { loopRound } = await import("@/lib/loops");
    void loopRound(id, text).catch(() => {});
    return true;
  }
  void checkMission(id, text).catch(() => {});
  return true;
}

export async function askThomas(id: string, question: string) {
  const { data: m } = await db().from("missions").select("project_id").eq("id", id).maybeSingle();
  if (!m) return false;
  await db().from("missions").update({ status: "waiting", question }).eq("id", id);
  await logMission(id, "question", question);
  const name = await projectName(m.project_id);
  const base = process.env.MANAGER_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
  await notify(`❓ **${name ?? "MyManager"} needs you**\n${question}\n\nReply to this message to answer. #m:${shortId(id)}`, { label: "Open in MyManager", url: `${base}/supervise` }).catch(() => false);
  return true;
}

/** Why a mission can't be marked done yet (null if it can): every step finished, no coder still working,
 *  and loops only finish through their own check and review (lib/loops.ts), never by an agent saying so. */
export async function whyNotFinished(id: string): Promise<string | null> {
  const { data: m } = await db().from("missions").select("status,worker,done_check,can_code").eq("id", id).maybeSingle();
  if (!m) return "mission not found.";
  if (m.status === "done" || m.status === "stopped") return `it's already ${m.status}.`;
  if (m.done_check && m.can_code) return `this one finishes on its own once \`${m.done_check}\` passes and the review approves the commit.`;
  if (m.worker === "working" || coders.has(id)) return "the coder is still working on a step.";
  const { data: steps } = await db().from("tasks").select("title,status").eq("mission_id", id);
  const open = ((steps ?? []) as { title: string; status: string }[]).filter((s) => s.status !== "done");
  if (open.length) return `these steps aren't done: ${open.map((s) => s.title).slice(0, 5).join("; ")}. Tick each off with complete_task once you can see it's really done.`;
  return null;
}

export async function finishMission(id: string, status: "done" | "stopped") {
  await db().from("missions").update({ status, question: null, finished_at: new Date().toISOString() }).eq("id", id);
  // Stop means stop: end a coder that's still working on this mission (and everything it started).
  if (status === "stopped" && stopCoder(id)) await logMission(id, "note", "Stopped the coder that was still working.");
  await logMission(id, status === "done" ? "done" : "note", status === "done" ? "Finished." : "Stopped by you.");
  if (status === "done") {
    const { data: m } = await db().from("missions").select("goal,project_id").eq("id", id).maybeSingle();
    const name = await projectName(m?.project_id ?? null);
    await notify(`✅ **${name ?? "Mission"} finished**\n${m?.goal ?? ""}`).catch(() => false);
    void wakeHelpers("mission_finished", m?.goal ?? "", m?.project_id).catch(() => {});
  }
}

// ---------- the coder: a Claude Code session in the project's folder, one step at a time ----------
const CODER_TOOLS = [
  "Read", "Edit", "Write", "Glob", "Grep",
  "Bash(npm:*)", "Bash(npx:*)", "Bash(node:*)", "Bash(python:*)", "Bash(python3:*)", "Bash(py:*)", "Bash(pytest:*)", "Bash(pip:*)",
  "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git add:*)", "Bash(git commit:*)",
  "Bash(git checkout -b:*)", "Bash(git switch:*)", "Bash(git branch --list:*)", "Bash(ls:*)", "Bash(dir:*)",
];
const CODER_DENY = ["Bash(git push:*)", "Bash(git reset --hard:*)", "Bash(rm -rf:*)", "Bash(del /s:*)", "WebFetch", "Task"];

/** Coders running in this server, by mission, so Stop can end them. */
const coders = ((globalThis as unknown as { __mmCoders?: Map<string, import("node:child_process").ChildProcess> }).__mmCoders ??= new Map());

const starting = new Set<string>(); // claimed, still setting up its copy

/** Ends the coder working on a mission, with everything it started. Returns true if one was running. */
export function stopCoder(id: string) {
  const child = coders.get(id);
  if (!child?.pid) return false;
  coders.delete(id);
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }).on("error", () => {});
  else { try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); } }
  return true;
}

export async function startCodingStep(id: string, instructions: string): Promise<string> {
  const { data } = await db().from("missions").select("*").eq("id", id).maybeSingle();
  const m = data as Mission | null;
  if (!m) return "No such mission.";
  if (m.status !== "running") return `Not started: the mission is ${m.status === "waiting" ? "waiting for Thomas's answer" : m.status}.`;
  if (!m.can_code || !m.work_dir) return "Not allowed: Thomas hasn't approved coding for this mission.";
  if (!fs.existsSync(m.work_dir)) return `The folder ${m.work_dir} doesn't exist on this PC. Ask Thomas where the project lives.`;
  // Claim the coder in one update (only one coder per mission, and only while it's still running).
  const { data: claimed } = await db().from("missions").update({ worker: "working" }).eq("id", id).eq("worker", "idle").eq("status", "running").select("id");
  if (!claimed?.length) return "The coder is already working on a step. Check back later.";
  starting.add(id);
  try { return await launchCoder(m, id, instructions); } finally { starting.delete(id); }
}

async function launchCoder(m: Mission, id: string, instructions: string): Promise<string> {
  // Its own working copy of the project. Coding was approved on that basis, so if a separate copy can't be made,
  // nothing runs: it never falls back to Thomas's own folder.
  const { ensureWorktree } = await import("@/lib/loops");
  const wt = await ensureWorktree(m).catch((e: Error) => ({ dir: "", note: e.message }));
  if (!wt.dir) {
    await db().from("missions").update({ worker: "idle" }).eq("id", id);
    await askThomas(id, `I couldn't make a separate copy of the project to work in (${wt.note}), so I haven't touched your folder. Is ${m.work_dir} a git project with at least one commit?`);
    return `Not started: ${wt.note}`;
  }
  if (wt.note && !m.worktree) await logMission(id, "note", wt.note);
  await logMission(id, "work", `Started: ${instructions}`);
  const branch = `mymanager/${shortId(id)}`;
  const dir = wt.dir;
  const { data: pr } = m.project_id ? await db().from("projects").select("id,name,local_path,brief,rules,lessons,goal").eq("id", m.project_id).maybeSingle() : { data: null };
  const { notesText } = await import("@/lib/project-notes");
  const notes = pr ? notesText(pr).replace(/^---[\s\S]*?---\s*/, "").replace(/<!--[\s\S]*?-->\s*/, "").trim().slice(0, 6000) : "";
  const prompt = `You are doing one step of a bigger job for Thomas, supervised by his MyManager app.
The job: ${m.goal}
This step: ${instructions}

Rules:
- You are in a separate copy of the project, already on the git branch "${branch}". Stay on it. Commit when the step works, with a clear message. Never push, never deploy, never merge into main.
- Only change files in this folder. Don't write inline scripts (node -e, python -c); put code in a file here and run that.
- Don't touch secrets, .env files, API keys or anything with real money (trading stays on pretend money).${pr?.rules ? `\n- Thomas's rules for this project, always follow them: ${pr.rules}` : ""}
- Keep the change small and focused on this step. Run the tests if there are any.${notes ? `\n\nWhat MyManager knows about this project:\n${notes}` : ""}
- If you need a decision or something only Thomas can give, stop and ask it.
End your reply with exactly one line, either "RESULT: done - <one line on what changed>" or "RESULT: stuck - <the one question for Thomas>".`;
  const isWin = process.platform === "win32";
  // Inside the sandbox when it's switched on (lib/sandbox.ts), otherwise with the guard hook. If the sandbox is on
  // but not working, nothing runs: it never quietly falls back to running unsandboxed.
  const { claudeLaunch } = await import("@/lib/sandbox");
  const how = await claudeLaunch({ workDir: dir, tag: `code-${shortId(id)}`,
    args: ["-p", "--output-format", "json", "--permission-mode", "acceptEdits", "--allowedTools", CODER_TOOLS.join(","), "--disallowedTools", CODER_DENY.join(",")] });
  if ("problem" in how) {
    await db().from("missions").update({ worker: "idle" }).eq("id", id);
    await askThomas(id, `The coder's sandbox isn't working (${how.problem}), so I haven't started it. Fix the sandbox, or turn it off (CODER_SANDBOX in .env.local) if you want coders to run with the guard only.`);
    return `Not started: the sandbox isn't working (${how.problem}).`;
  }
  const child = spawn(how.cmd, how.args, { cwd: dir, shell: how.shell, env: how.env, stdio: ["pipe", "pipe", "pipe"], detached: !isWin, windowsHide: true });
  coders.set(id, child);
  let out = "", err = "";
  child.stdout.on("data", (d) => { out += d.toString(); });
  child.stderr.on("data", (d) => { err += d.toString(); });
  child.stdin.write(prompt);
  child.stdin.end();
  const timer = setTimeout(() => { stopCoder(id); }, 45 * 60_000);
  const finish = async (text: string, stuck?: string) => {
    clearTimeout(timer);
    if (coders.get(id) === child) coders.delete(id);
    await db().from("missions").update({ worker: "idle", next_check_at: new Date().toISOString() }).eq("id", id);
    await logMission(id, "work", text);
    // Stopped (or finished) while it worked: record what happened, but start nothing more.
    const { data: now } = await db().from("missions").select("status").eq("id", id).maybeSingle();
    if (!now || now.status !== "running") return;
    if (m.done_check) {
      // A loop: the check decides what happens next, not a model. If the coder is stuck, ask Thomas.
      if (stuck) { await askThomas(id, stuck); return; }
      const { loopRound } = await import("@/lib/loops");
      void loopRound(id).catch(() => {});
    } else void checkMission(id).catch(() => {});
  };
  child.on("error", (e) => { void finish(`The coder couldn't start: ${e.message}`); });
  child.on("close", (code, signal) => {
    let result = "";
    try { result = String(JSON.parse(out).result ?? ""); } catch { result = out.slice(-1500); }
    const line = result.match(/RESULT:\s*(done|stuck)\s*[-–:]\s*(.+)/i);
    const stuck = line && line[1].toLowerCase() === "stuck" ? line[2].trim() : undefined;
    void finish(signal || (code !== 0 && !line) ? `The coder stopped (${signal ?? code}) before finishing. ${err.slice(-400)}` : line ? `${stuck ? "Stuck" : "Done"}: ${line[2].trim()}` : result.slice(-800) || "Finished the step.", stuck);
  });
  return `Started the coder on: ${instructions}. It works on the branch ${branch} and reports back when finished; the mission is checked again then.`;
}
