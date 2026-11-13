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

const TIPS = [
  "Tap the mic and just say what you need. I'll read the answer back.",
  "Ask \"how's my Day trader going?\" and I'll go and look at the code, tasks and site.",
  "Type + and a task anywhere (or in Telegram) to add it in two seconds.",
  "Approvals can be done straight from Telegram, no need to open the app.",
  "Say \"wrap up my day\" tonight and I'll help you decide what moves to tomorrow.",
  "Everything I do shows under \"What MyManager did today\" with an Undo.",
  "The About you page is what I know about you. Fix anything that's wrong.",
  "Client hours go on the Money page, and I can turn them into an invoice.",
  "Mark a project \"Keep an eye on this\" and I'll tell you when it slips.",
  "Settings → How often can MyManager message me? Change it any time.",
];

export function briefPrompt(dayNumber = 99) {
  const tip = dayNumber >= 1 && dayNumber <= TIPS.length ? `\nEnd with one line starting "Tip:" followed by: ${TIPS[dayNumber - 1]}` : "";
  return `Give me my morning catch-up. Lead with the one thing to do first today and why, in one line. Then a plan of at most 5 things in order, and anything waiting for my OK. If any projects are being supervised (supervised_missions in get_overview), add one line per project: what's running, what finished, and what needs me. Mention money only if something needs attention. Don't lead with or count overdue tasks: fold anything from earlier days into the plan or ask "still want these?". Add any missing tasks. End with "OK with this plan? Reply OK and I'll set it up." Keep it short enough to read on a phone in 15 seconds.${tip}`;
}
export const BRIEF_PROMPT = briefPrompt();

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

let lastFolderScan = 0;
export async function tick(force?: "brief" | "checkin") {
  // recurring per-project jobs run on their own schedule, alongside the catch-up and check-ins
  if (!force) void import("@/lib/jobs").then((m) => m.runDueJobs()).catch(() => {});
  if (!force) void import("@/lib/missions").then((m) => m.runDueMissions()).catch(() => {});
  // find project folders on this PC now and then (cheap: two levels under the usual places)
  // keep project briefs fresh: one project per pass, only when missing or the code has moved on
  if (!force) void import("@/lib/briefs").then((m) => m.refreshDueBriefs()).catch(() => {});
  if (!force && Date.now() - lastFolderScan > 6 * 3600_000) { lastFolderScan = Date.now(); void import("@/lib/local-repos").then((m) => m.linkProjectFolders()).catch(() => {}); }
  if (running) return { skipped: "busy" };
  const { data: s } = await db().from("settings").select("*").eq("id", 1).single();
  if (!s) return { skipped: "no settings" };
  const { date, time } = nowParts();
  const awake = time >= (s.brief_time ?? "07:30") && time < (s.quiet_start ?? "21:30");
  let due: "brief" | "checkin" | null = force ?? null;
  const mode = (s.message_mode as string) ?? "daily"; // needed | daily | more
  if (!due && s.proactive) {
    // brief once a day; if MyManager wasn't running in the morning, skip it and just check in later
    if (mode !== "needed" && s.last_brief_date !== date && awake && time < "12:00") due = "brief";
    else if (mode !== "daily" && awake && s.checkin_hours > 0 &&
      (!s.last_checkin_at || Date.now() - new Date(s.last_checkin_at).getTime() >= s.checkin_hours * 3600_000)) due = "checkin";
  }
  if (!due) return { skipped: "nothing due" };
  running = true;
  try {
    // mark first so a slow run can't be started twice
    await db().from("settings").update(due === "brief"
      ? { last_brief_date: date, last_checkin_at: new Date().toISOString() }
      : { last_checkin_at: new Date().toISOString() }).eq("id", 1);
    const dayNumber = s.first_seen ? Math.floor((new Date(date).getTime() - new Date(String(s.first_seen).slice(0, 10)).getTime()) / 86_400_000) + 1 : 99;
    return await run(due, due === "brief" ? briefPrompt(dayNumber) : await checkinPrompt());
  } finally {
    running = false;
  }
}
