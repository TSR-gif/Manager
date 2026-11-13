import "server-only";
import { db } from "@/lib/db";
import { runAgent } from "@/lib/agent/run";
import { notify } from "@/lib/notify";

/**
 * The assistant messages Thomas first, Duet-style:
 *  - a morning brief at brief_time (once a day)
 *  - check-ins every checkin_hours while he's awake, which stay silent unless something needs him
 *  - specialists: projects with watch = true get looked at in every check-in
 * Called every few minutes by the local launcher (POST /api/proactive {op:"tick"}).
 */
const TZ = "Australia/Melbourne";
const nowParts = () => {
  const d = new Date();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return { date, time };
};

let running = false;

export const BRIEF_PROMPT = "Give me my morning brief: what's due or overdue today, the one project I should work on and why, anything waiting for my approval, money if you can see it, and anything stale. Then suggest a realistic plan for today (max 5 things) and add any missing tasks. Keep it short enough to read on a phone.";

async function checkinPrompt() {
  const { data: watched } = await db().from("projects").select("name,goal,next_action").eq("watch", true);
  const specialists = (watched ?? []).length
    ? `\nYou are also the specialist watching these projects. For each, check open tasks, next action and staleness, and flag anything blocked, slipping or worth doing next:\n${(watched ?? []).map((p) => `- ${p.name}: ${p.goal ?? ""} (next: ${p.next_action ?? "none"})`).join("\n")}`
    : "";
  return `Proactive check-in. Thomas did not ask for this; you're checking in on your own.
Call get_overview, then look for things that genuinely need him now: tasks overdue or due today, approvals waiting more than 2 hours, deadlines in the next 3 days, money that looks off, anything that changed.${specialists}
You may tidy small things yourself if your autonomy allows (e.g. add a missing task), but don't make busywork.
If nothing needs him, reply with exactly: NOTHING
Otherwise reply with one short phone-sized message (under 60 words) that leads with what needs him and the one thing to do.`;
}

async function run(kind: "brief" | "checkin", goal: string) {
  let summary = "";
  const runId = await runAgent(goal, (e) => { if (e.type === "done") summary = e.summary; if (e.type === "error") summary = ""; }, undefined, { kind });
  const quiet = kind === "checkin" && (!summary || /^\W*NOTHING\W*$/i.test(summary.trim()));
  await db().from("agent_runs").update({ unread: !quiet }).eq("id", runId);
  if (!quiet && summary) await notify(`${kind === "brief" ? "☀️ " : "👋 "}${summary}`);
  return { runId, kind, quiet };
}

export async function tick(force?: "brief" | "checkin") {
  if (running) return { skipped: "busy" };
  const { data: s } = await db().from("settings").select("*").eq("id", 1).single();
  if (!s) return { skipped: "no settings" };
  const { date, time } = nowParts();
  const awake = time >= (s.brief_time ?? "07:30") && time < (s.quiet_start ?? "21:30");
  let due: "brief" | "checkin" | null = force ?? null;
  if (!due && s.proactive) {
    // brief once a day; if Manager wasn't running in the morning, skip it and just check in later
    if (s.last_brief_date !== date && awake && time < "12:00") due = "brief";
    else if (awake && s.checkin_hours > 0 &&
      (!s.last_checkin_at || Date.now() - new Date(s.last_checkin_at).getTime() >= s.checkin_hours * 3600_000)) due = "checkin";
  }
  if (!due) return { skipped: "nothing due" };
  running = true;
  try {
    // mark first so a slow run can't be started twice
    await db().from("settings").update(due === "brief"
      ? { last_brief_date: date, last_checkin_at: new Date().toISOString() }
      : { last_checkin_at: new Date().toISOString() }).eq("id", 1);
    return await run(due, due === "brief" ? BRIEF_PROMPT : await checkinPrompt());
  } finally {
    running = false;
  }
}
