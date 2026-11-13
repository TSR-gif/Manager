import Link from "next/link";
import { ChevronRight, Plus, Timer } from "lucide-react";
import { answerMissionForm, decideAction, endFocus, quickCapture, startFocus } from "./actions";
import { nextTasks, rankProjects } from "@/lib/focus";
import { getActions, getActiveFocus, getProjects, getSettings, getTasks } from "@/lib/queries";
import { getSignals } from "@/lib/signals";
import { TZ, money as fmtMoney, todayISO } from "@/components/ui";
import { FocusTimer } from "@/components/focus-timer";
import { TaskItem } from "@/components/task-item";
import { AskBar } from "@/components/ask-bar";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Today() {
  const [projects, tasks, focus, pending, settings] = await Promise.all([
    getProjects(), getTasks(), getActiveFocus(), getActions(["pending"]), getSettings(),
  ]);
  const [signals, waitingQ] = await Promise.all([
    getSignals(projects.filter((p) => p.status === "active")),
    db().from("missions").select("id,project_id,question").eq("status", "waiting"),
  ]);
  const waitingMissions = (waitingQ.data ?? []) as { id: string; project_id: string | null; question: string | null }[];
  const { data: runQ } = await db().from("missions").select("id,project_id,goal,last_update,worker,next_check_at").eq("status", "running").order("created_at");
  const runningMissions = (runQ ?? []) as { id: string; project_id: string | null; goal: string; last_update: string | null; worker: string; next_check_at: string | null }[];
  const ranked = rankProjects(projects, tasks, signals);
  const top = ranked[0];
  const focusProject = focus?.project_id ? projects.find((p) => p.id === focus.project_id) : null;
  const target = focusProject ?? top?.project;
  const targetTasks = target ? nextTasks(target.id, tasks) : [];
  const everyday = tasks.filter((t) => !t.project_id);
  const today = todayISO();
  const everydayToday = everyday.filter((t) => t.due && t.due.slice(0, 10) <= today || t.status === "doing");
  const name = (settings as { assistant_name?: string }).assistant_name || "MyManager";
  const hour = Number(new Intl.DateTimeFormat("en-AU", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(new Date()));
  const greeting = hour < 5 ? "Late night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const nowTask = targetTasks[0];
  const thenTasks = [...targetTasks.slice(1), ...everydayToday.filter((t) => t.id !== nowTask?.id)].slice(0, 3);
  const off = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((x) => x.type === "timeZoneName")?.value.replace("GMT", "") || "+10";
  const dayStart = new Date(`${today}T00:00:00${off.length <= 3 ? `${off}:00`.replace(/^([+-])(\d):/, "$10$2:") : off}`).toISOString();
  const { data: actRows } = await db().from("activity").select("*").gte("created_at", dayStart).order("created_at", { ascending: false }).limit(20);
  const activity = (actRows ?? []) as { id: string; title: string; undo: unknown; undone: boolean; created_at: string }[];

  const pname = (id: string | null) => projects.find((p) => p.id === id)?.name;
  const { data: rbQ } = await db().from("runbooks").select("id,title,status,last_update,project_id").in("status", ["running", "waiting"]).order("created_at");
  const runbooks = (rbQ ?? []) as { id: string; title: string; status: string; last_update: string | null; project_id: string | null }[];
  const waitingRb = runbooks.filter((r) => r.status === "waiting");
  const needCount = waitingMissions.length + pending.length + waitingRb.length;
  const workingOn = runningMissions.length + runbooks.filter((r) => r.status === "running").length;
  const doneForYou = activity.filter((a) => !a.undone).length;
  const myDay = [...(nowTask ? [nowTask] : []), ...everydayToday.filter((t) => t.id !== nowTask?.id), ...thenTasks.filter((t) => t.id !== nowTask?.id && !everydayToday.includes(t))].slice(0, 5);
  const shownNeeds = 4;
  let left = shownNeeds;
  const take = <T,>(xs: T[]) => { const out = xs.slice(0, Math.max(0, left)); left -= out.length; return out; };
  const qs = take(waitingMissions), rbs = take(waitingRb), aps = take(pending);
  const hidden = needCount - qs.length - rbs.length - aps.length;

  return (
    <div className="fade-in mx-auto max-w-[620px] space-y-8 pt-2 md:pt-8">
      <header className="space-y-5">
        <div>
          <h1 className="display text-[28px] md:text-[32px]">{greeting}, Thomas</h1>
          <p className="mt-1.5 text-[15px] text-muted">
            {needCount ? `${plural(needCount, "thing")} need${needCount === 1 ? "s" : ""} you. I'm handling the rest.` : "Nothing needs you. I'm handling everything."}
          </p>
        </div>
        <AskBar name={name} />
      </header>

      {needCount > 0 && (
        <section>
          <h2 className="mb-2.5 flex items-center gap-2 px-1 text-[15px] font-semibold"><span className="dot-warn" />Needs you</h2>
          <ul className="card divide-y divide-line !p-0">
            {qs.map((m) => (
              <li key={m.id} className="px-4 py-3.5">
                <div className="text-[14.5px] leading-snug">{m.question}</div>
                {pname(m.project_id) && <div className="text-[12.5px] text-faint">{pname(m.project_id)}</div>}
                <form action={answerMissionForm} className="mt-2.5 flex gap-2">
                  <input type="hidden" name="id" value={m.id} />
                  <input name="answer" placeholder="Your answer" required autoComplete="off" className="!h-10" />
                  <button className="btn btn-primary shrink-0 !h-10">Send</button>
                </form>
              </li>
            ))}
            {rbs.map((r) => (
              <li key={r.id}>
                <Link href="/supervise" className="flex items-center gap-3 px-4 py-3.5 text-[14.5px] hover:bg-panel2/60">
                  <span className="min-w-0 flex-1 leading-snug">{r.last_update ?? r.title}</span>
                  <ChevronRight size={16} className="shrink-0 text-faint" />
                </Link>
              </li>
            ))}
            {aps.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 text-[14.5px] leading-snug">{a.title}{pname(a.project_id) && <span className="block text-[12.5px] text-faint">{pname(a.project_id)}</span>}</div>
                <form action={decideAction.bind(null, a.id, false)}><button className="btn btn-ghost btn-sm">Not now</button></form>
                <form action={decideAction.bind(null, a.id, true)}><button className="btn btn-good btn-sm">{a.cost_cents > 0 ? `OK, ${fmtMoney(a.cost_cents)}` : "OK"}</button></form>
              </li>
            ))}
            {hidden > 0 && (
              <li><Link href="/approvals" className="flex items-center gap-2 px-4 py-3 text-[13.5px] text-muted hover:text-text">{plural(hidden, "more thing")}<ChevronRight size={14} /></Link></li>
            )}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center">
          <h2 className="text-[15px] font-semibold px-1">Your day</h2>
          {focus && <div className="ml-auto"><FocusTimer startedAt={focus.started_at} minutes={focus.planned_minutes} /></div>}
        </div>
        <div className="card !px-2 !py-1.5">
          {myDay.length > 0 ? (
            <ul>{myDay.map((t) => <TaskItem key={t.id} t={t} projectName={t.project_id ? pname(t.project_id) : undefined} compact />)}</ul>
          ) : (
            <div className="px-2 py-3 text-[14px] text-muted">Nothing on today. Add something below, or just ask me.</div>
          )}
          <form action={quickCapture} className="flex items-center gap-2 border-t border-line px-2 pb-1 pt-2">
            <Plus size={16} className="ml-1 text-faint" />
            <input name="text" placeholder="Add something to do" autoComplete="off" className="!h-9 flex-1 !border-0 !bg-transparent !px-1 !shadow-none text-[14px]" />
          </form>
        </div>
        {focus ? (
          <div className="mt-3 flex gap-2">
            <form action={endFocus}><input type="hidden" name="outcome" value="done" /><button className="btn btn-good btn-sm">Finished</button></form>
            <form action={endFocus}><input type="hidden" name="outcome" value="abandoned" /><button className="btn btn-ghost btn-sm">Stop timer</button></form>
          </div>
        ) : target && nowTask ? (
          <form action={startFocus} className="mt-3">
            <input type="hidden" name="project_id" value={target.id} />
            <input type="hidden" name="task_id" value={nowTask.id} />
            <input type="hidden" name="minutes" value={settings.focus_minutes} />
            <button className="btn btn-ghost btn-sm text-muted"><Timer size={14} /> Focus on the first one for {settings.focus_minutes} min</button>
          </form>
        ) : null}
      </section>

      {(workingOn > 0 || doneForYou > 0) && (
        <Link href="/supervise" className="flex items-center gap-2 px-1 text-[13.5px] text-muted hover:text-text">
          {workingOn > 0 && <span className="dot-live" />}
          <span>
            {workingOn > 0 ? `I'm working on ${plural(workingOn, "thing")}` : ""}
            {workingOn > 0 && doneForYou > 0 ? " · " : ""}
            {doneForYou > 0 ? `${plural(doneForYou, "thing")} done for you today` : ""}
          </span>
          <ChevronRight size={14} />
        </Link>
      )}
    </div>
  );
}
