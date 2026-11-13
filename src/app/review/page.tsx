import Link from "next/link";
import { completeReview, setProjectStatus } from "@/app/actions";
import { db, unwrap } from "@/lib/db";
import { getIdeas, getProjects, getSettings, getTasks } from "@/lib/queries";
import { ago } from "@/components/ui";
import type { FocusSession, Task } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Review() {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [projects, openTasks, settings, inbox] = await Promise.all([getProjects(), getTasks(), getSettings(), getIdeas("inbox")]);
  const done: Task[] = unwrap(await db().from("tasks").select("*").eq("status", "done").gte("done_at", since));
  const sessions: FocusSession[] = unwrap(await db().from("focus_sessions").select("*").gte("started_at", since));
  const minutes = sessions.reduce((m, s) => m + (s.ended_at ? (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000 : 0), 0);
  const active = projects.filter((p) => p.status === "active");
  const stalled = active.filter((p) => Date.now() - new Date(p.last_touched_at).getTime() > 7 * 86_400_000);
  const byProject = (id: string | null) => done.filter((t) => t.project_id === id).length;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Weekly review</h1>
      <div className="text-sm text-muted">Last review: {ago(settings.last_review_at)}</div>

      <div className="grid grid-cols-3 gap-3">
        <div className="card"><div className="label">Tasks done</div><div className="text-2xl font-bold">{done.length}</div></div>
        <div className="card"><div className="label">Focus hours</div><div className="text-2xl font-bold">{(minutes / 60).toFixed(1)}</div></div>
        <div className="card"><div className="label">Open tasks</div><div className="text-2xl font-bold">{openTasks.length}</div></div>
      </div>

      <section className="card">
        <div className="label mb-2">1. What moved</div>
        <ul className="space-y-1 text-sm">
          {active.map((p) => (
            <li key={p.id} className="flex justify-between"><Link href={`/projects/${p.id}`} className="hover:underline">{p.name}</Link><span className="text-muted">{byProject(p.id)} done</span></li>
          ))}
          <li className="flex justify-between"><span>Everyday</span><span className="text-muted">{byProject(null)} done</span></li>
        </ul>
      </section>

      <section className="card">
        <div className="label mb-2">2. What stalled — keep, pause or drop?</div>
        {stalled.length === 0 && <div className="text-sm text-muted">Nothing stalled. Nice.</div>}
        <ul className="space-y-2">
          {stalled.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2">
              <span className="flex-1">{p.name} <span className="text-xs text-muted">untouched {ago(p.last_touched_at)}</span></span>
              <form action={setProjectStatus.bind(null, p.id, "paused")}><button className="btn">Pause</button></form>
              <form action={setProjectStatus.bind(null, p.id, "archived")}><button className="btn btn-bad">Drop</button></form>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="label mb-2">3. Reset priorities</div>
        <p className="text-sm text-muted">
          You have {active.length} active projects (limit {settings.max_active_projects}).{" "}
          <Link href="/projects" className="text-accent">Adjust priorities and deadlines →</Link>
        </p>
        {inbox.length > 0 && <p className="mt-1 text-sm"><Link href="/inbox" className="text-accent">Triage {inbox.length} ideas →</Link></p>}
      </section>

      <form action={completeReview}><button className="btn btn-primary w-full">Finish review</button></form>
    </div>
  );
}
