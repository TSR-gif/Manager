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
export async function monthSpendCents(): Promise<number> {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const rows: { cost_cents: number }[] = unwrap(
    await db().from("actions").select("cost_cents")
      .in("status", ["approved", "executed"]).gte("created_at", start.toISOString()),
  );
  return rows.reduce((s, r) => s + r.cost_cents, 0);
}
