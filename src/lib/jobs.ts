import "server-only";
import { db } from "@/lib/db";
import { runAgent } from "@/lib/agent/run";
import { notify } from "@/lib/notify";

/**
 * Recurring per-project jobs ("every Wednesday at 2 pm, make this week's Bargie posts").
 * The proactive tick calls runDueJobs(); "Run now" calls runJob(). A job is just a standing
 * instruction for the assistant: anything it makes that goes outside lands in Approvals.
 */
export interface Job {
  id: string; project_id: string | null; name: string; instructions: string;
  days: string; at_time: string; source_url: string | null; enabled: boolean;
  last_run_at: string | null; last_run_id: string | null; created_at: string;
}

const TZ = "Australia/Melbourne";
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_NAME: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

const nowMel = () => {
  const d = new Date();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const day = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short" }).format(d).toLowerCase().slice(0, 3);
  return { date, time, day };
};
const melDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));

export const dayList = (days: string) => days.split(",").map((d) => d.trim().toLowerCase()).filter((d) => (DAYS as readonly string[]).includes(d));

/** "Every Wednesday at 2 pm" */
export function scheduleText(j: Pick<Job, "days" | "at_time">) {
  const d = dayList(j.days);
  const [h, m] = j.at_time.split(":").map(Number);
  const time = `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
  const when = d.length === 7 ? "Every day" : d.length === 5 && !d.includes("sat") && !d.includes("sun") ? "Weekdays" : `Every ${d.map((x) => DAY_NAME[x]).join(" and ")}`;
  return `${when} at ${time}`;
}

export function isDue(j: Job) {
  if (!j.enabled) return false;
  const { date, time, day } = nowMel();
  if (!dayList(j.days).includes(day) || time < j.at_time) return false;
  return !j.last_run_at || melDate(j.last_run_at) !== date;
}

export function goalFor(j: Job, projectName: string | null) {
  return `Scheduled job "${j.name}"${projectName ? ` for the ${projectName} project` : ""}. Thomas set this up to run on its own (${scheduleText(j)}); he isn't watching right now.
${j.source_url ? `Real data for this job: ${j.source_url} (read it with web fetch).\n` : ""}
What to do:
${j.instructions}

Rules for scheduled jobs: use real information only, never made-up numbers. Anything that would be published, posted or sent goes to Approvals as a draft (draft_social_post for social posts and replies, request_approval for anything else). Finish with a short summary for Thomas: what you made, what's waiting for his OK, and anything you couldn't do and what you need from him.`;
}

let busy = false;

export async function runJob(id: string) {
  const { data: j } = await db().from("jobs").select("*").eq("id", id).maybeSingle();
  if (!j) return null;
  const job = j as Job;
  const { data: p } = job.project_id ? await db().from("projects").select("name").eq("id", job.project_id).maybeSingle() : { data: null };
  await db().from("jobs").update({ last_run_at: new Date().toISOString() }).eq("id", id);
  let summary = "";
  const runId = await runAgent(goalFor(job, p?.name ?? null), (e) => { if (e.type === "done") summary = e.summary; }, undefined, { kind: "job" });
  await db().from("jobs").update({ last_run_id: runId }).eq("id", id);
  await db().from("agent_runs").update({ unread: true }).eq("id", runId);
  if (summary) await notify(`🗓 ${job.name}\n${summary.split(/\n\s*\n/)[0]}`);
  return runId;
}

export async function runDueJobs() {
  if (busy) return [];
  busy = true;
  try {
    const { data } = await db().from("jobs").select("*").eq("enabled", true);
    const due = ((data ?? []) as Job[]).filter(isDue);
    const ran: string[] = [];
    for (const j of due) { const r = await runJob(j.id); if (r) ran.push(j.name); }
    return ran;
  } finally {
    busy = false;
  }
}
