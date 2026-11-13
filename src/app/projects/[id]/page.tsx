import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, GitBranch, Globe, Plus, TriangleAlert } from "lucide-react";
import { addTask, answerMissionForm, decideAction, saveBrief, saveProject, saveRules, setProjectFolder, studyNow, toggleWatch } from "@/app/actions";
import { Md } from "@/components/md";
import { getActions, getProject, getSettings, getTasks } from "@/lib/queries";
import { getSignals } from "@/lib/signals";
import { ProjectAvatar, priorityLabel, ago, money } from "@/components/ui";
import { ProjectAsk } from "@/components/project-ask";
import { db } from "@/lib/db";
import { TaskItem } from "@/components/task-item";
import type { Project } from "@/lib/types";
import { projectHealth } from "@/lib/health";
import { localState } from "@/lib/local-repos";

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
  const signals = isNew ? {} : await getSignals([p]);
  const s = signals[p.id];
  const log = actions.filter((a) => a.project_id === p.id).slice(0, 12);
  const health = isNew ? null : projectHealth(p, tasks, s);
  const localPath = (p as { local_path?: string | null }).local_path ?? null;
  const bp = p as Project & { brief?: string | null; brief_updated_at?: string | null; brief_edited_by_you?: boolean; rules?: string | null };
  const hasCodeHere = !!(p.github_repo || localPath);
  const local = !isNew && localPath ? await localState(localPath) : null;

  const form = (
    <form action={saveProject} className="space-y-4">
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
            {[1, 2, 3, 4, 5].map((x) => <option key={x} value={x}>{priorityLabel(x)}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Goal"><input name="goal" defaultValue={p.goal ?? ""} placeholder="What does done look like?" /></Field>
      <Field label="Next step"><input name="next_action" defaultValue={p.next_action ?? ""} placeholder="The very next physical step" /></Field>
      <Field label="Deadline"><input type="date" name="deadline" defaultValue={p.deadline ?? ""} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="GitHub repo"><input name="github_repo" defaultValue={p.github_repo ?? ""} placeholder="TSR-gif/name" /></Field>
        <Field label="Vercel project"><input name="vercel_project" defaultValue={p.vercel_project ?? ""} placeholder="project-name" /></Field>
      </div>
      <Field label="Notes"><textarea name="notes" rows={4} defaultValue={p.notes ?? ""} placeholder="Links, context, anything" /></Field>
      {cap && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="force" value="1" className="!w-auto" /> Activate anyway</label>}
      <button className="btn btn-primary w-full">{isNew ? "Create project" : "Save changes"}</button>
    </form>
  );

  if (isNew) {
    return (
      <div className="fade-in mx-auto max-w-[640px] space-y-6">
        <Link href="/projects" className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-text"><ArrowLeft size={14} /> Projects</Link>
        <h1 className="display text-[26px] md:text-[30px]">New project</h1>
        {cap && <div className="card card-alert flex items-start gap-3"><TriangleAlert size={18} className="mt-0.5 text-warn" /><div className="text-[14px]">You already have {settings.max_active_projects} active projects. Pause one first, or tick <b>activate anyway</b>.</div></div>}
        <section className="card">{form}</section>
      </div>
    );
  }

  const pend = actions.filter((a) => a.project_id === p.id && a.status === "pending");
  const { data: wq } = await db().from("missions").select("id,question").eq("project_id", p.id).eq("status", "waiting");
  const asks = (wq ?? []) as { id: string; question: string | null }[];
  const needN = pend.length + asks.length;
  const status = needN ? `${needN} thing${needN === 1 ? "" : "s"} need${needN === 1 ? "s" : ""} you` : health?.level === "bad" ? "Something's wrong, I'm looking into it" : p.status === "active" ? "On track. Nothing needs you." : p.status[0].toUpperCase() + p.status.slice(1);
  const top = open.slice(0, 5), more = open.slice(5);

  return (
    <div className="fade-in mx-auto max-w-[620px] space-y-7 pt-2 md:pt-8">
      <Link href="/projects" className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-text"><ArrowLeft size={14} /> Projects</Link>

      <header className="flex items-center gap-3.5">
        <ProjectAvatar name={p.name} size={40} />
        <div className="min-w-0">
          <h1 className="display truncate text-[26px] md:text-[28px]">{p.name}</h1>
          <div className={`text-[14px] ${needN ? "text-warn" : "text-muted"}`}>{status}</div>
        </div>
      </header>

      {needN > 0 && (
        <ul className="card card-alert divide-y divide-line !p-0">
          {asks.map((m) => (
            <li key={m.id} className="px-4 py-3.5">
              <div className="text-[14.5px] leading-snug">{m.question}</div>
              <form action={answerMissionForm} className="mt-2.5 flex gap-2">
                <input type="hidden" name="id" value={m.id} />
                <input name="answer" placeholder="Your answer" required autoComplete="off" className="!h-10" />
                <button className="btn btn-primary shrink-0 !h-10">Send</button>
              </form>
            </li>
          ))}
          {pend.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 text-[14.5px] leading-snug">{a.title}</div>
              <form action={decideAction.bind(null, a.id, false)}><button className="btn btn-ghost btn-sm">Not now</button></form>
              <form action={decideAction.bind(null, a.id, true)}><button className="btn btn-good btn-sm">{a.cost_cents > 0 ? `OK, ${money(a.cost_cents)}` : "OK"}</button></form>
            </li>
          ))}
        </ul>
      )}

      <ProjectAsk name={p.name} />

      <section>
        <h2 className="mb-2 text-[15px] font-semibold px-1">Your to-dos</h2>
        <div className="card !px-2 !py-1.5">
          {open.length === 0 && <div className="px-2 py-3 text-[14px] text-muted">Nothing for you to do here.</div>}
          <ul>{top.map((t) => <TaskItem key={t.id} t={t} compact />)}</ul>
          {more.length > 0 && (
            <details>
              <summary className="cursor-pointer list-none px-2 py-2 text-[13px] text-muted hover:text-text">{more.length} more</summary>
              <ul>{more.map((t) => <TaskItem key={t.id} t={t} compact />)}</ul>
            </details>
          )}
          <form action={addTask} className="flex items-center gap-2 border-t border-line px-2 pb-1 pt-2">
            <input type="hidden" name="project_id" value={p.id} />
            <Plus size={16} className="ml-1 text-faint" />
            <input name="title" placeholder="Add a to-do" autoComplete="off" required className="!h-9 flex-1 !border-0 !bg-transparent !px-1 !shadow-none text-[14px]" />
          </form>
        </div>
      </section>

      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-1 text-[13px] text-faint hover:text-muted">
          <ChevronRight size={14} className="transition group-open:rotate-90" /> Details
        </summary>
        <div className="mt-3 space-y-4">
      <section className="card">
        {p.goal && <div className="mb-3 text-[14px]"><span className="label mr-2">Goal</span>{p.goal}</div>}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-semibold">What I know about it</span>
          <span className="text-[12px] text-faint">
            {bp.brief_updated_at ? `written ${ago(bp.brief_updated_at)}${bp.brief_edited_by_you ? ", corrected by you" : ""}` : hasCodeHere ? "not studied yet" : "no code to study"}
          </span>
          {hasCodeHere && (
            <form action={studyNow} className="ml-auto">
              <input type="hidden" name="id" value={p.id} />
              <button className="btn btn-sm">{bp.brief ? "Study it again" : "Study it now"}</button>
            </form>
          )}
        </div>
        {bp.brief ? (
          <details className="group">
            <summary className="cursor-pointer list-none">
              <Md text={bp.brief.split(/\n(?=## )/).slice(0, 1).join("")} className="text-[14px] leading-relaxed" />
              <span className="mt-2 inline-block text-[13px] text-accent group-open:hidden">Show more</span>
            </summary>
            <Md text={bp.brief.split(/\n(?=## )/).slice(1).join("\n")} className="mt-2.5 text-[14px] leading-relaxed" />
            <details className="mt-3">
              <summary className="cursor-pointer list-none text-[13px] text-accent">Fix something in it</summary>
              <form action={saveBrief} className="mt-2 space-y-2">
                <input type="hidden" name="id" value={p.id} />
                <textarea name="brief" defaultValue={bp.brief} rows={14} className="font-mono !text-[12.5px]" />
                <button className="btn">Save</button>
              </form>
            </details>
          </details>
        ) : hasCodeHere ? (
          <p className="text-[13.5px] text-muted">MyManager will read the code and write down what it is, how to run it, where it&apos;s at and what&apos;s next. It does this by itself soon, or press Study it now.</p>
        ) : (
          <form action={saveBrief} className="space-y-2">
            <p className="text-[13.5px] text-muted">No code for this one, so tell MyManager what it is, where it&apos;s at and what&apos;s next.</p>
            <input type="hidden" name="id" value={p.id} />
            <textarea name="brief" rows={4} placeholder={"What it is:\nWhere it's at:\nWhat's next:"} />
            <button className="btn">Save</button>
          </form>
        )}
        {bp.rules && <div className="mt-3 border-t border-line pt-3 text-[13px] text-muted"><span className="label mr-2">Your rules</span>{bp.rules}</div>}
      </section>

      <section className="card">
        <div className="space-y-6">
          <form action={saveRules} className="space-y-2">
            <input type="hidden" name="id" value={p.id} />
            <span className="label">Your rules (MyManager always follows these)</span>
            <textarea name="rules" defaultValue={bp.rules ?? ""} rows={2} placeholder="e.g. Pretend money only. Never touch the live site on Fridays." />
            <button className="btn btn-sm">Save rules</button>
          </form>
          <div className="space-y-2">
            <span className="label">Folder on this PC</span>
            {local && (
              <div className="grid gap-x-6 gap-y-1 text-[13px] text-muted sm:grid-cols-2">
                <div>Branch <span className="font-mono text-text">{local.branch}</span>{local.ahead ? <span className="text-warn"> · {local.ahead} not pushed</span> : null}</div>
                <div>Unsaved changes {local.changed ? <span className="text-warn">{local.changed}</span> : "none"}</div>
                <div className="truncate sm:col-span-2">Last commit {local.lastCommit || "none"}</div>
              </div>
            )}
            <form action={setProjectFolder} className="flex gap-2">
              <input type="hidden" name="id" value={p.id} />
              <input name="local_path" defaultValue={localPath ?? ""} placeholder="e.g. C:\\Users\\you\\Documents\\DayTrader" className="font-mono !text-[13px]" />
              <button className="btn shrink-0">Save</button>
            </form>
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={toggleWatch}><input type="hidden" name="id" value={p.id} /><button className="btn btn-sm">{(p as { watch?: boolean }).watch ? "Stop keeping an eye on it" : "Keep an eye on it"}</button></form>
            {p.kind !== "client" && <Link href={`/marketing?project=${p.id}`} className="btn btn-sm">Posts and ads</Link>}
          </div>
          <div className="flex flex-wrap gap-2">
            {s?.vercel?.url && <a className="btn btn-sm" href={s.vercel.url} target="_blank"><Globe size={14} /> Live site</a>}
            {p.github_repo && <a className="btn btn-sm" href={`https://github.com/${p.github_repo}`} target="_blank"><GitBranch size={14} /> Code</a>}
          </div>
          {form}
        </div>
      </section>

      {log.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer list-none text-[15px] font-semibold">History <span className="text-[12px] font-normal text-faint">{log.length}</span></summary>
          <ul className="mt-3 divide-y divide-line text-[13.5px]">
            {log.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                <span className="truncate">{a.title}</span>
                <span className="shrink-0 text-[12px] text-muted">{a.status} · {ago(a.created_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
        </div>
      </details>
    </div>
  );
}
