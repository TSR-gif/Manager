import "server-only";
import { db } from "@/lib/db";
import type { Action, Project } from "@/lib/types";
import { TZ, todayISO } from "@/components/ui";

// Read-only data for the Today screen and the helper pages: what needs Thomas, what's being worked on, what got done.

export type Ask = { id: string; project_id: string | null; question: string | null; goal: string };
export type WaitingStep = { runbook: string; runbookId: string; project_id: string | null; stepId: string; label: string; handoff: boolean; note?: string; url?: string };
export type Work = { key: string; href: string; project_id: string | null; title: string; sub: string; pct: number | null; kind: "mission" | "runbook" | "helper" };
export type Done = { id: string; title: string; undo: unknown; undone: boolean; created_at: string };

type RbStep = { id: string; label: string; status: string; kind: string; approval_id?: string | null; optional?: boolean; note?: string; url?: string };
type Rb = { id: string; title: string; status: string; last_update: string | null; project_id: string | null; steps: { list: RbStep[] } };

export function dayStartISO() {
  const today = todayISO();
  const off = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((x) => x.type === "timeZoneName")?.value.replace("GMT", "") || "+10";
  const norm = /^[+-]\d{1,2}$/.test(off) ? `${off[0]}${off.slice(1).padStart(2, "0")}:00` : off;
  return new Date(`${today}T00:00:00${norm}`).toISOString();
}

export async function todayData(projectId?: string) {
  const [ap, mq, rq, aq] = await Promise.all([
    db().from("actions").select("*").eq("status", "pending").order("created_at", { ascending: false }),
    db().from("missions").select("id,project_id,goal,question,status,last_update,worker,ongoing,done_check,rounds,max_rounds,last_check_at,check_every_minutes").in("status", ["waiting", "running"]).order("created_at"),
    db().from("runbooks").select("id,title,status,last_update,project_id,steps").in("status", ["waiting", "running"]).order("created_at"),
    db().from("activity").select("*").gte("created_at", dayStartISO()).order("created_at", { ascending: false }).limit(30),
  ]);
  const only = <T extends { project_id: string | null }>(xs: T[]) => (projectId ? xs.filter((x) => x.project_id === projectId) : xs);
  const approvals = only((ap.data ?? []) as Action[]);
  type M = { id: string; project_id: string | null; goal: string; question: string | null; status: string; last_update: string | null; worker: string; ongoing?: boolean; done_check?: string | null; rounds?: number; max_rounds?: number; last_check_at: string | null; check_every_minutes: number };
  const missions = only((mq.data ?? []) as M[]);
  const runbooks = only((rq.data ?? []) as Rb[]);

  const asks: Ask[] = missions.filter((m) => m.status === "waiting").map((m) => ({ id: m.id, project_id: m.project_id, question: m.question, goal: m.goal }));
  const steps: WaitingStep[] = runbooks.flatMap((r) => (r.steps?.list ?? [])
    .filter((s) => s.status === "waiting" && !s.approval_id)
    .map((s) => ({ runbook: r.title, runbookId: r.id, project_id: r.project_id, stepId: s.id, label: s.label, handoff: s.kind === "handoff", note: s.note, url: s.url && /^https:\/\//.test(s.url) ? s.url : undefined })));

  // progress: ticked-off steps of each mission
  const ids = missions.filter((m) => m.status === "running").map((m) => m.id);
  const { data: tq } = ids.length ? await db().from("tasks").select("mission_id,status").in("mission_id", ids) : { data: [] };
  const tasks = (tq ?? []) as { mission_id: string; status: string }[];
  const work: Work[] = [
    ...runbooks.filter((r) => r.status === "running").map((r) => {
      const list = r.steps?.list ?? [];
      const done = list.filter((s) => ["done", "skipped"].includes(s.status)).length;
      const now = list.find((s) => s.status === "running");
      return { key: r.id, href: "/supervise", project_id: r.project_id, kind: "runbook" as const, title: r.title,
        sub: `step ${Math.min(done + 1, list.length)} of ${list.length}${now ? ` · ${now.label}` : r.last_update ? ` · ${r.last_update}` : ""}`,
        pct: list.length ? done / list.length : null };
    }),
    ...missions.filter((m) => m.status === "running").map((m) => {
      const mine = tasks.filter((t) => t.mission_id === m.id);
      const done = mine.filter((t) => t.status === "done").length;
      const loop = m.done_check ? (m.rounds ?? 0) / Math.max(1, m.max_rounds ?? 6) : null;
      return { key: m.id, href: `/supervise?m=${m.id}`, project_id: m.project_id, kind: m.ongoing ? "helper" as const : "mission" as const,
        title: m.goal.length > 70 ? m.goal.slice(0, 68) + "…" : m.goal,
        sub: m.worker === "working" ? "coding a step now" : m.last_update ?? (m.ongoing ? "looking after it" : "on it"),
        pct: m.ongoing ? null : loop ?? (mine.length ? done / mine.length : null) };
    }),
  ];
  const done = ((aq.data ?? []) as Done[]);
  return { approvals, asks, steps, work, done, needCount: approvals.length + asks.length + steps.length };
}

/** The next thing on the calendar: the soonest open to-do with a date from today on. */
export async function nextOnCalendar(): Promise<{ title: string; when: string } | null> {
  const { data } = await db().from("tasks").select("title,due").neq("status", "done").gte("due", todayISO()).order("due").limit(1);
  const t = (data ?? [])[0] as { title: string; due: string } | undefined;
  if (!t) return null;
  const d = t.due.slice(0, 10);
  const when = d === todayISO() ? "today" : d === todayISO(1) ? "tomorrow" : new Date(`${d}T12:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
  return { title: t.title, when };
}

export const projectNames = (projects: Pick<Project, "id" | "name">[]) => (id: string | null) => projects.find((p) => p.id === id)?.name;
