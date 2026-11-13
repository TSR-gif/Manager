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
  const coding = m.can_code && m.work_dir
    ? `You may do coding steps yourself with run_coding_step (it works in ${m.work_dir} on Thomas's PC, on its own branch, and never pushes). The coder is ${m.worker === "working" ? "busy right now: don't start another, just check back" : "free"}.`
    : m.work_dir
      ? "Coding steps need Thomas's OK first (he hasn't approved it for this mission). Don't ask again if a request is already waiting."
      : "You can't change the code yourself on this mission. For coding work, write the step clearly so Thomas (or a Claude session he starts) can do it.";
  return `Supervising mission ${m.id} for ${name ?? "an everyday goal"}. Thomas said: "${m.goal}". He wants this seen through to the end. This is check number ${m.checks + 1}; he isn't watching right now.
${answer ? `\nTHOMAS JUST ANSWERED YOUR QUESTION ("${m.question ?? ""}"): ${answer}\nAct on his answer first.\n` : ""}
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
5. Always finish by calling mission_update with one plain line on where it's at (no jargon). Use status "done" only when every step is really finished.
Never spend money, sign up, post, push code or deploy. Anything like that goes through request_approval.`;
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
    if (m.checks + 1 >= MAX_CHECKS) {
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
    const { data } = await db().from("missions").select("id,next_check_at,worker").eq("status", "running");
    const due = ((data ?? []) as Pick<Mission, "id" | "next_check_at" | "worker">[])
      .filter((m) => m.worker !== "working" && (!m.next_check_at || new Date(m.next_check_at).getTime() <= Date.now()));
    for (const m of due) await checkMission(m.id);
    return due.map((m) => m.id);
  } finally {
    busy = false;
  }
}

/** Thomas answered a mission's question (in the app, on Telegram, or by telling the assistant). */
export async function answerMission(id: string, text: string) {
  const { data } = await db().from("missions").select("id,question,status").eq("id", id).maybeSingle();
  if (!data) return false;
  await logMission(id, "answer", text);
  void checkMission(id, text).catch(() => {});
  return true;
}

export async function askThomas(id: string, question: string) {
  const { data: m } = await db().from("missions").select("project_id").eq("id", id).maybeSingle();
  if (!m) return false;
  await db().from("missions").update({ status: "waiting", question }).eq("id", id);
  await logMission(id, "question", question);
  const name = await projectName(m.project_id);
  const base = process.env.MANAGER_URL ?? `http://localhost:${process.env.PORT ?? "3000"}`;
  await notify(`❓ **${name ?? "MyManager"} needs you**\n${question}\n\nReply to this message to answer. #m:${shortId(id)}`, { label: "Open in MyManager", url: `${base}/supervise` }).catch(() => false);
  return true;
}

export async function finishMission(id: string, status: "done" | "stopped") {
  await db().from("missions").update({ status, question: null, finished_at: new Date().toISOString() }).eq("id", id);
  await logMission(id, status === "done" ? "done" : "note", status === "done" ? "Finished." : "Stopped by you.");
  if (status === "done") {
    const { data: m } = await db().from("missions").select("goal,project_id").eq("id", id).maybeSingle();
    const name = await projectName(m?.project_id ?? null);
    await notify(`✅ **${name ?? "Mission"} finished**\n${m?.goal ?? ""}`).catch(() => false);
  }
}

// ---------- the coder: a Claude Code session in the project's folder, one step at a time ----------
const CODER_TOOLS = [
  "Read", "Edit", "Write", "Glob", "Grep",
  "Bash(npm:*)", "Bash(npx:*)", "Bash(node:*)", "Bash(python:*)", "Bash(python3:*)", "Bash(py:*)", "Bash(pytest:*)", "Bash(pip:*)",
  "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git add:*)", "Bash(git commit:*)",
  "Bash(git checkout:*)", "Bash(git switch:*)", "Bash(git branch:*)", "Bash(ls:*)", "Bash(dir:*)",
];
const CODER_DENY = ["Bash(git push:*)", "Bash(git reset --hard:*)", "Bash(rm -rf:*)", "Bash(del /s:*)", "WebFetch", "Task"];

export async function startCodingStep(id: string, instructions: string): Promise<string> {
  const { data } = await db().from("missions").select("*").eq("id", id).maybeSingle();
  const m = data as Mission | null;
  if (!m) return "No such mission.";
  if (!m.can_code || !m.work_dir) return "Not allowed: Thomas hasn't approved coding for this mission.";
  if (m.worker === "working") return "The coder is already working on a step. Check back later.";
  if (!fs.existsSync(m.work_dir)) return `The folder ${m.work_dir} doesn't exist on this PC. Ask Thomas where the project lives.`;
  await db().from("missions").update({ worker: "working" }).eq("id", id);
  await logMission(id, "work", `Started: ${instructions}`);
  const branch = `mymanager/${shortId(id)}`;
  const prompt = `You are doing one step of a bigger job for Thomas, supervised by his MyManager app.
The job: ${m.goal}
This step: ${instructions}

Rules:
- Work on the git branch "${branch}" (create it from the current branch if it doesn't exist). Commit when the step works, with a clear message. Never push, never deploy, never merge into main.
- Don't touch secrets, .env files, API keys or anything with real money (trading stays on pretend money).
- Keep the change small and focused on this step. Run the tests if there are any.
- If you need a decision or something only Thomas can give, stop and ask it.
End your reply with exactly one line, either "RESULT: done - <one line on what changed>" or "RESULT: stuck - <the one question for Thomas>".`;
  const isWin = process.platform === "win32";
  const args = ["-p", "--output-format", "json", "--permission-mode", "acceptEdits", "--allowedTools", CODER_TOOLS.join(","), "--disallowedTools", CODER_DENY.join(",")];
  const argv = isWin ? args.map((a) => (/[\s&()^|<>]/.test(a) ? `"${a}"` : a)) : args;
  const child = spawn(process.env.CLAUDE_BIN ?? "claude", argv, { cwd: m.work_dir, shell: isWin, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (d) => { out += d.toString(); });
  child.stderr.on("data", (d) => { err += d.toString(); });
  child.stdin.write(prompt);
  child.stdin.end();
  const timer = setTimeout(() => child.kill(), 45 * 60_000);
  const finish = async (text: string) => {
    clearTimeout(timer);
    await db().from("missions").update({ worker: "idle", next_check_at: new Date().toISOString() }).eq("id", id);
    await logMission(id, "work", text);
    void checkMission(id).catch(() => {});
  };
  child.on("error", (e) => { void finish(`The coder couldn't start: ${e.message}`); });
  child.on("close", (code) => {
    let result = "";
    try { result = String(JSON.parse(out).result ?? ""); } catch { result = out.slice(-1500); }
    const line = result.match(/RESULT:\s*(done|stuck)\s*[-–:]\s*(.+)/i);
    void finish(line ? `${line[1].toLowerCase() === "done" ? "Done" : "Stuck"}: ${line[2].trim()}` : code === 0 ? result.slice(-800) || "Finished the step." : `The coder stopped (${code}). ${err.slice(-400)}`);
  });
  return `Started the coder on: ${instructions}. It works on the branch ${branch} and reports back when finished; the mission is checked again then.`;
}
