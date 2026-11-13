import type { Project, Signals, Task } from "./types";

export type HealthLevel = "good" | "warn" | "bad" | "idle";
export interface Health { level: HealthLevel; label: string; reasons: string[] }

const DAY = 86_400_000;
const melbDate = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date(ms));

/** Traffic light for a project: red = something is broken or late, amber = drifting, green = on track. */
export function projectHealth(p: Project, tasks: Task[], signal?: Signals, now = Date.now()): Health {
  if (p.status !== "active") return { level: "idle", label: p.status === "done" ? "Done" : "Not active", reasons: [] };
  const today = melbDate(now);
  const mine = tasks.filter((t) => t.project_id === p.id);
  const open = mine.filter((t) => t.status !== "done");
  const bad: string[] = [];
  const warn: string[] = [];

  if (signal?.vercel?.state === "ERROR") bad.push("deploy failing");
  if (p.deadline && p.deadline.slice(0, 10) < today) bad.push("past its deadline");
  const overdue = open.filter((t) => t.due && t.due.slice(0, 10) < today).length;
  if (overdue) bad.push(`${overdue} overdue task${overdue > 1 ? "s" : ""}`);

  const idleDays = Math.floor((now - new Date(p.last_touched_at).getTime()) / DAY);
  if (idleDays >= 14) bad.push(`untouched ${idleDays} days`);
  else if (idleDays >= 7) warn.push(`untouched ${idleDays} days`);
  if (!p.next_action) warn.push("no next action");
  if (open.length === 0) warn.push("no open tasks");
  if (p.deadline) {
    const left = Math.ceil((new Date(p.deadline).getTime() - now) / DAY);
    if (left >= 0 && left <= 3 && open.length > 2) warn.push(`due in ${left}d with ${open.length} tasks open`);
  }

  if (bad.length) return { level: "bad", label: "At risk", reasons: [...bad, ...warn] };
  if (warn.length) return { level: "warn", label: "Needs a nudge", reasons: warn };
  return { level: "good", label: "On track", reasons: [] };
}

export const HEALTH_TONE: Record<HealthLevel, string> = { good: "var(--good)", warn: "var(--warn)", bad: "var(--bad)", idle: "var(--faint)" };

/** Tasks completed per day for the last n days (oldest first), Melbourne days. */
export function doneByDay(tasks: Task[], days = 14, now = Date.now()): { date: string; count: number }[] {
  const out = Array.from({ length: days }, (_, i) => ({ date: melbDate(now - (days - 1 - i) * DAY), count: 0 }));
  const idx = new Map(out.map((d, i) => [d.date, i]));
  for (const t of tasks) {
    if (t.status !== "done" || !t.done_at) continue;
    const i = idx.get(melbDate(new Date(t.done_at).getTime()));
    if (i !== undefined) out[i].count++;
  }
  return out;
}
