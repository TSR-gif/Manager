import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, GitBranch, Globe, ListTodo, Send, Settings2, Sparkles, TriangleAlert, History } from "lucide-react";
import { addTask, requestAction, saveProject, toggleWatch } from "@/app/actions";
import { Orb } from "@/components/orb";
import { getActions, getProject, getSettings, getTasks } from "@/lib/queries";
import { getSignals } from "@/lib/signals";
import { Empty, PriorityBadge, ProjectAvatar, SignalChips, StatusDot, ago } from "@/components/ui";
import { TaskItem } from "@/components/task-item";
import type { Project } from "@/lib/types";

export const dynamic = "force-dynamic";

const blank: Project = {
  id: "", name: "", status: "active", priority: 3, next_action: null, goal: null, notes: null,
  github_repo: null, vercel_project: null, deadline: null, last_touched_at: "", created_at: "",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="label">{label}</span>{children}</label>;
}

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
  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");
  const signals = isNew ? {} : await getSignals([p]);
  const s = signals[p.id];
  const log = actions.filter((a) => a.project_id === p.id).slice(0, 12);

  return (
    <div className="fade-in space-y-6">
      <Link href="/projects" className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-text"><ArrowLeft size={14} /> Projects</Link>

      <header className="flex flex-wrap items-center gap-4">
        {!isNew && <ProjectAvatar name={p.name} size={54} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[28px] font-semibold tracking-tight">{isNew ? "New project" : p.name}</h1>
            {!isNew && <StatusDot status={p.status} />}
          </div>
          {!isNew && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <PriorityBadge p={p.priority} />
              {p.kind === "client" && <span className="chip chip-accent2">Client job</span>}
              <span className="chip capitalize">{p.status}</span>
              <SignalChips s={s} />
              <form action={toggleWatch} className="inline">
                <input type="hidden" name="id" value={p.id} />
                <button className={`chip cursor-pointer transition hover:border-accent ${(p as { watch?: boolean }).watch ? "chip-accent" : ""}`}
                  title="A specialist checks this project in every check-in and tells you when it slips">
                  {(p as { watch?: boolean }).watch ? <><Orb size={10} /> Specialist watching</> : "+ Add a specialist"}
                </button>
              </form>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {s?.vercel?.url && <a className="btn" href={s.vercel.url} target="_blank"><Globe size={15} /> Live</a>}
          {p.github_repo && <a className="btn" href={`https://github.com/${p.github_repo}`} target="_blank"><GitBranch size={15} /> Repo <ExternalLink size={12} /></a>}
        </div>
      </header>

      {p.goal && !isNew && (
        <div className="hero !p-4 text-[15px]"><span className="label mr-2">Goal</span>{p.goal}</div>
      )}

      {cap && (
        <div className="card flex items-start gap-3 !border-[rgba(255,200,87,.35)]">
          <TriangleAlert size={18} className="mt-0.5 text-warn" />
          <div className="text-[14px]">You already have {settings.max_active_projects} active projects. Pause one first, or tick <b>activate anyway</b> below.</div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-5">
          {!isNew && (
            <section className="card">
              <div className="mb-3 flex items-center gap-2"><ListTodo size={16} className="text-accent" /><span className="font-semibold">Tasks</span><span className="text-[13px] text-faint">{open.length} open</span></div>
              <form action={addTask} className="mb-2 flex gap-2">
                <input type="hidden" name="project_id" value={p.id} />
                <input name="title" placeholder="Add a task…" autoComplete="off" required />
                <input name="due" type="date" className="!w-40 shrink-0" />
                <button className="btn">Add</button>
              </form>
              {open.length === 0 && <Empty icon={<Sparkles size={18} />} title="No open tasks" hint="Break the next action into 2–3 small steps." />}
              <ul className="-mx-2">{open.map((t) => <TaskItem key={t.id} t={t} />)}</ul>
              {done.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer px-2 text-[12.5px] text-muted">{done.length} completed</summary>
                  <ul className="-mx-2 mt-1">{done.slice(0, 20).map((t) => <TaskItem key={t.id} t={t} compact />)}</ul>
                </details>
              )}
            </section>
          )}

          {!isNew && (
            <section className="card">
              <div className="mb-1 flex items-center gap-2"><Send size={16} className="text-accent2" /><span className="font-semibold">Ask Manager to do something</span></div>
              <p className="mb-3 text-[13px] text-muted">GitHub issues run straight away. Everything else waits for your approval.</p>
              <form action={requestAction} className="space-y-2">
                <input type="hidden" name="project_id" value={p.id} />
                <input type="hidden" name="repo" value={p.github_repo ?? ""} />
                <input type="hidden" name="project" value={p.vercel_project ?? ""} />
                <select name="kind" defaultValue={p.github_repo ? "github.create_issue" : "other"}>
                  {p.github_repo && <option value="github.create_issue">Create a GitHub issue</option>}
                  {p.vercel_project && <option value="vercel.redeploy">Redeploy production on Vercel</option>}
                  <option value="signup">Sign up for a service</option>
                  <option value="purchase">Buy something</option>
                  <option value="email.send">Send an email</option>
                  <option value="pc.session">Do something on my PC</option>
                  <option value="other">Something else</option>
                </select>
                <input name="title" placeholder="What should happen?" required />
                <div className="grid grid-cols-[1fr_9rem] gap-2">
                  <input name="url" placeholder="Link (optional)" />
                  <input name="cost" type="number" step="0.01" min="0" placeholder="Cost $" />
                </div>
                <button className="btn w-full">Queue it</button>
              </form>
            </section>
          )}

          {log.length > 0 && (
            <section className="card">
              <div className="mb-2 flex items-center gap-2"><History size={16} className="text-muted" /><span className="font-semibold">Activity</span></div>
              <ul className="divide-y divide-line text-[13.5px]">
                {log.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="truncate">{a.title}</span>
                    <span className="shrink-0 text-[12px] text-muted">{a.status} · {ago(a.created_at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <form action={saveProject} className="card h-fit space-y-4">
          <div className="flex items-center gap-2"><Settings2 size={16} className="text-muted" /><span className="font-semibold">{isNew ? "Details" : "Settings"}</span></div>
          <input type="hidden" name="id" value={p.id} />
          <Field label="Name"><input name="name" defaultValue={p.name} required placeholder="e.g. Clothing Brand" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select name="status" defaultValue={p.status}>
                {["active", "paused", "idea", "done", "archived"].map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select name="priority" defaultValue={p.priority}>
                {[1, 2, 3, 4, 5].map((x) => <option key={x} value={x}>P{x}{x === 1 ? " · top" : x === 5 ? " · someday" : ""}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Goal"><input name="goal" defaultValue={p.goal ?? ""} placeholder="What does done look like?" /></Field>
          <Field label="Next action"><input name="next_action" defaultValue={p.next_action ?? ""} placeholder="The very next physical step" /></Field>
          <Field label="Deadline"><input type="date" name="deadline" defaultValue={p.deadline ?? ""} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="GitHub repo"><input name="github_repo" defaultValue={p.github_repo ?? ""} placeholder="TSR-gif/name" /></Field>
            <Field label="Vercel project"><input name="vercel_project" defaultValue={p.vercel_project ?? ""} placeholder="project-name" /></Field>
          </div>
          <Field label="Notes"><textarea name="notes" rows={5} defaultValue={p.notes ?? ""} placeholder="Links, context, anything" /></Field>
          {cap && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="force" value="1" className="!w-auto" /> Activate anyway</label>}
          <button className="btn btn-primary w-full">{isNew ? "Create project" : "Save changes"}</button>
        </form>
      </div>
    </div>
  );
}
