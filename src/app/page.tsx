import Link from "next/link";
import { ArrowRight, CheckCircle2, Coffee, Flame, Lightbulb, ListTodo, RefreshCcw, ShieldCheck, Sparkles, Timer, Zap } from "lucide-react";
import { addTask, endFocus, startFocus } from "./actions";
import { nextTasks, rankProjects } from "@/lib/focus";
import { getActions, getActiveFocus, getIdeas, getProjects, getSettings, getTasks, todayStats } from "@/lib/queries";
import { getSignals } from "@/lib/signals";
import { Empty, ProjectAvatar, SignalChips, TZ, todayISO } from "@/components/ui";
import { FocusTimer } from "@/components/focus-timer";
import { TaskItem } from "@/components/task-item";
import { OpenCommandButton } from "@/components/open-command";
import { AskBar } from "@/components/ask-bar";

export const dynamic = "force-dynamic";

function Stat({ icon, label, value, href, tone }: { icon: React.ReactNode; label: string; value: string | number; href?: string; tone?: string }) {
  const inner = (
    <div className="card card-hover flex items-center gap-3 !p-3.5">
      <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${tone ?? "var(--accent)"} 15%, transparent)`, color: tone ?? "var(--accent)" }}>{icon}</div>
      <div>
        <div className="text-[20px] font-semibold leading-none tabular-nums">{value}</div>
        <div className="mt-1 text-[12px] text-muted">{label}</div>
      </div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default async function Today() {
  const [projects, tasks, focus, pending, inbox, settings, stats] = await Promise.all([
    getProjects(), getTasks(), getActiveFocus(), getActions(["pending"]), getIdeas("inbox"), getSettings(), todayStats(),
  ]);
  const signals = await getSignals(projects.filter((p) => p.status === "active"));
  const ranked = rankProjects(projects, tasks, signals);
  const top = ranked[0];
  const focusProject = focus?.project_id ? projects.find((p) => p.id === focus.project_id) : null;
  const target = focusProject ?? top?.project;
  const targetScore = ranked.find((r) => r.project.id === target?.id);
  const targetTasks = target ? nextTasks(target.id, tasks) : [];
  const everyday = tasks.filter((t) => !t.project_id);
  const today = todayISO();
  const everydayToday = everyday.filter((t) => t.due && t.due.slice(0, 10) <= today || t.status === "doing");
  const everydayLater = everyday.filter((t) => !everydayToday.includes(t));
  const reviewDue = !settings.last_review_at || Date.now() - new Date(settings.last_review_at).getTime() > 7 * 86_400_000;
  const hour = Number(new Intl.DateTimeFormat("en-AU", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(new Date()));
  const greeting = hour < 5 ? "Late night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const upNext = ranked.filter((r) => r.project.id !== target?.id).slice(0, 5);
  const maxScore = Math.max(1, ...ranked.map((r) => r.score));

  return (
    <div className="fade-in space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label">{new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: TZ })}</div>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight md:text-[32px]">{greeting}, Thomas</h1>
          <p className="mt-1 text-[14px] text-muted">
            {target ? <>Your top priority is <span className="text-text">{target.name}</span>{everydayToday.length ? <> and {everydayToday.length} everyday thing{everydayToday.length > 1 ? "s" : ""} need doing today.</> : "."}</> : "Pick a project to activate and I'll tell you what to do."}
          </p>
        </div>
      </header>

      <AskBar />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon={<CheckCircle2 size={18} />} label="Done today" value={stats.done} tone="var(--good)" />
        <Stat icon={<Timer size={18} />} label="Focus today" value={`${Math.floor(stats.focusMinutes / 60)}h ${stats.focusMinutes % 60}m`} tone="var(--accent-2)" />
        <Stat icon={<ShieldCheck size={18} />} label="To approve" value={pending.length} href="/approvals" tone={pending.length ? "var(--warn)" : "var(--muted)"} />
        <Stat icon={<Lightbulb size={18} />} label="Ideas to triage" value={inbox.length} href="/inbox" tone="var(--accent)" />
      </div>

      {/* THE ONE THING */}
      <section className="hero">
        {target ? (
          <div className="flex flex-col gap-6 md:flex-row">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="chip chip-accent">{focus ? <><Flame size={11} /> Focusing now</> : <><Zap size={11} /> Work on this now</>}</span>
                {targetScore && !focus && targetScore.reasons.slice(1, 4).filter((x) => x !== "momentum").map((r) => <span key={r} className="chip">{r}</span>)}
              </div>
              <Link href={`/projects/${target.id}`} className="mt-4 flex items-center gap-3">
                <ProjectAvatar name={target.name} size={44} />
                <div className="min-w-0">
                  <div className="truncate text-[24px] font-semibold tracking-tight hover:underline md:text-[26px]">{target.name}</div>
                  <SignalChips s={signals[target.id]} />
                </div>
              </Link>
              {target.next_action && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-line bg-bg2/60 px-3 py-2.5 text-[14px]">
                  <ArrowRight size={16} className="mt-0.5 shrink-0 text-accent" />
                  <span><span className="text-muted">Next action · </span>{target.next_action}</span>
                </div>
              )}
              <ul className="mt-3 -mx-2">
                {targetTasks.map((t) => <TaskItem key={t.id} t={t} />)}
              </ul>
              <form action={addTask} className="mt-2 flex gap-2">
                <input type="hidden" name="project_id" value={target.id} />
                <input name="title" placeholder={`Add a task to ${target.name}…`} autoComplete="off" required />
                <button className="btn">Add</button>
              </form>
            </div>

            <div className="flex shrink-0 flex-row items-center justify-center gap-4 rounded-2xl border border-line bg-bg2/50 p-4 md:w-[220px] md:flex-col md:gap-3 md:p-5">
              {focus ? (
                <>
                  <FocusTimer startedAt={focus.started_at} minutes={focus.planned_minutes} />
                  <div className="flex w-full gap-2">
                    <form action={endFocus} className="flex-1"><input type="hidden" name="outcome" value="done" /><button className="btn btn-good w-full">Finish</button></form>
                    <form action={endFocus} className="flex-1"><input type="hidden" name="outcome" value="abandoned" /><button className="btn w-full">Stop</button></form>
                  </div>
                </>
              ) : (
                <>
                  <div className="hidden h-[120px] w-[120px] place-items-center rounded-full border-[7px] border-line md:grid">
                    <div className="text-center">
                      <div className="font-mono text-[26px] font-semibold">{settings.focus_minutes}:00</div>
                      <div className="text-[11px] text-muted">ready</div>
                    </div>
                  </div>
                  <form action={startFocus} className="w-full">
                    <input type="hidden" name="project_id" value={target.id} />
                    <input type="hidden" name="task_id" value={targetTasks[0]?.id ?? ""} />
                    <input type="hidden" name="minutes" value={settings.focus_minutes} />
                    <button className="btn btn-primary w-full !py-3 md:!py-2.5"><Timer size={15} /> Start {settings.focus_minutes}-min focus</button>
                  </form>
                  <div className="hidden text-center text-[11.5px] text-faint md:block">Locks this as your focus until the timer ends</div>
                </>
              )}
            </div>
          </div>
        ) : (
          <Empty icon={<Sparkles size={18} />} title="No active projects" hint="Activate one on the Projects page." />
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
        <section className="card">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2"><ListTodo size={16} className="text-accent" /><span className="font-semibold">Everyday</span></div>
            <OpenCommandButton className="btn btn-ghost btn-sm"><span className="hidden md:inline">Add</span><span className="kbd hidden md:inline">Ctrl K</span><span className="md:hidden">+ Add</span></OpenCommandButton>
          </div>
          {everyday.length === 0 && <Empty icon={<Coffee size={18} />} title="Nothing on your plate" hint="Errands, calls and reminders go here." />}
          {everydayToday.length > 0 && (
            <>
              <div className="label mb-1 mt-3 px-2">Today</div>
              <ul className="-mx-2">{everydayToday.map((t) => <TaskItem key={t.id} t={t} compact />)}</ul>
            </>
          )}
          {everydayLater.length > 0 && (
            <>
              <div className="label mb-1 mt-3 px-2">Later</div>
              <ul className="-mx-2">{everydayLater.slice(0, 8).map((t) => <TaskItem key={t.id} t={t} compact />)}</ul>
            </>
          )}
        </section>

        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2"><Flame size={16} className="text-warn" /><span className="font-semibold">Up next</span></div>
            <Link href="/projects" className="text-[12px] text-muted hover:text-text">All projects →</Link>
          </div>
          <ul className="space-y-1">
            {upNext.map((r) => (
              <li key={r.project.id}>
                <Link href={`/projects/${r.project.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-panel2/70">
                  <ProjectAvatar name={r.project.name} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium">{r.project.name}</div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-line">
                      <div className="h-full rounded-full bg-gradient-to-r from-[#9a8bff] to-[#5ec8ff]" style={{ width: `${Math.max(8, (r.score / maxScore) * 100)}%` }} />
                    </div>
                  </div>
                  <span className="hidden shrink-0 text-[11.5px] text-muted sm:inline">{r.reasons.slice(1).filter((x) => x !== "momentum").slice(0, 2).join(" · ")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {reviewDue && (
        <Link href="/review" className="card card-hover flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-[rgba(94,200,255,.12)] text-accent2"><RefreshCcw size={17} /></div>
          <div className="flex-1">
            <div className="font-medium">Weekly review is due</div>
            <div className="text-[13px] text-muted">10 minutes to see what moved, drop what stalled and reset priorities.</div>
          </div>
          <ArrowRight size={16} className="text-muted" />
        </Link>
      )}
    </div>
  );
}
