import Link from "next/link";
import { Calendar, CheckCircle2 } from "lucide-react";
import { endFocus } from "./actions";
import { getActiveFocus, getProjects, getSettings } from "@/lib/queries";
import { TZ } from "@/components/ui";
import { AskBar } from "@/components/ask-bar";
import { DashChat } from "@/components/dash-chat";
import { Head } from "@/components/nav";
import { Decisions, DoneForYou, WorkingOn } from "@/components/decisions";
import { db } from "@/lib/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { nextOnCalendar, projectNames, todayData } from "@/lib/today";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ pw?: string }> }) {
  const { pw } = await searchParams;
  const [projects, focus, settings, t, next] = await Promise.all([getProjects(), getActiveFocus(), getSettings(), todayData(), nextOnCalendar()]);
  const name = projectNames(projects);
  const assistant = (settings as { assistant_name?: string }).assistant_name || "MyManager";
  const hour = Number(new Intl.DateTimeFormat("en-AU", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(new Date()));
  const greeting = hour < 5 ? "Late night" : hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";
  const doneN = t.done.filter((d) => !d.undone).length;
  const focusTitle = focus?.task_id ? ((await db().from("tasks").select("title").eq("id", focus.task_id).maybeSingle()).data as { title?: string } | null)?.title : null;

  return (
    <>
      <Head title="Dashboard" phoneTitle="MyManager" />
      {t.work.length > 0 && <AutoRefresh every={15} />}
      <div className="pagewrap fade-in">
        <h1 className="hello">{greeting}, Thomas</h1>
        <div className="stats">
          <Link href="#needs" className="st amber"><b>{t.needCount}</b> need you</Link>
          <span className="st green"><b>{t.work.length}</b> working</span>
          <span className="st grey"><b>{doneN}</b> done for you</span>
          {next && <Link href="/calendar" className="st cal"><Calendar size={15} />Next: {next.title}, {next.when}</Link>}
        </div>

        {t.needCount > 0 ? (
          <section id="needs">
            <div className="sec">Needs you</div>
            {pw && <div className="mb-2 text-[13.5px] text-bad">{pw}</div>}
            <Decisions approvals={t.approvals} asks={t.asks} steps={t.steps} name={name} max={8} />
          </section>
        ) : (
          <div className="flex items-center gap-2.5 rounded-[10px] border border-line px-4 py-3.5 text-[14.5px] text-muted">
            <CheckCircle2 size={18} className="text-[#1a9b5c]" />Nothing needs you right now. I&apos;ll tell you when something does.
          </div>
        )}

        {(t.work.length > 0 || focus) && (
          <section>
            <div className="sec">Working on</div>
            {focus && (
              <div className="wk">
                <div className="tile sm" style={{ background: "#e6efff" }}>⏱️</div>
                <div className="dt"><b>You&apos;re focusing{focusTitle ? `: ${focusTitle}` : ""}</b><span>{Math.max(0, focus.planned_minutes - Math.round((Date.now() - new Date(focus.started_at).getTime()) / 60000))} min left of {focus.planned_minutes}</span></div>
                <div className="pb"><i style={{ width: `${Math.min(100, Math.round(((Date.now() - new Date(focus.started_at).getTime()) / 60000 / focus.planned_minutes) * 100))}%` }} /></div>
                <form action={endFocus}><input type="hidden" name="outcome" value="done" /><button className="btn btn-sm">Finished</button></form>
              </div>
            )}
            <WorkingOn work={t.work} name={name} />
          </section>
        )}

        <DoneForYou done={t.done} />
        <DashChat name={assistant} />
        <AskBar name={assistant} quick />
      </div>
    </>
  );
}
