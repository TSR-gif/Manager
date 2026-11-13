import Link from "next/link";
import { ArrowRight, Bell, ChevronRight, Coffee, Flame, Lightbulb, ListTodo, MessageCircle, RefreshCcw, ShieldCheck, Sparkles, Timer, Wallet, X, Zap } from "lucide-react";
import { cookies } from "next/headers";
import { addTask, dismissWelcome, endFocus, startFocus } from "./actions";
import { nextTasks, rankProjects } from "@/lib/focus";
import { getActions, getActiveFocus, getIdeas, getProjects, getSettings, getTasks, todayStats } from "@/lib/queries";
import { getSignals } from "@/lib/signals";
import { Empty, ProjectAvatar, SignalChips, TZ, todayISO } from "@/components/ui";
import { FocusTimer } from "@/components/focus-timer";
import { TaskItem } from "@/components/task-item";
import { OpenCommandButton } from "@/components/open-command";
import { AskBar } from "@/components/ask-bar";
import { getMoney } from "@/lib/up";
import { db } from "@/lib/db";
import { Orb } from "@/components/orb";
import { Md } from "@/components/md";

export const dynamic = "force-dynamic";

const dollars = (c?: number) => `$${Math.round((c ?? 0) / 100).toLocaleString("en-AU")}`;

function Nudge({ icon, text, href, tone }: { icon: React.ReactNode; text: React.ReactNode; href: string; tone: string }) {
  return (
    <Link href={href} className="card card-hover flex min-h-[56px] items-center gap-3 !px-4 !py-3">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${tone} 15%, transparent)`, color: tone }}>{icon}</div>
      <div className="min-w-0 flex-1 text-[14.5px]">{text}</div>
      <ChevronRight size={17} className="shrink-0 text-faint" />
    </Link>
  );
}

function Welcome({ name }: { name: string }) {
  const steps: [React.ReactNode, string, string][] = [
    [<MessageCircle key="a" size={17} />, "Just tell it what you need", `Type or tap the mic: "remind me to call the plumber Friday" or "what should I work on?"`],
    [<ShieldCheck key="b" size={17} />, "It asks before anything risky", "Spending, signing up or sending emails as you always waits for your OK."],
    [<Bell key="c" size={17} />, "Get it on your phone (optional)", "Two minutes in Settings and approvals arrive in Telegram."],
  ];
  return (
    <section className="hero relative">
      <form action={dismissWelcome} className="absolute right-3 top-3"><button className="btn btn-ghost !h-9 !w-9 !p-0" aria-label="Close"><X size={16} /></button></form>
      <div className="mb-1 text-[19px] font-semibold tracking-tight">Welcome to {name} 👋</div>
      <p className="mb-4 pr-8 text-[14px] text-muted">Your projects, everyday tasks and money in one place, with an assistant that does the busywork. Three things to know:</p>
      <ol className="grid gap-3 md:grid-cols-3">
        {steps.map(([icon, t, d], i) => (
          <li key={i} className="flex gap-3 rounded-xl border border-line bg-bg2/50 p-3">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[rgba(139,123,255,.15)] text-accent">{icon}</div>
            <div><div className="text-[14px] font-medium">{t}</div><div className="mt-0.5 text-[12.5px] text-muted">{d}</div></div>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap gap-2">
        <form action={dismissWelcome}><button className="btn btn-primary !py-2.5">Got it</button></form>
        <Link href="/settings#phone" className="btn !py-2.5">Set up phone alerts</Link>
      </div>
    </section>
  );
}

export default async function Today() {
  const [projects, tasks, focus, pending, inbox, settings, stats] = await Promise.all([
    getProjects(), getTasks(), getActiveFocus(), getActions(["pending"]), getIdeas("inbox"), getSettings(), todayStats(),
  ]);
  const [signals, money] = await Promise.all([getSignals(projects.filter((p) => p.status === "active")), getMoney()]);
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
  const name = (settings as { assistant_name?: string }).assistant_name || "Manager";
  const { data: unreadRuns } = await db().from("agent_runs").select("id,kind,goal,summary,created_at").eq("unread", true).order("created_at", { ascending: false }).limit(3);
  const inboxRuns = (unreadRuns ?? []) as { id: string; kind: string; goal: string; summary: string | null; created_at: string }[];
  const reviewDue = !settings.last_review_at || Date.now() - new Date(settings.last_review_at).getTime() > 7 * 86_400_000;
  const hour = Number(new Intl.DateTimeFormat("en-AU", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(new Date()));
  const greeting = hour < 5 ? "Late night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const upNext = ranked.filter((r) => r.project.id !== target?.id).slice(0, 5);
  const maxScore = Math.max(1, ...ranked.map((r) => r.score));
  const welcomed = (await cookies()).get("welcomed")?.value === "1";
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  return (
    <div className="fade-in space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label">{new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: TZ })}</div>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight md:text-[32px]">{greeting}, Thomas</h1>
          <p className="mt-1 text-[14px] text-muted">
            {target ? <>Today&apos;s focus is <span className="text-text">{target.name}</span>{everydayToday.length ? <>, plus {plural(everydayToday.length, "everyday task")}.</> : "."}</> : "Pick a project to work on and I'll tell you what to do."}
          </p>
          {(stats.done > 0 || stats.focusMinutes > 0) && (
            <p className="mt-1 text-[13px] text-faint">So far today: {plural(stats.done, "task")} done{stats.focusMinutes ? `, ${Math.floor(stats.focusMinutes / 60) ? `${Math.floor(stats.focusMinutes / 60)}h ` : ""}${stats.focusMinutes % 60}m focused` : ""}.</p>
          )}
        </div>
      </header>

      {!welcomed && <Welcome name={name} />}

      <AskBar name={name} />

      {inboxRuns.length > 0 && (
        <section className="space-y-2">
          {inboxRuns.map((r) => (
            <Link key={r.id} href={`/agent?run=${r.id}`} className="card card-hover flex gap-3 !p-4 !border-[rgba(139,123,255,.35)]">
              <Orb size={28} />
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2 text-[12px] text-muted">
                  <b className="text-text">{name}</b>
                  <span>· {r.kind === "brief" ? "Morning brief" : r.kind === "checkin" ? "Checked in" : "Finished a job"}</span>
                  <span className="ml-auto text-faint">{new Date(r.created_at).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: TZ })}</span>
                </div>
                <div className="line-clamp-4 text-[14px] leading-relaxed"><Md text={r.summary ?? r.goal} /></div>
              </div>
            </Link>
          ))}
        </section>
      )}

      {(pending.length > 0 || inbox.length > 0 || reviewDue) && (
        <section className="grid gap-2 md:grid-cols-2">
          {pending.length > 0 && <Nudge href="/approvals" tone="var(--warn)" icon={<ShieldCheck size={18} />} text={<><b>{plural(pending.length, "thing")}</b> waiting for your OK</>} />}
          {inbox.length > 0 && <Nudge href="/inbox" tone="var(--accent)" icon={<Lightbulb size={18} />} text={<><b>{plural(inbox.length, "idea")}</b> to sort</>} />}
          {reviewDue && <Nudge href="/review" tone="var(--accent-2)" icon={<RefreshCcw size={18} />} text={<>Weekly review is due <span className="text-muted">(10 min)</span></>} />}
        </section>
      )}

      {money.configured && (
        <section className="card flex flex-wrap items-center gap-x-6 gap-y-3 !p-4">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--good)_15%,transparent)] text-good"><Wallet size={18} /></div>
            <div><div className="text-[12px] text-muted">Bank balance</div><div className="text-[18px] font-semibold tabular-nums">{money.error ? "-" : dollars(money.balanceCents)}</div></div>
          </div>
          {money.error ? <span className="text-[13px] text-bad">{money.error}</span> : (
            <>
              <div><div className="text-[12px] text-muted">Spent 7 days</div><div className="text-[15px] font-semibold tabular-nums">{dollars(money.spent7dCents)}</div></div>
              <div><div className="text-[12px] text-muted">Spent 30 days</div><div className="text-[15px] font-semibold tabular-nums">{dollars(money.spent30dCents)}</div></div>
              <div className="flex flex-wrap gap-1.5">{money.topCategories?.map((c) => <span key={c.name} className="chip">{c.name} {dollars(c.cents)}</span>)}</div>
            </>
          )}
        </section>
      )}

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
                  <span><span className="text-muted">Next step: </span>{target.next_action}</span>
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
                    <button className="btn btn-primary w-full !py-3 md:!py-2.5"><Timer size={15} /> Focus for {settings.focus_minutes} min</button>
                  </form>
                  <div className="hidden text-center text-[11.5px] text-faint md:block">A timer to help you stick with this one thing</div>
                </>
              )}
            </div>
          </div>
        ) : (
          <Empty icon={<Sparkles size={18} />} title="Nothing to focus on yet" hint="Open Projects and set one to Active." />
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
        <section className="card">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2"><ListTodo size={16} className="text-accent" /><span className="font-semibold">Everyday tasks</span></div>
            <OpenCommandButton className="btn btn-ghost btn-sm"><span className="hidden md:inline">Add</span><span className="kbd hidden md:inline">Ctrl K</span><span className="md:hidden">+ Add</span></OpenCommandButton>
          </div>
          {everyday.length === 0 && <Empty icon={<Coffee size={18} />} title="Nothing on your plate" hint="Errands, calls and reminders go here. Tap + Add, or just tell the assistant." />}
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
            <div className="flex items-center gap-2"><Flame size={16} className="text-warn" /><span className="font-semibold">Your other projects</span></div>
            <Link href="/projects" className="text-[12px] text-muted hover:text-text">See all →</Link>
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

    </div>
  );
}
