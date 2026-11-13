import Link from "next/link";
import { notFound } from "next/navigation";
import { GitBranch, Globe, Plus, TriangleAlert } from "lucide-react";
import { addTask, runJobNow, saveBrief, saveProject, saveRules, setProjectFolder, studyNow, toggleJob, toggleWatch } from "@/app/actions";
import { Md } from "@/components/md";
import { getActions, getProject, getSettings, getTasks } from "@/lib/queries";
import { getSignals } from "@/lib/signals";
import { TZ, priorityLabel, ago } from "@/components/ui";
import { db } from "@/lib/db";
import { TaskItem } from "@/components/task-item";
import type { Project } from "@/lib/types";
import { localState } from "@/lib/local-repos";
import { helperLook } from "@/lib/helper-look";
import { projectNames, todayData } from "@/lib/today";
import { Head } from "@/components/nav";
import { AskBar } from "@/components/ask-bar";
import { Decisions, WorkingOn } from "@/components/decisions";
import { RunbookCard } from "@/components/runbook-card";
import { jobTail, type Runbook } from "@/lib/runbooks";
import { scheduleText, type Job } from "@/lib/jobs";

export const dynamic = "force-dynamic";

const blank: Project = {
  id: "", name: "", status: "active", priority: 3, next_action: null, goal: null, notes: null,
  github_repo: null, vercel_project: null, deadline: null, last_touched_at: "", created_at: "",
};
const TABS = ["chat", "activity", "schedule", "rules"] as const;
type Tab = (typeof TABS)[number];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="label">{label}</span>{children}</label>;
}
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const day = d.toLocaleDateString("en-CA", { timeZone: TZ });
  const time = d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: TZ });
  return day === today ? `Today ${time}` : d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short", timeZone: TZ });
};
const every = (m: number) => (m < 60 ? `every ${m} min` : m === 60 ? "every hour" : m % 1440 === 0 ? (m === 1440 ? "once a day" : `every ${m / 1440} days`) : `every ${Math.round(m / 60)} hours`);

export default async function HelperPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cap?: string; tab?: string }> }) {
  const { id } = await params;
  const { cap, tab: tabQ } = await searchParams;
  const isNew = id === "new";
  const p = isNew ? blank : await getProject(id);
  if (!p) notFound();
  const tab: Tab = (TABS as readonly string[]).includes(tabQ ?? "") ? (tabQ as Tab) : "chat";
  const look = helperLook(p.name || "New");
  const settings = await getSettings();
  const bp = p as Project & { brief?: string | null; brief_updated_at?: string | null; brief_edited_by_you?: boolean; rules?: string | null; local_path?: string | null; watch?: boolean };

  const form = (
    <form action={saveProject} className="space-y-4">
      <input type="hidden" name="id" value={p.id} />
      <Field label="Name"><input name="name" defaultValue={p.name} required placeholder="e.g. Groceries, Bills, Clothing Brand" /></Field>
      <Field label="What it looks after"><input name="goal" defaultValue={p.goal ?? ""} placeholder="e.g. Does the weekly shop, asks before paying" /></Field>
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
      <Field label="Next step"><input name="next_action" defaultValue={p.next_action ?? ""} placeholder="The very next step" /></Field>
      <Field label="Deadline"><input type="date" name="deadline" defaultValue={p.deadline ?? ""} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="GitHub repo"><input name="github_repo" defaultValue={p.github_repo ?? ""} placeholder="TSR-gif/name" /></Field>
        <Field label="Vercel project"><input name="vercel_project" defaultValue={p.vercel_project ?? ""} placeholder="project-name" /></Field>
      </div>
      <Field label="Notes"><textarea name="notes" rows={3} defaultValue={p.notes ?? ""} placeholder="Links, context, anything" /></Field>
      {cap && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="force" value="1" className="!w-auto" /> Turn it on anyway</label>}
      <button className="btn btn-primary w-full">{isNew ? "Make this helper" : "Save changes"}</button>
    </form>
  );

  if (isNew) {
    return (
      <>
        <Head back={{ href: "/helpers", label: "Helpers" }} />
        <div className="pagewrap fade-in space-y-5">
          <h1 className="ttl">New helper</h1>
          <p className="text-[14px] text-muted">A helper looks after one project or one part of your life, like groceries, bills or the car. It works in the background and only comes to you for a decision or a result.</p>
          {cap && <div className="card card-alert flex items-start gap-3"><TriangleAlert size={18} className="mt-0.5 text-warn" /><div className="text-[14px]">You already have {settings.max_active_projects} helpers turned on. Pause one first, or tick <b>turn it on anyway</b>.</div></div>}
          <section className="card">{form}</section>
        </div>
      </>
    );
  }

  const [t, allTasks, actions, projectsQ] = await Promise.all([todayData(p.id), getTasks({ includeDone: true }), getActions(), db().from("projects").select("id,name")]);
  const name = projectNames((projectsQ.data ?? []) as { id: string; name: string }[]);
  const subtitle = p.goal || (t.needCount ? `${t.needCount} thing${t.needCount === 1 ? "" : "s"} need${t.needCount === 1 ? "s" : ""} you` : "Keeping an eye on it");

  let body: React.ReactNode = null;
  if (tab === "chat") {
    const { data: ms } = await db().from("missions").select("id").eq("project_id", p.id);
    const mids = ((ms ?? []) as { id: string }[]).map((m) => m.id);
    const { data: lg } = mids.length
      ? await db().from("mission_log").select("id,kind,text,created_at").in("mission_id", mids).in("kind", ["question", "answer", "told", "check", "done", "review"]).order("created_at", { ascending: false }).limit(24)
      : { data: [] };
    const log = ((lg ?? []) as { id: string; kind: string; text: string; created_at: string }[]).reverse();
    let lastDay = "";
    body = (
      <>
        {log.length === 0 && t.needCount === 0 && (
          <div className="py-8 text-center text-[14.5px] text-muted">Nothing to talk about yet. Tell {p.name} what you want it to look after, or ask it anything below.</div>
        )}
        {log.map((l) => {
          const day = dayLabel(l.created_at).replace(/^Today .*/, "Today");
          const head = day !== lastDay ? <div className="small">{day === "Today" ? dayLabel(l.created_at) : day}</div> : null;
          lastDay = day;
          return (
            <div key={l.id}>
              {head}
              {l.kind === "answer" ? <div className="you"><div>{l.text}</div></div> : <div className={`say ${l.kind === "check" ? "text-muted !text-[15px]" : ""}`}>{l.text}</div>}
            </div>
          );
        })}
        {t.needCount > 0 && (
          <>
            <div className="small">Waiting for you</div>
            <Decisions approvals={t.approvals} asks={t.asks} steps={t.steps} name={name} hideTile />
          </>
        )}
      </>
    );
  } else if (tab === "activity") {
    const open = allTasks.filter((x) => x.project_id === p.id && x.status !== "done");
    const { data: rq } = await db().from("runbooks").select("*").eq("project_id", p.id).order("created_at", { ascending: false }).limit(6);
    const runbooks = (rq ?? []) as Runbook[];
    const tails: Record<string, string> = {};
    for (const r of runbooks) for (const s of r.steps.list) if ((s.kind === "start_job" || s.kind === "watch_process") && s.status === "running") tails[s.id] = jobTail(s.log, 8);
    const { data: mq } = await db().from("missions").select("id,goal,status,last_update,created_at").eq("project_id", p.id).order("created_at", { ascending: false }).limit(8);
    const missions = (mq ?? []) as { id: string; goal: string; status: string; last_update: string | null; created_at: string }[];
    const history = actions.filter((a) => a.project_id === p.id).slice(0, 12);
    const local = bp.local_path ? await localState(bp.local_path) : null;
    const s = (await getSignals([p]))[p.id];
    body = (
      <>
        {t.work.length > 0 && <><div className="sec !mt-0">Working on</div><WorkingOn work={t.work} name={name} /></>}
        <div className="sec">Your to-dos</div>
        <div className="rounded-[10px] border border-line px-2 py-1.5">
          {open.length === 0 && <div className="px-2 py-2.5 text-[14px] text-muted">Nothing for you to do here.</div>}
          <ul>{open.slice(0, 12).map((x) => <TaskItem key={x.id} t={x} compact />)}</ul>
          <form action={addTask} className="flex items-center gap-2 border-t border-line px-2 pb-1 pt-2">
            <input type="hidden" name="project_id" value={p.id} />
            <Plus size={16} className="ml-1 text-faint" />
            <input name="title" placeholder="Add a to-do" autoComplete="off" required className="!h-9 flex-1 !border-0 !bg-transparent !px-1 !shadow-none text-[14px]" />
          </form>
        </div>
        {runbooks.some((r) => ["running", "waiting", "queued"].includes(r.status)) && (
          <><div className="sec">On your PC</div><ul className="space-y-3">{runbooks.filter((r) => ["running", "waiting", "queued"].includes(r.status)).map((r) => <RunbookCard key={r.id} r={r} project={p.name} tails={tails} />)}</ul></>
        )}
        {missions.length > 0 && (
          <>
            <div className="sec">Jobs</div>
            {missions.map((m) => (
              <Link key={m.id} href={`/supervise?m=${m.id}`} className="wk">
                <div className="dt"><b className="truncate">{m.goal}</b><span>{m.status === "running" ? m.last_update ?? "on it" : m.status === "waiting" ? "waiting for you" : `${m.status} · ${ago(m.created_at)}`}</span></div>
              </Link>
            ))}
          </>
        )}
        {(local || s?.vercel?.url || p.github_repo) && (
          <>
            <div className="sec">Code</div>
            {local && (
              <div className="grid gap-x-6 gap-y-1 text-[13px] text-muted sm:grid-cols-2">
                <div>Branch <span className="font-mono text-text">{local.branch}</span>{local.ahead ? <span className="text-warn"> · {local.ahead} not pushed</span> : null}</div>
                <div>Unsaved changes {local.changed ? <span className="text-warn">{local.changed}</span> : "none"}</div>
                <div className="truncate sm:col-span-2">Last commit {local.lastCommit || "none"}</div>
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {s?.vercel?.url && <a className="btn btn-sm" href={s.vercel.url} target="_blank"><Globe size={14} /> Live site</a>}
              {p.github_repo && <a className="btn btn-sm" href={`https://github.com/${p.github_repo}`} target="_blank"><GitBranch size={14} /> Code</a>}
              {p.kind !== "client" && <Link href={`/marketing?project=${p.id}`} className="btn btn-sm">Posts and ads</Link>}
            </div>
          </>
        )}
        {history.length > 0 && (
          <>
            <div className="sec">History</div>
            <ul className="divide-y divide-line text-[13.5px]">
              {history.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="truncate">{a.title}</span>
                  <span className="shrink-0 text-[12px] text-muted">{a.status} · {ago(a.created_at)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </>
    );
  } else if (tab === "schedule") {
    const [{ data: hq }, { data: jq }] = await Promise.all([
      db().from("missions").select("id,goal,status,check_every_minutes,next_check_at,ongoing,wake_on").eq("project_id", p.id).eq("status", "running"),
      db().from("jobs").select("*").eq("project_id", p.id).order("created_at"),
    ]);
    const rows = (hq ?? []) as { id: string; goal: string; check_every_minutes: number; next_check_at: string | null; ongoing?: boolean; wake_on?: string[] }[];
    const jobs = (jq ?? []) as Job[];
    const WAKE: Record<string, string> = { approval_decided: "you approve or turn something down", runbook_finished: "steps on your PC finish", job_finished: "a job on your PC ends", mission_finished: "a job finishes" };
    body = (
      <>
        <div className="sec !mt-0">Checks in</div>
        {rows.length === 0 && <div className="text-[14px] text-muted">Nothing regular yet. Tell {p.name} below what to look after and how often, like &quot;check the site every morning&quot;.</div>}
        {rows.map((m) => (
          <div key={m.id} className="wk">
            <div className="tile sm" style={{ background: look.bg }}>{m.ongoing ? "🔁" : "👀"}</div>
            <div className="dt"><b className="truncate">{m.goal}</b><span>{every(m.check_every_minutes)}{m.wake_on?.length ? `, and when ${m.wake_on.map((w) => WAKE[w] ?? w).join(" or ")}` : ""}</span></div>
            <Link href={`/supervise?m=${m.id}`} className="btn btn-sm">Open</Link>
          </div>
        ))}
        <div className="sec">Weekly jobs</div>
        {jobs.length === 0 && <div className="text-[14px] text-muted">No weekly jobs. Set them up in <Link href="/marketing" className="underline">Marketing</Link> or ask below.</div>}
        {jobs.map((j) => (
          <div key={j.id} className="wk">
            <div className="dt"><b className="truncate">{j.name}</b><span>{scheduleText(j)}{j.enabled ? "" : " · off"}{j.last_run_at ? ` · last ran ${ago(j.last_run_at)}` : ""}</span></div>
            <form action={runJobNow}><input type="hidden" name="id" value={j.id} /><button className="btn btn-sm">Run now</button></form>
            <form action={toggleJob}><input type="hidden" name="id" value={j.id} /><button className="btn btn-sm">{j.enabled ? "Turn off" : "Turn on"}</button></form>
          </div>
        ))}
        <div className="sec">Watching</div>
        <div className="wk">
          <div className="dt"><b>{bp.watch ? "Keeping an eye on it" : "Not watching"}</b><span>{bp.watch ? "I look at it regularly and tell you if something's wrong." : "Turn this on and I'll check it regularly by myself."}</span></div>
          <form action={toggleWatch}><input type="hidden" name="id" value={p.id} /><button className="btn btn-sm">{bp.watch ? "Stop" : "Keep an eye on it"}</button></form>
        </div>
      </>
    );
  } else {
    const hasCodeHere = !!(p.github_repo || bp.local_path);
    body = (
      <>
        <div className="sec !mt-0">Your rules</div>
        <form action={saveRules} className="space-y-2">
          <input type="hidden" name="id" value={p.id} />
          <textarea name="rules" defaultValue={bp.rules ?? ""} rows={3} placeholder="e.g. Pretend money only. Never touch the live site on Fridays. Under $160 a week." />
          <button className="btn btn-sm">Save rules</button>
        </form>
        <div className="sec">What it does by itself, and what it asks about</div>
        <div className="brief space-y-1.5">
          <div><b>By itself:</b> checks on things, reads files and code, keeps notes, adds to-dos, drafts posts and plans, and does coding steps on its own branch once you&apos;ve said yes.</div>
          <div><b>Always asks you first:</b> paying for anything, signing up, sending email as you, posting, pushing code, deleting, and changing settings on your PC.</div>
        </div>
        <div className="sec flex items-center gap-2">What it knows
          <span className="font-normal normal-case tracking-normal">{bp.brief_updated_at ? `· written ${ago(bp.brief_updated_at)}${bp.brief_edited_by_you ? ", corrected by you" : ""}` : ""}</span>
          {hasCodeHere && <form action={studyNow} className="ml-auto"><input type="hidden" name="id" value={p.id} /><button className="btn btn-sm normal-case tracking-normal">{bp.brief ? "Study it again" : "Study it now"}</button></form>}
        </div>
        {bp.brief ? (
          <details className="group">
            <summary className="cursor-pointer list-none">
              <Md text={bp.brief.split(/\n(?=## )/).slice(0, 1).join("")} className="text-[14px] leading-relaxed" />
              <span className="mt-2 inline-block text-[13px] font-medium group-open:hidden">Show more</span>
            </summary>
            <Md text={bp.brief.split(/\n(?=## )/).slice(1).join("\n")} className="mt-2.5 text-[14px] leading-relaxed" />
            <details className="mt-3">
              <summary className="cursor-pointer list-none text-[13px] font-medium">Fix something in it</summary>
              <form action={saveBrief} className="mt-2 space-y-2">
                <input type="hidden" name="id" value={p.id} />
                <textarea name="brief" defaultValue={bp.brief} rows={14} className="font-mono !text-[12.5px]" />
                <button className="btn">Save</button>
              </form>
            </details>
          </details>
        ) : (
          <form action={saveBrief} className="space-y-2">
            <p className="text-[13.5px] text-muted">{hasCodeHere ? "It will read the code and write down what it is, how to run it and what's next. Or tell it yourself:" : "Tell it what this is, where it's at and what's next."}</p>
            <input type="hidden" name="id" value={p.id} />
            <textarea name="brief" rows={4} placeholder={"What it is:\nWhere it's at:\nWhat's next:"} />
            <button className="btn">Save</button>
          </form>
        )}
        <div className="sec">Folder on this PC</div>
        <form action={setProjectFolder} className="flex gap-2">
          <input type="hidden" name="id" value={p.id} />
          <input name="local_path" defaultValue={bp.local_path ?? ""} placeholder="e.g. C:\\Users\\you\\Documents\\DayTrader" className="font-mono !text-[13px]" />
          <button className="btn shrink-0">Save</button>
        </form>
        <details className="mt-6">
          <summary className="sec cursor-pointer list-none">Name, status and links</summary>
          <div className="card mt-2">{form}</div>
        </details>
      </>
    );
  }

  return (
    <>
      <Head back={{ href: "/helpers", label: "Helpers" }} />
      <div className="pagewrap fade-in">
        <div className="hh">
          <div className="tile lg" style={{ background: look.bg }}>{look.emoji}</div>
          <h1>{p.name}</h1>
          <div className="stl">{subtitle}</div>
        </div>
        <nav className="seg">
          {TABS.map((x) => <Link key={x} href={`/projects/${p.id}${x === "chat" ? "" : `?tab=${x}`}`} className={tab === x ? "on" : ""}>{x[0].toUpperCase() + x.slice(1)}</Link>)}
        </nav>
        {body}
        <AskBar about={p.name} placeholder={`Message ${p.name}`} />
      </div>
    </>
  );
}
