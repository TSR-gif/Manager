import Link from "next/link";
import { Bot, CheckCircle2, CircleHelp, Code2, Eye, History, Play, Plus, Square } from "lucide-react";
import { answerMissionForm, checkMissionNow, setMissionStatus, startMission } from "@/app/actions";
import { db } from "@/lib/db";
import { getProjects, getSettings } from "@/lib/queries";
import { Empty, ProjectAvatar, ago } from "@/components/ui";
import type { Mission, MissionLog } from "@/lib/missions";

export const dynamic = "force-dynamic";

interface Step { id: string; title: string; status: string; mission_id: string }

const inMins = (iso: string | null) => {
  if (!iso) return "soon";
  const m = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (m <= 1) return "any minute";
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  return `in ${h} hour${h > 1 ? "s" : ""}`;
};
const every = (m: number) => (m < 60 ? `every ${m} min` : m === 60 ? "every hour" : m >= 1440 ? "once a day" : `every ${Math.round(m / 60)} hours`);
const LOG_ICON: Record<string, string> = { check: "👀", question: "❓", answer: "💬", work: "🛠", done: "✅", note: "•" };

export default async function Supervise({ searchParams }: { searchParams: Promise<{ project?: string; m?: string }> }) {
  const { project, m: focus } = await searchParams;
  const [projects, settings, mq, sq, lq, aq] = await Promise.all([
    getProjects(), getSettings(),
    db().from("missions").select("*").order("created_at", { ascending: false }),
    db().from("tasks").select("id,title,status,mission_id").order("created_at").limit(2000),
    db().from("mission_log").select("*").order("created_at", { ascending: false }).limit(400),
    db().from("actions").select("payload,status").eq("kind", "mission.code").eq("status", "pending"),
  ]);
  const name = (settings as { assistant_name?: string }).assistant_name || "MyManager";
  const all = ((mq.data ?? []) as Mission[]).filter((m) => !project || m.project_id === project);
  const steps = ((sq.data ?? []) as Step[]).filter((s) => s.mission_id);
  const logs = (lq.data ?? []) as MissionLog[];
  const codeAsked = new Set(((aq.data ?? []) as { payload: { mission_id?: string } }[]).map((a) => a.payload.mission_id));
  const pname = (id: string | null) => projects.find((p) => p.id === id)?.name ?? "Everyday";
  const waiting = all.filter((m) => m.status === "waiting");
  const running = all.filter((m) => m.status === "running");
  const finished = all.filter((m) => m.status === "done" || m.status === "stopped").slice(0, 10);
  const active = projects.filter((p) => p.status !== "done");

  const Card = ({ m }: { m: Mission }) => {
    const st = steps.filter((s) => s.mission_id === m.id);
    const done = st.filter((s) => s.status === "done").length;
    const log = logs.filter((l) => l.mission_id === m.id).slice(0, 12);
    const coder = m.worker === "working" ? { t: "Coding a step now", c: "chip-accent" }
      : m.can_code ? { t: "Can do the coding", c: "chip-good" }
      : codeAsked.has(m.id) ? { t: "Coding waits for your OK", c: "chip-warn" } : null;
    return (
      <li id={m.id} className={`card space-y-3 ${m.status === "waiting" ? " card-alert" : ""} ${focus === m.id ? "ring-2 ring-accent/50" : ""}`}>
        <div className="flex items-center gap-2">
          <ProjectAvatar name={pname(m.project_id)} size={22} />
          <span className="text-[13px] font-medium text-muted">{pname(m.project_id)}</span>
          {coder && <span className={`chip ${coder.c}`}><Code2 size={11} /> {coder.t}</span>}
          <span className="ml-auto text-[12px] text-faint">started {ago(m.created_at)}</span>
        </div>
        <div className="text-[16px] font-semibold leading-snug">{m.goal}</div>
        {m.status === "waiting" && m.question && (
          <div className="space-y-2 rounded-xl border border-[rgba(251,191,36,.35)] bg-[rgba(251,191,36,.07)] p-3">
            <div className="flex gap-2 text-[14px]"><CircleHelp size={16} className="mt-0.5 shrink-0 text-warn" /><span>{m.question}</span></div>
            <form action={answerMissionForm} className="flex gap-2">
              <input type="hidden" name="id" value={m.id} />
              <input name="answer" placeholder="Your answer" required autoComplete="off" />
              <button className="btn btn-primary shrink-0">Send</button>
            </form>
          </div>
        )}
        {m.last_update && <div className="text-[13.5px] text-muted"><b className="font-medium text-text">Where it&apos;s at: </b>{m.last_update}</div>}
        {st.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-[12px] text-faint">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel3"><div className="h-full rounded-full bg-good" style={{ width: `${Math.round((done / st.length) * 100)}%` }} /></div>
              {done} of {st.length} steps
            </div>
            <ul className="space-y-1 text-[13.5px]">
              {st.map((s) => (
                <li key={s.id} className="flex items-start gap-2">
                  {s.status === "done" ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-good" /> : <span className="mt-[3px] h-[13px] w-[13px] shrink-0 rounded-full border border-line2" />}
                  <span className={s.status === "done" ? "text-faint line-through" : ""}>{s.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {m.status === "running" && (
          <div className="flex items-center gap-1.5 text-[12.5px] text-faint">
            <Eye size={12} /> {m.last_check_at ? `Checked ${ago(m.last_check_at)}` : "Not checked yet"} · next check {inMins(m.next_check_at)} ({every(m.check_every_minutes)})
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {m.status === "running" && <form action={checkMissionNow}><input type="hidden" name="id" value={m.id} /><button className="btn btn-sm"><Play size={13} /> Check now</button></form>}
          {(m.status === "running" || m.status === "waiting") && (
            <>
              <form action={setMissionStatus}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="status" value="done" /><button className="btn btn-good btn-sm"><CheckCircle2 size={13} /> It&apos;s finished</button></form>
              <form action={setMissionStatus}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="status" value="stopped" /><button className="btn btn-ghost btn-sm"><Square size={12} /> Stop</button></form>
            </>
          )}
          {(m.status === "done" || m.status === "stopped") && <form action={setMissionStatus}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="status" value="running" /><button className="btn btn-sm"><Play size={13} /> Start again</button></form>}
        </div>
        {log.length > 0 && (
          <details>
            <summary className="flex cursor-pointer items-center gap-1.5 text-[13px] text-accent"><History size={13} /> What it&apos;s done</summary>
            <ul className="mt-2 space-y-1.5 border-l border-line pl-3 text-[13px]">
              {log.map((l) => (
                <li key={l.id}><span className="mr-1">{LOG_ICON[l.kind] ?? "•"}</span>{l.text}<span className="ml-1.5 text-[11.5px] text-faint">{ago(l.created_at)}</span></li>
              ))}
            </ul>
          </details>
        )}
      </li>
    );
  };

  return (
    <div className="fade-in space-y-8">
      <header>
        <h1 className="display text-[26px] md:text-[30px]">Supervise</h1>
        <p className="mt-1 text-[14px] text-muted">Tell {name} what a project is doing. It keeps checking until it&apos;s finished, ticks off the steps, and messages you when it needs you.</p>
      </header>

      {all.length === 0 && (
        <div className="card space-y-3">
          <Empty icon={<Bot size={18} />} title="Nothing being supervised" hint={`Try telling ${name}: "Day trader is doing the backtest fix and the README, make sure it gets finished."`} />
          <div className="flex justify-center"><Link className="btn btn-sm" href={`/agent?ask=${encodeURIComponent("Day trader is doing ")}`}>Tell {name}</Link></div>
        </div>
      )}

      {waiting.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline gap-2"><h2 className="kicker !text-muted">Waiting on you</h2><span className="text-[13px] text-faint">{waiting.length}</span></div>
          <ul className="grid gap-3 md:grid-cols-2">{waiting.map((m) => <Card key={m.id} m={m} />)}</ul>
        </section>
      )}

      {running.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline gap-2"><h2 className="kicker !text-muted">Running</h2><span className="text-[13px] text-faint">{running.length}</span></div>
          <ul className="grid gap-3 md:grid-cols-2">{running.map((m) => <Card key={m.id} m={m} />)}</ul>
        </section>
      )}

      <details className="card" open={all.length === 0}>
        <summary className="flex cursor-pointer items-center gap-2 text-[14px] font-medium"><Plus size={15} /> Supervise something new</summary>
        <form action={startMission} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5"><span className="label">Project</span>
              <select name="project_id" defaultValue={project ?? active.find((p) => /day ?trader/i.test(p.name))?.id ?? active[0]?.id}>
                {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="block space-y-1.5"><span className="label">Check on it</span>
              <select name="every" defaultValue="1">
                <option value="0.25">Every 15 minutes</option><option value="0.5">Every 30 minutes</option><option value="1">Every hour</option>
                <option value="3">Every 3 hours</option><option value="24">Once a day</option>
              </select>
            </label>
          </div>
          <label className="block space-y-1.5"><span className="label">What&apos;s it doing, and what counts as finished?</span><textarea name="goal" rows={2} required placeholder="e.g. Fixing the backtest so it beats buy-and-hold, and cleaning up the old backup files" /></label>
          <label className="block space-y-1.5"><span className="label">Steps (one per line, or leave blank and {name} works them out)</span><textarea name="steps" rows={3} placeholder={"Fix the backtest\nDelete the backup files\nUpdate the README"} /></label>
          <label className="block space-y-1.5"><span className="label">Folder on this PC (only if you want {name} to do the coding)</span><input name="work_dir" placeholder="e.g. C:\Users\you\Documents\DayTrader" /></label>
          <p className="text-[12.5px] text-faint">With a folder, {name} asks your OK once, then codes one step at a time on its own branch. It never pushes, deploys or touches real money.</p>
          <button className="btn btn-primary">Start supervising</button>
        </form>
      </details>

      {finished.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline gap-2"><h2 className="kicker !text-muted">Finished</h2><span className="text-[13px] text-faint">{finished.length}</span></div>
          <ul className="grid gap-3 md:grid-cols-2">{finished.map((m) => <Card key={m.id} m={m} />)}</ul>
        </section>
      )}
    </div>
  );
}
