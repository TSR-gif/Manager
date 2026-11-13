import "server-only";
import { db, unwrap } from "./db";
import type { Action, FocusSession, Idea, Project, Settings, Task } from "./types";

export async function getProjects(): Promise<Project[]> {
  return unwrap(await db().from("projects").select("*").order("priority").order("name"));
}
export async function getProject(id: string): Promise<Project | null> {
  const { data } = await db().from("projects").select("*").eq("id", id).maybeSingle();
  return data;
}
export async function getTasks(opts: { includeDone?: boolean } = {}): Promise<Task[]> {
  let q = db().from("tasks").select("*").order("created_at", { ascending: false });
  if (!opts.includeDone) q = q.neq("status", "done");
  return unwrap(await q);
}
export async function getIdeas(status?: Idea["status"]): Promise<Idea[]> {
  let q = db().from("ideas").select("*").order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  return unwrap(await q);
}
export async function getActiveFocus(): Promise<FocusSession | null> {
  const { data } = await db()
    .from("focus_sessions").select("*").is("ended_at", null)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  return data;
}
export async function getActions(status?: Action["status"][]): Promise<Action[]> {
  let q = db().from("actions").select("*").order("created_at", { ascending: false }).limit(200);
  if (status) q = q.in("status", status);
  return unwrap(await q);
}
export async function getSettings(): Promise<Settings> {
  return unwrap(await db().from("settings").select("*").eq("id", 1).single());
}
/** Spend this month. includePending also counts paid actions still waiting for his OK. */
export async function monthSpendCents(opts: { includePending?: boolean } = {}): Promise<number> {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const rows: { cost_cents: number }[] = unwrap(
    await db().from("actions").select("cost_cents")
      .in("status", opts.includePending ? ["pending", "approved", "executed"] : ["approved", "executed"]).gte("created_at", start.toISOString()),
  );
  return rows.reduce((s, r) => s + r.cost_cents, 0);
}

/** Tasks completed and focus minutes since local midnight (Melbourne). */
export async function todayStats(): Promise<{ done: number; focusMinutes: number }> {
  const midnight = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Australia/Melbourne" }).replace(/,.*/, ""),
  );
  // Melbourne midnight expressed in UTC: compute offset between server time and Melbourne
  const now = new Date();
  const melNow = new Date(now.toLocaleString("en-US", { timeZone: "Australia/Melbourne" }));
  const offset = melNow.getTime() - now.getTime();
  const since = new Date(midnight.getTime() - offset).toISOString();
  const [{ count }, sessions] = await Promise.all([
    db().from("tasks").select("id", { count: "exact", head: true }).eq("status", "done").gte("done_at", since),
    db().from("focus_sessions").select("started_at,ended_at,planned_minutes").gte("started_at", since),
  ]);
  const focusMinutes = (sessions.data ?? []).reduce((m: number, s: { started_at: string; ended_at: string | null }) => {
    const end = s.ended_at ? new Date(s.ended_at).getTime() : Date.now();
    return m + Math.max(0, (end - new Date(s.started_at).getTime()) / 60000);
  }, 0);
  return { done: count ?? 0, focusMinutes: Math.round(focusMinutes) };
}
