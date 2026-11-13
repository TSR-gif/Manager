import Link from "next/link";
import { addTask, endFocus, quickCapture, setTaskStatus, startFocus } from "./actions";
import { nextTasks, rankProjects } from "@/lib/focus";
import { getActions, getActiveFocus, getIdeas, getProjects, getSettings, getTasks } from "@/lib/queries";
import { getSignals } from "@/lib/signals";
import { SignalChips } from "@/components/ui";
import { FocusTimer } from "@/components/focus-timer";
import type { Task } from "@/lib/types";

export const dynamic = "force-dynamic";

function TaskRow({ t, projectName }: { t: Task; projectName?: string }) {
  const overdue = t.due && new Date(t.due).getTime() < Date.now();
  return (
    <li className="flex items-center gap-3 py-2">
      <form action={setTaskStatus.bind(null, t.id, "done")}>
        <button aria-label="Mark done" className="h-5 w-5 rounded-full border border-muted hover:border-accent" />
      </form>
      <div className="min-w-0 flex-1">
        <div className="truncate">{t.title}</div>
        <div className="flex gap-2 text-xs text-muted">
          {projectName && <span>{projectName}</span>}
          {t.status === "doing" && <span className="text-accent">in progress</span>}
          {t.due && <span style={overdue ? { color: "#f87171" } : undefined}>due {t.due}</span>}
        </div>
      </div>
      {t.status === "todo" && (
        <form action={setTaskStatus.bind(null, t.id, "doing")}>
          <button className="text-xs text-muted hover:text-text">start</button>
        </form>
      )}
    </li>
  );
}

export default async function Today() {
  const [projects, tasks, focus, pending, inbox, settings] = await Promise.all([
    getProjects(), getTasks(), getActiveFocus(), getActions(["pending"]), getIdeas("inbox"), getSettings(),
  ]);
  const signals = await getSignals(projects.filter((p) => p.status === "active"));
  const ranked = rankProjects(projects, tasks, signals);
  const top = ranked[0];
  const focusProject = focus?.project_id ? projects.find((p) => p.id === focus.project_id) : null;
  const target = focusProject ?? top?.project;
  const targetTasks = target ? nextTasks(target.id, tasks) : [];
  const everyday = tasks.filter((t) => !t.project_id).slice(0, 12);
  const reviewDue = !settings.last_review_at || Date.now() - new Date(settings.last_review_at).getTime() > 7 * 86_400_000;
  const greeting = (() => {
    const h = Number(new Intl.DateTimeFormat("en-AU", { hour: "numeric", hour12: false, timeZone: "Australia/Melbourne" }).format(new Date()));
    return h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening";
  })();

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <div className="label">{new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short", timeZone: "Australia/Melbourne" })}</div>
          <h1 className="text-2xl font-bold">{greeting}, Thomas</h1>
        </div>
        <div className="flex gap-2">
          {pending.length > 0 && <Link href="/approvals" className="btn btn-primary">{pending.length} to approve</Link>}
        </div>
      </header>

      <form action={quickCapture} className="flex gap-2">
        <input name="text" placeholder='Capture anything… "idea: …", "#rewards fix login", "call bank"' autoComplete="off" />
        <button className="btn">Add</button>
      </form>

      {/* THE ONE THING */}
      <section className="card border-accent/50" style={{ borderColor: "color-mix(in srgb, var(--accent) 45%, transparent)" }}>
        {target ? (
          <>
            <div className="label">{focus ? "You're focused on" : "Work on this now"}</div>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <Link href={`/projects/${target.id}`} className="text-2xl font-bold hover:underline">{target.name}</Link>
              <SignalChips s={signals[target.id]} />
            </div>
            {!focus && top && <div className="mt-1 text-sm text-muted">Why: {top.reasons.join(" · ")}</div>}
            {target.next_action && <div className="mt-3"><span className="text-muted">Next action: </span>{target.next_action}</div>}

            <ul className="mt-3 divide-y divide-line">
              {targetTasks.map((t) => <TaskRow key={t.id} t={t} />)}
            </ul>
            <form action={addTask} className="mt-2 flex gap-2">
              <input type="hidden" name="project_id" value={target.id} />
              <input name="title" placeholder={`Add a task to ${target.name}`} autoComplete="off" />
              <button className="btn">+</button>
            </form>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {focus ? (
                <>
                  <FocusTimer startedAt={focus.started_at} minutes={focus.planned_minutes} />
                  <form action={endFocus}><input type="hidden" name="outcome" value="done" /><button className="btn btn-good">Finish block</button></form>
                  <form action={endFocus}><input type="hidden" name="outcome" value="abandoned" /><button className="btn">Stop</button></form>
                </>
              ) : (
                <form action={startFocus} className="flex gap-2">
                  <input type="hidden" name="project_id" value={target.id} />
                  <input type="hidden" name="task_id" value={targetTasks[0]?.id ?? ""} />
                  <input type="hidden" name="minutes" value={settings.focus_minutes} />
                  <button className="btn btn-primary">Start {settings.focus_minutes}-min focus block</button>
                </form>
              )}
            </div>
          </>
        ) : (
          <div>No active projects. <Link className="text-accent" href="/projects">Pick one to activate.</Link></div>
        )}
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="card">
          <div className="label mb-1">Everyday</div>
          {everyday.length === 0 && <div className="py-2 text-sm text-muted">Nothing on your plate. Add errands with the capture bar.</div>}
          <ul className="divide-y divide-line">{everyday.map((t) => <TaskRow key={t.id} t={t} />)}</ul>
        </section>

        <section className="card">
          <div className="label mb-2">Up next</div>
          <ul className="space-y-2">
            {ranked.slice(focus ? 0 : 1, 6).filter((r) => r.project.id !== target?.id).map((r) => (
              <li key={r.project.id} className="flex items-center justify-between gap-2">
                <Link href={`/projects/${r.project.id}`} className="truncate hover:underline">{r.project.name}</Link>
                <span className="shrink-0 text-xs text-muted">{r.reasons.slice(0, 2).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {(inbox.length > 0 || reviewDue) && (
        <section className="card flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            {inbox.length > 0 && <span>{inbox.length} idea{inbox.length > 1 ? "s" : ""} waiting for triage. </span>}
            {reviewDue && <span>Your weekly review is due.</span>}
          </div>
          <div className="flex gap-2">
            {inbox.length > 0 && <Link href="/inbox" className="btn">Triage ideas</Link>}
            {reviewDue && <Link href="/review" className="btn">Do review</Link>}
          </div>
        </section>
      )}
    </div>
  );
}
