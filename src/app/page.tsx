import Link from "next/link";
import { CheckCircle2, ChevronRight, Coffee, Flame, Lightbulb, ListTodo, RefreshCcw, ShieldCheck, Sparkles, Timer, Wallet, X, Zap, CircleHelp } from "lucide-react";
import { cookies } from "next/headers";
import { addTask, answerMissionForm, decideAction, dismissWelcome, endFocus, setTaskStatus, startFocus, undoActivity } from "./actions";
import { nextTasks, rankProjects } from "@/lib/focus";
import { getActions, getActiveFocus, getIdeas, getProjects, getSettings, getTasks, todayStats } from "@/lib/queries";
import { getSignals } from "@/lib/signals";
import { Empty, ProjectAvatar, SignalChips, TZ, ago, money as fmtMoney, todayISO } from "@/components/ui";
import { kindOf } from "@/lib/action-registry";
import { SocialPreview, type SocialPayload } from "@/components/social-preview";
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
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-panel/60 px-3 py-2 text-[13px] text-muted">
      <Sparkles size={14} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1">New here? Just tell {name} what you need, typed or by mic. Anything risky waits for your OK.</span>
      <form action={dismissWelcome}><button className="grid h-8 w-8 place-items-center rounded-lg hover:bg-panel2" aria-label="Dismiss"><X size={14} /></button></form>
    </div>
  );
}

export default async function Today() {
  const [projects, tasks, focus, pending, inbox, settings, stats] = await Promise.all([
    getProjects(), getTasks(), getActiveFocus(), getActions(["pending"]), getIdeas("inbox"), getSettings(), todayStats(),
  ]);
  const [signals, money, waitingQ] = await Promise.all([
    getSignals(projects.filter((p) => p.status === "active")), getMoney(),
    db().from("missions").select("id,project_id,question").eq("status", "waiting"),
  ]);
  const waitingMissions = (waitingQ.data ?? []) as { id: string; project_id: string | null; question: string | null }[];
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
  const name = (settings as { assistant_name?: string }).assistant_name || "MyManager";
  const { data: unreadRuns } = await db().from("agent_runs").select("id,kind,goal,summary,created_at").eq("unread", true).order("created_at", { ascending: false }).limit(3);
  const inboxRuns = (unreadRuns ?? []) as { id: string; kind: string; goal: string; summary: string | null; created_at: string }[];
  const reviewDue = !settings.last_review_at || Date.now() - new Date(settings.last_review_at).getTime() > 7 * 86_400_000;
  const hour = Number(new Intl.DateTimeFormat("en-AU", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(new Date()));
  const greeting = hour < 5 ? "Late night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const upNext = ranked.filter((r) => r.project.id !== target?.id).slice(0, 5);
  const maxScore = Math.max(1, ...ranked.map((r) => r.score));
  const welcomed = (await cookies()).get("welcomed")?.value === "1";
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const nowTask = targetTasks[0];
  const thenTasks = [...targetTasks.slice(1), ...everydayToday.filter((t) => t.id !== nowTask?.id)].slice(0, 3);
  const off = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((x) => x.type === "timeZoneName")?.value.replace("GMT", "") || "+10";
  const dayStart = new Date(`${today}T00:00:00${off.length <= 3 ? `${off}:00`.replace(/^([+-])(\d):/, "$10$2:") : off}`).toISOString();
  const { data: actRows } = await db().from("activity").select("*").gte("created_at", dayStart).order("created_at", { ascending: false }).limit(20);
  const activity = (actRows ?? []) as { id: string; title: string; undo: unknown; undone: boolean; created_at: string }[];

  return (
    <div className="fade-in space-y-5">
      <header>
        <div className="label">{new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: TZ })}</div>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight md:text-[32px]">{greeting}, Thomas</h1>
        {(stats.done > 0 || stats.focusMinutes > 0) && (
          <p className="mt-0.5 text-[13px] text-faint">So far today: {plural(stats.done, "thing")} done{stats.focusMinutes ? `, ${Math.floor(stats.focusMinutes / 60) ? `${Math.floor(stats.focusMinutes / 60)}h ` : ""}${stats.focusMinutes % 60}m focused` : ""}.</p>
        )}
      </header>

      {/* Waiting for your OK: pinned first, decided right here */}
      {waitingMissions.length > 0 && (
        <section className="space-y-2">
          {waitingMissions.slice(0, 3).map((m) => (
            <div key={m.id} className="card !border-[rgba(255,200,87,.4)] !p-4">
              <div className="flex items-center gap-2 text-[12px] text-warn"><CircleHelp size={14} /> {projects.find((p) => p.id === m.project_id)?.name ?? "A job"} needs you</div>
              <div className="mt-1.5 text-[15px] font-medium">{m.question}</div>
              <form action={answerMissionForm} className="mt-3 flex gap-2">
                <input type="hidden" name="id" value={m.id} />
                <input name="answer" placeholder="Your answer" required autoComplete="off" />
                <button className="btn btn-primary shrink-0 !min-h-11">Send</button>
              </form>
            </div>
          ))}
        </section>
      )}

      {pending.length > 0 && (
        <section className="space-y-2">
          {pending.slice(0, 3).map((a) => (
            <div key={a.id} className="card !border-[rgba(255,200,87,.4)] !p-4">
              <div className="flex items-center gap-2 text-[12px] text-warn"><ShieldCheck size={14} /> Needs your OK · {kindOf(a.kind).label}{a.cost_cents > 0 && <b className="ml-auto text-text">{fmtMoney(a.cost_cents)}</b>}</div>
              <div className="mt-1.5 text-[15px] font-medium">{a.title}</div>
              {a.reason && <div className="mt-0.5 line-clamp-2 text-[13px] text-muted">{a.reason}</div>}
              {a.kind.startsWith("social.") && <div className="mt-2.5"><SocialPreview p={a.payload as SocialPayload} compact /></div>}
              <div className="mt-3 flex gap-2">
                <form action={decideAction.bind(null, a.id, true)} className="flex-1"><button className="btn btn-good w-full !min-h-11">Approve</button></form>
                <form action={decideAction.bind(null, a.id, false)} className="flex-1"><button className="btn w-full !min-h-11">Not now</button></form>
              </div>
            </div>
          ))}
          {pending.length > 3 && <Link href="/approvals" className="block text-center text-[13px] text-accent">{pending.length - 3} more waiting</Link>}
        </section>
      )}

      {/* DO THIS NOW: MyManager picks, so you don't have to */}
      <section className="hero !p-4 md:!p-6">
        {target ? (
          <>
            <div className="flex items-center gap-2">
              <span className="chip chip-accent">{focus ? <><Flame size={11} /> Focusing now</> : <><Zap size={11} /> Do this now</>}</span>
              <Link href={`/projects/${target.id}`} className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted hover:text-text">
                <ProjectAvatar name={target.name} size={18} /><span className="truncate">{target.name}</span>
              </Link>
              <span className="ml-auto hidden md:block"><SignalChips s={signals[target.id]} /></span>
            </div>
            <div className="mt-3 text-[20px] font-semibold leading-snug tracking-tight md:text-[24px]">
              {nowTask?.title ?? target.next_action ?? `Decide the next step for ${target.name}`}
            </div>
            {targetScore && !focus && (
              <div className="mt-1 text-[12.5px] text-faint">Picked because: {[target.next_action && nowTask ? "it's the next step" : null, ...targetScore.reasons.slice(1, 3).filter((x) => x !== "momentum" && !/no tasks/.test(x))].filter(Boolean).join(", ") || "it's your top priority"}</div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {focus ? (
                <>
                  <div className="mr-2"><FocusTimer startedAt={focus.started_at} minutes={focus.planned_minutes} /></div>
                  <form action={endFocus}><input type="hidden" name="outcome" value="done" /><button className="btn btn-good !min-h-11 !px-5">Finished</button></form>
                  <form action={endFocus}><input type="hidden" name="outcome" value="abandoned" /><button className="btn !min-h-11">Stop</button></form>
                </>
              ) : (
                <>
                  {nowTask && <form action={setTaskStatus.bind(null, nowTask.id, "done")}><button className="btn btn-good !min-h-11 !px-5"><CheckCircle2 size={16} /> Done</button></form>}
                  <form action={startFocus}>
                    <input type="hidden" name="project_id" value={target.id} />
                    <input type="hidden" name="task_id" value={nowTask?.id ?? ""} />
                    <input type="hidden" name="minutes" value={settings.focus_minutes} />
                    <button className="btn btn-primary !min-h-11 !px-5"><Timer size={15} /> Start ({settings.focus_minutes} min)</button>
                  </form>
                </>
              )}
            </div>
            {thenTasks.length > 0 && (
              <div className="mt-5 border-t border-line pt-3">
                <div className="label mb-1 px-2">Then</div>
                <ul className="-mx-2">{thenTasks.map((t) => <TaskItem key={t.id} t={t} projectName={t.project_id ? projects.find((p) => p.id === t.project_id)?.name : undefined} compact />)}</ul>
              </div>
            )}
          </>
        ) : (
          <Empty icon={<Sparkles size={18} />} title="Nothing to focus on yet" hint="Tell me the one thing you need to get done this week, and I'll put it here." />
        )}
      </section>

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
                  <span>· {r.kind === "brief" ? "Morning catch-up" : r.kind === "checkin" ? "Checked in" : "Finished a job"}</span>
                  <span className="ml-auto text-faint">{new Date(r.created_at).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: TZ })}</span>
                </div>
                <div className="line-clamp-3 text-[14px] leading-relaxed"><Md text={(r.summary ?? r.goal).split(/\n\s*\n/)[0]} /></div>
              </div>
            </Link>
          ))}
        </section>
      )}

      {(inbox.length > 0 || reviewDue) && (
        <section className="grid gap-2 md:grid-cols-2">
          {inbox.length > 0 && <Nudge href="/inbox" tone="var(--accent)" icon={<Lightbulb size={18} />} text={<><b>{plural(inbox.length, "idea")}</b> to sort</>} />}
          {reviewDue && <Nudge href="/review" tone="var(--accent-2)" icon={<RefreshCcw size={18} />} text={<>Weekly review is due <span className="text-muted">(10 min)</span></>} />}
        </section>
      )}

      {activity.length > 0 && (
        <section className="card">
          <div className="mb-2 flex items-center gap-2"><Orb size={16} /><span className="font-semibold">What {name} did today</span><span className="text-[12px] text-faint">{activity.filter((a) => !a.undone).length}</span></div>
          <ul className="divide-y divide-line text-[13.5px]">
            {activity.slice(0, 8).map((a) => (
              <li key={a.id} className="flex min-h-11 items-center gap-3 py-1.5">
                <span className={`min-w-0 flex-1 truncate ${a.undone ? "text-faint line-through" : ""}`}>{a.title}</span>
                <span className="shrink-0 text-[11.5px] text-faint">{ago(a.created_at)}</span>
                {a.undo && !a.undone ? (
                  <form action={undoActivity}><input type="hidden" name="id" value={a.id} /><button className="btn btn-ghost btn-sm !min-h-9">Undo</button></form>
                ) : a.undone ? <span className="text-[12px] text-faint">undone</span> : null}
              </li>
            ))}
          </ul>
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
              <div><div className="text-[12px] text-muted">Spent this week</div><div className="text-[15px] font-semibold tabular-nums">{dollars(money.spent7dCents)}</div></div>
              <div className="hidden sm:block"><div className="text-[12px] text-muted">Spent 30 days</div><div className="text-[15px] font-semibold tabular-nums">{dollars(money.spent30dCents)}</div></div>
            </>
          )}
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
        <section className="card">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2"><ListTodo size={16} className="text-accent" /><span className="font-semibold">Everyday tasks</span></div>
            <OpenCommandButton className="btn btn-ghost btn-sm"><span className="hidden md:inline">Add</span><span className="kbd hidden md:inline">Ctrl K</span><span className="md:hidden">+ Add</span></OpenCommandButton>
          </div>
          {everyday.length === 0 && <Empty icon={<Coffee size={18} />} title="Nothing on your plate" hint="Errands, calls and reminders go here. Tap Add, or just tell the assistant." />}
          {everydayToday.length > 0 && (
            <>
              <div className="label mb-1 mt-3 px-2">Today</div>
              <ul className="-mx-2">{everydayToday.map((t) => <TaskItem key={t.id} t={t} compact />)}</ul>
            </>
          )}
          {everydayLater.length > 0 && (
            <>
              <div className="label mb-1 mt-3 px-2">Later</div>
              <ul className="-mx-2">{everydayLater.slice(0, 6).map((t) => <TaskItem key={t.id} t={t} compact />)}</ul>
            </>
          )}
          {target && (
            <form action={addTask} className="mt-3 hidden gap-2 md:flex">
              <input type="hidden" name="project_id" value={target.id} />
              <input name="title" placeholder={`Add a task to ${target.name}…`} autoComplete="off" required />
              <button className="btn">Add</button>
            </form>
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
                <Link href={`/projects/${r.project.id}`} className="flex min-h-11 items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-panel2/70">
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
