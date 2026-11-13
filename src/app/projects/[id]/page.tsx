import Link from "next/link";
import { notFound } from "next/navigation";
import { addTask, deleteTask, requestAction, saveProject, setTaskStatus } from "@/app/actions";
import { getActions, getProject, getSettings, getTasks } from "@/lib/queries";
import { getSignals } from "@/lib/signals";
import { SignalChips, ago } from "@/components/ui";
import type { Project } from "@/lib/types";

export const dynamic = "force-dynamic";

const blank: Project = {
  id: "", name: "", status: "idea", priority: 3, next_action: null, goal: null, notes: null,
  github_repo: null, vercel_project: null, deadline: null, last_touched_at: "", created_at: "",
};

export default async function ProjectPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ cap?: string }> }) {
  const { id } = await params;
  const { cap } = await searchParams;
  const isNew = id === "new";
  const p = isNew ? blank : await getProject(id);
  if (!p) notFound();
  const [allTasks, settings, actions] = await Promise.all([getTasks({ includeDone: true }), getSettings(), getActions()]);
  const tasks = allTasks.filter((t) => t.project_id === p.id);
  const signals = isNew ? {} : await getSignals([p]);
  const s = signals[p.id];
  const log = actions.filter((a) => a.project_id === p.id).slice(0, 10);

  return (
    <div className="space-y-5">
      <Link href="/projects" className="text-sm text-muted">← Projects</Link>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{isNew ? "New project" : p.name}</h1>
        <SignalChips s={s} />
        {s?.vercel?.url && <a className="text-sm text-accent" href={s.vercel.url} target="_blank">live site ↗</a>}
        {p.github_repo && <a className="text-sm text-accent" href={`https://github.com/${p.github_repo}`} target="_blank">repo ↗</a>}
      </header>

      {cap && (
        <div className="card text-sm" style={{ borderColor: "#facc15" }}>
          You already have {settings.max_active_projects} active projects. Pause one first, or tick &quot;activate anyway&quot; below.
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-[1fr_1.1fr]">
        <form action={saveProject} className="card space-y-3">
          <input type="hidden" name="id" value={p.id} />
          <label className="block"><span className="label">Name</span><input name="name" defaultValue={p.name} required /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="label">Status</span>
              <select name="status" defaultValue={p.status}>
                {["active", "paused", "idea", "done", "archived"].map((x) => <option key={x}>{x}</option>)}
              </select>
            </label>
            <label className="block"><span className="label">Priority</span>
              <select name="priority" defaultValue={p.priority}>
                {[1, 2, 3, 4, 5].map((x) => <option key={x} value={x}>P{x}{x === 1 ? " (top)" : ""}</option>)}
              </select>
            </label>
          </div>
          <label className="block"><span className="label">Goal</span><input name="goal" defaultValue={p.goal ?? ""} placeholder="What does done look like?" /></label>
          <label className="block"><span className="label">Next action</span><input name="next_action" defaultValue={p.next_action ?? ""} /></label>
          <label className="block"><span className="label">Deadline</span><input type="date" name="deadline" defaultValue={p.deadline ?? ""} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="label">GitHub repo</span><input name="github_repo" defaultValue={p.github_repo ?? ""} placeholder="TSR-gif/name" /></label>
            <label className="block"><span className="label">Vercel project</span><input name="vercel_project" defaultValue={p.vercel_project ?? ""} /></label>
          </div>
          <label className="block"><span className="label">Notes</span><textarea name="notes" rows={4} defaultValue={p.notes ?? ""} /></label>
          {cap && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="force" value="1" className="w-auto" /> activate anyway</label>}
          <button className="btn btn-primary w-full">Save</button>
          {!isNew && <div className="text-xs text-muted">Last touched {ago(p.last_touched_at)}</div>}
        </form>

        {!isNew && (
          <div className="space-y-5">
            <section className="card">
              <div className="label mb-2">Tasks</div>
              <form action={addTask} className="mb-3 flex gap-2">
                <input type="hidden" name="project_id" value={p.id} />
                <input name="title" placeholder="New task" autoComplete="off" required />
                <input name="due" type="date" className="max-w-40" />
                <button className="btn">+</button>
              </form>
              <ul className="divide-y divide-line">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 py-2">
                    <form action={setTaskStatus.bind(null, t.id, t.status === "done" ? "todo" : "done")}>
                      <button className={`h-5 w-5 rounded-full border ${t.status === "done" ? "border-green-500 bg-green-600" : "border-muted"}`} aria-label="toggle" />
                    </form>
                    <span className={`flex-1 ${t.status === "done" ? "text-muted line-through" : ""}`}>{t.title}</span>
                    {t.due && <span className="text-xs text-muted">{t.due}</span>}
                    <form action={deleteTask.bind(null, t.id)}><button className="text-xs text-muted hover:text-red-400">✕</button></form>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card">
              <div className="label mb-2">Ask Manager to do something</div>
              <form action={requestAction} className="space-y-2">
                <input type="hidden" name="project_id" value={p.id} />
                <select name="kind" defaultValue={p.github_repo ? "github.create_issue" : "other"}>
                  {p.github_repo && <option value="github.create_issue">Create GitHub issue (runs now)</option>}
                  {p.vercel_project && <option value="vercel.redeploy">Redeploy on Vercel (needs approval)</option>}
                  <option value="signup">Sign up for a service (needs approval)</option>
                  <option value="purchase">Buy something (needs approval)</option>
                  <option value="other">Something else (needs approval)</option>
                </select>
                <input type="hidden" name="repo" value={p.github_repo ?? ""} />
                <input type="hidden" name="project" value={p.vercel_project ?? ""} />
                <input name="title" placeholder="What should happen?" required />
                <div className="grid grid-cols-2 gap-2">
                  <input name="url" placeholder="Link (optional)" />
                  <input name="cost" type="number" step="0.01" min="0" placeholder="Cost $ (if any)" />
                </div>
                <button className="btn w-full">Queue it</button>
              </form>
            </section>

            {log.length > 0 && (
              <section className="card">
                <div className="label mb-2">Activity</div>
                <ul className="space-y-1 text-sm">
                  {log.map((a) => (
                    <li key={a.id} className="flex justify-between gap-2"><span className="truncate">{a.title}</span><span className="text-muted">{a.status}</span></li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
