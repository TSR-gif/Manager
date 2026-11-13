import Link from "next/link";
import { CheckCircle2, ChevronRight, Coffee, Lightbulb, RefreshCcw, Sparkles, Timer, X, Check, Radar } from "lucide-react";
import { cookies } from "next/headers";
import { addTask, answerMissionForm, decideAction, dismissWelcome, endFocus, setTaskStatus, startFocus, undoActivity } from "./actions";
import { nextTasks, rankProjects } from "@/lib/focus";
import { getActions, getActiveFocus, getIdeas, getProjects, getSettings, getTasks, todayStats } from "@/lib/queries";
import { getSignals } from "@/lib/signals";
import { Empty, ProjectAvatar, SignalChips, TZ, money as fmtMoney, todayISO } from "@/components/ui";
import { kindOf } from "@/lib/action-registry";
import { FocusTimer } from "@/components/focus-timer";
import { TaskItem } from "@/components/task-item";
import { OpenCommandButton } from "@/components/open-command";
import { AskBar } from "@/components/ask-bar";
import { getMoney } from "@/lib/up";
import { projectHealth, HEALTH_TONE } from "@/lib/health";
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
  const { data: runQ } = await db().from("missions").select("id,project_id,goal,last_update,worker,next_check_at").eq("status", "running").order("created_at");
  const runningMissions = (runQ ?? []) as { id: string; project_id: string | null; goal: string; last_update: string | null; worker: string; next_check_at: string | null }[];
  const { data: mSteps } = runningMissions.length ? await db().from("tasks").select("mission_id,status").in("mission_id", runningMissions.map((m) => m.id)) : { data: [] };
  const stepCount = (id: string) => { const st = ((mSteps ?? []) as { mission_id: string; status: string }[]).filter((x) => x.mission_id === id); return { done: st.filter((x) => x.status === "done").length, total: st.length }; };
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
  const welcomed = (await cookies()).get("welcomed")?.value === "1";
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const nowTask = targetTasks[0];
  const thenTasks = [...targetTasks.slice(1), ...everydayToday.filter((t) => t.id !== nowTask?.id)].slice(0, 3);
  const off = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((x) => x.type === "timeZoneName")?.value.replace("GMT", "") || "+10";
  const dayStart = new Date(`${today}T00:00:00${off.length <= 3 ? `${off}:00`.replace(/^([+-])(\d):/, "$10$2:") : off}`).toISOString();
  const { data: actRows } = await db().from("activity").select("*").gte("created_at", dayStart).order("created_at", { ascending: false }).limit(20);
  const activity = (actRows ?? []) as { id: string; title: string; undo: unknown; undone: boolean; created_at: string }[];

  const pname = (id: string | null) => projects.find((p) => p.id === id)?.name;
  const tiles = projects.filter((p) => p.status === "active").map((p) => ({ p, h: projectHealth(p, tasks, signals[p.id]), m: runningMissions.find((m) => m.project_id === p.id), w: waitingMissions.find((m) => m.project_id === p.id) }))
    .sort((a, b) => Number(!!b.w) - Number(!!a.w) || ({ bad: 0, warn: 1, good: 2, idle: 3 }[a.h.level] - { bad: 0, warn: 1, good: 2, idle: 3 }[b.h.level]));

  return (
    <div className="fade-in space-y-4 md:space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="kicker">{new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: TZ })}</div>
          <h1 className="display mt-1.5 text-[26px] md:text-[32px]">{greeting}, Thomas</h1>
          {(stats.done > 0 || stats.focusMinutes > 0) && (
            <p className="mt-1 text-[13px] text-faint">So far today: {plural(stats.done, "thing")} done{stats.focusMinutes ? `, ${Math.floor(stats.focusMinutes / 60) ? `${Math.floor(stats.focusMinutes / 60)}h ` : ""}${stats.focusMinutes % 60}m focused` : ""}</p>
          )}
        </div>
        <div className="w-full lg:w-[440px]"><AskBar name={name} /></div>
      </header>

      {!welcomed && <Welcome name={name} />}

      <div className="grid grid-cols-1 gap-4 md:gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="space-y-4 md:space-y-5">
          {waitingMissions.slice(0, 3).map((m) => (
            <section key={m.id} className="card card-alert">
              <div className="kicker mb-3 flex items-center gap-2 !text-warn"><span className="dot-warn" />{pname(m.project_id) ?? "A job"} needs you</div>
              <div className="text-[16px] font-medium leading-snug">{m.question}</div>
              <form action={answerMissionForm} className="mt-4 flex gap-2">
                <input type="hidden" name="id" value={m.id} />
                <input name="answer" placeholder="Your answer" required autoComplete="off" />
                <button className="btn btn-primary shrink-0 !min-h-11">Send</button>
              </form>
            </section>
          ))}

          {/* DO THIS NOW: MyManager picks, so you don't have to */}
          <section className="hero">
            {target ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="kicker">{focus ? "Focusing now" : "Do this now"}</span>
                  <Link href={`/projects/${target.id}`} className="ml-1 flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted hover:text-text">
                    <ProjectAvatar name={target.name} size={18} /><span className="truncate">{target.name}</span>
                  </Link>
                  <span className="ml-auto hidden md:block"><SignalChips s={signals[target.id]} /></span>
                </div>
                <div className="display mt-3 text-[22px] leading-tight md:text-[27px]">
                  {nowTask?.title ?? target.next_action ?? `Decide the next step for ${target.name}`}
                </div>
                {targetScore && !focus && (
                  <div className="mt-2 text-[13.5px] text-muted">{[target.next_action && nowTask ? "It's the next step" : null, ...targetScore.reasons.slice(1, 3).filter((x) => x !== "momentum" && !/no tasks/.test(x))].filter(Boolean).join(" · ") || "Top of your list"}</div>
                )}
                <div className="mt-5 flex flex-wrap gap-2">
                  {focus ? (
                    <>
                      <div className="mr-2"><FocusTimer startedAt={focus.started_at} minutes={focus.planned_minutes} /></div>
                      <form action={endFocus}><input type="hidden" name="outcome" value="done" /><button className="btn btn-good !min-h-11 !px-5">Finished</button></form>
                      <form action={endFocus}><input type="hidden" name="outcome" value="abandoned" /><button className="btn !min-h-11">Stop</button></form>
                    </>
                  ) : (
                    <>
                      <form action={startFocus}>
                        <input type="hidden" name="project_id" value={target.id} />
                        <input type="hidden" name="task_id" value={nowTask?.id ?? ""} />
                        <input type="hidden" name="minutes" value={settings.focus_minutes} />
                        <button className="btn btn-primary !min-h-11 !px-5"><Timer size={15} /> Start {settings.focus_minutes} min</button>
                      </form>
                      {nowTask && <form action={setTaskStatus.bind(null, nowTask.id, "done")}><button className="btn btn-good !min-h-11 !px-5"><CheckCircle2 size={16} /> Done</button></form>}
                    </>
                  )}
                </div>
                {thenTasks.length > 0 && (
                  <div className="mt-6 border-t border-line pt-4">
                    <div className="kicker mb-1 px-2">Then</div>
                    <ul className="-mx-2">{thenTasks.map((t) => <TaskItem key={t.id} t={t} projectName={t.project_id ? pname(t.project_id) : undefined} compact />)}</ul>
                  </div>
                )}
              </>
            ) : (
              <Empty icon={<Sparkles size={18} />} title="Nothing to focus on yet" hint="Tell me the one thing you need to get done this week, and I'll put it here." />
            )}
          </section>

          {inboxRuns.map((r) => (
            <Link key={r.id} href={`/agent?run=${r.id}`} className="card card-hover flex gap-3">
              <Orb size={26} />
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2 text-[12px] text-muted">
                  <b className="text-text">{name}</b>
                  <span>· {r.kind === "brief" ? "Morning catch-up" : r.kind === "checkin" ? "Checked in" : r.kind === "mission" ? "Checked on a job" : "Finished a job"}</span>
                  <span className="ml-auto text-faint">{new Date(r.created_at).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: TZ })}</span>
                </div>
                <div className="line-clamp-3 text-[14px] leading-relaxed"><Md text={(r.summary ?? r.goal).split(/\n\s*\n/)[0]} /></div>
              </div>
            </Link>
          ))}

          {(inbox.length > 0 || reviewDue) && (
            <section className="grid gap-2 md:grid-cols-2">
              {inbox.length > 0 && <Nudge href="/inbox" tone="var(--accent)" icon={<Lightbulb size={18} />} text={<><b>{plural(inbox.length, "idea")}</b> to sort</>} />}
              {reviewDue && <Nudge href="/review" tone="var(--accent-2)" icon={<RefreshCcw size={18} />} text={<>Weekly review is due <span className="text-muted">(10 min)</span></>} />}
            </section>
          )}
        </div>

        <div className="space-y-4 md:space-y-5">
          {pending.length > 0 && (
            <section className="card card-alert">
              <div className="kicker mb-3 flex items-center gap-2 !text-warn"><span className="dot-warn" />Waiting for your OK<span className="ml-auto text-faint">{pending.length}</span></div>
              <div className="space-y-4">
                {pending.slice(0, 3).map((a, i) => (
                  <div key={a.id} className={i ? "border-t border-line pt-4" : ""}>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-semibold leading-snug">{a.title}</div>
                        <div className="mt-0.5 line-clamp-2 text-[13px] text-muted">{kindOf(a.kind).label}{a.reason ? ` · ${a.reason}` : ""}</div>
                      </div>
                      {a.cost_cents > 0 && <div className="num shrink-0 text-[20px] text-warn">{fmtMoney(a.cost_cents)}</div>}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <form action={decideAction.bind(null, a.id, true)} className="flex-1"><button className="btn btn-good w-full !min-h-11">Approve</button></form>
                      <form action={decideAction.bind(null, a.id, false)} className="flex-1"><button className="btn w-full !min-h-11">Not now</button></form>
                    </div>
                  </div>
                ))}
              </div>
              {pending.length > 3 && <Link href="/approvals" className="mt-3 block text-center text-[13px] text-accent">{pending.length - 3} more waiting</Link>}
            </section>
          )}

          {runningMissions.length > 0 && (
            <section className="card">
              <div className="kicker mb-1 flex items-center gap-2"><Radar size={13} />Supervising<Link href="/supervise" className="ml-auto normal-case tracking-normal text-accent">Open</Link></div>
              <ul>
                {runningMissions.slice(0, 4).map((m) => {
                  const c = stepCount(m.id);
                  return (
                    <li key={m.id} className="border-b border-line py-3 last:border-0 last:pb-0">
                      <Link href={`/supervise?m=${m.id}`} className="block">
                        <div className="flex items-center justify-between gap-3 text-[14px] font-medium"><span className="truncate">{pname(m.project_id) ?? "Everyday"}</span>{c.total > 0 && <span className="num text-[12px] text-muted">{c.done}/{c.total}</span>}</div>
                        {c.total > 0 && <div className="bar mt-2"><i style={{ width: `${Math.round((c.done / c.total) * 100)}%` }} /></div>}
                        <div className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-muted"><span className="dot-live" /><span className="truncate">{m.worker === "working" ? "Coding a step now" : m.last_update ?? m.goal}</span></div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {activity.length > 0 && (
            <section className="card">
              <div className="kicker mb-2 flex items-center gap-2">Done for you today<span className="ml-auto text-faint">{activity.filter((a) => !a.undone).length}</span></div>
              <ul className="text-[13.5px]">
                {activity.slice(0, 4).map((a) => (
                  <li key={a.id} className="flex min-h-10 items-center gap-2.5 py-1">
                    <Check size={14} className={a.undone ? "text-faint" : "text-good"} />
                    <span className={`min-w-0 flex-1 truncate ${a.undone ? "text-faint line-through" : "text-muted"}`}>{a.title}</span>
                    {a.undo && !a.undone ? (
                      <form action={undoActivity}><input type="hidden" name="id" value={a.id} /><button className="btn btn-ghost btn-sm !min-h-8">Undo</button></form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {money.configured && (
            <section className="card">
              <div className="kicker mb-3">Money</div>
              {money.error ? <span className="text-[13px] text-bad">{money.error}</span> : (
                <div className="grid grid-cols-3 gap-3">
                  <div><div className="text-[12px] text-faint">Bank</div><div className="num mt-1 text-[18px]">{dollars(money.balanceCents)}</div></div>
                  <div><div className="text-[12px] text-faint">This week</div><div className="num mt-1 text-[18px]">{dollars(money.spent7dCents)}</div></div>
                  <div><div className="text-[12px] text-faint">30 days</div><div className="num mt-1 text-[18px]">{dollars(money.spent30dCents)}</div></div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {tiles.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between"><span className="kicker">Your projects</span><Link href="/projects" className="text-[12.5px] text-muted hover:text-text">See all</Link></div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {tiles.slice(0, 8).map(({ p, h, m, w }) => {
              const tone = w ? "var(--warn)" : m ? "var(--accent-2)" : HEALTH_TONE[h.level];
              return (
                <Link key={p.id} href={`/projects/${p.id}`} className="tile card-hover">
                  <div className="flex items-center gap-2 text-[14px] font-semibold"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone, boxShadow: `0 0 10px ${tone}` }} /><span className="truncate">{p.name}</span></div>
                  <div className="mt-2 truncate text-[12.5px] text-muted">{w ? "Needs your answer" : m ? "Being supervised" : h.label}</div>
                  <div className="truncate text-[12px] text-faint">{m?.last_update ?? (h.reasons[0] ? h.reasons[0][0].toUpperCase() + h.reasons[0].slice(1) : p.next_action ?? "")}</div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="card">
        <div className="mb-2 flex items-center justify-between">
          <span className="kicker">Everyday tasks</span>
          <OpenCommandButton className="btn btn-ghost btn-sm"><span className="hidden md:inline">Add</span><span className="kbd hidden md:inline">Ctrl K</span><span className="md:hidden">+ Add</span></OpenCommandButton>
        </div>
        {everyday.length === 0 && <Empty icon={<Coffee size={18} />} title="Nothing on your plate" hint="Errands, calls and reminders go here. Tap Add, or just tell the assistant." />}
        <div className="grid gap-x-8 md:grid-cols-2">
          {everydayToday.length > 0 && (
            <div>
              <div className="kicker mb-1 mt-2 px-2 !text-[10.5px]">Today</div>
              <ul className="-mx-2">{everydayToday.map((t) => <TaskItem key={t.id} t={t} compact />)}</ul>
            </div>
          )}
          {everydayLater.length > 0 && (
            <div>
              <div className="kicker mb-1 mt-2 px-2 !text-[10.5px]">Later</div>
              <ul className="-mx-2">{everydayLater.slice(0, 6).map((t) => <TaskItem key={t.id} t={t} compact />)}</ul>
            </div>
          )}
        </div>
        {target && (
          <form action={addTask} className="mt-3 hidden gap-2 md:flex">
            <input type="hidden" name="project_id" value={target.id} />
            <input name="title" placeholder={`Add a task to ${target.name}…`} autoComplete="off" required />
            <button className="btn">Add</button>
          </form>
        )}
      </section>
    </div>
  );
}
