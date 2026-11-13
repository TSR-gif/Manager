import Link from "next/link";
import { ArrowRight, FolderSearch, Plus } from "lucide-react";
import { findProjectFolders, pauseProjects } from "@/app/actions";
import { getProjects, getSettings, getTasks } from "@/lib/queries";
import { getSignals } from "@/lib/signals";
import { rankProjects } from "@/lib/focus";
import { HEALTH_TONE, projectHealth } from "@/lib/health";
import { PriorityBadge, ProjectAvatar, SignalChips, StatusDot, ago, dueInfo } from "@/components/ui";

export const dynamic = "force-dynamic";

const SECTIONS = [
  { status: "active", title: "Active", hint: "What you're actually working on" },
  { status: "paused", title: "Paused", hint: "On hold, not forgotten" },
  { status: "idea", title: "Ideas", hint: "Promoted from the inbox, not started" },
  { status: "done", title: "Done", hint: "Shipped" },
  { status: "archived", title: "Archived", hint: "Out of the way" },
] as const;

export default async function Projects({ searchParams }: { searchParams: Promise<{ found?: string; scanned?: string }> }) {
  const { found, scanned } = await searchParams;
  const [projects, tasks, settings] = await Promise.all([getProjects(), getTasks({ includeDone: true }), getSettings()]);
  const noCode = projects.filter((x) => x.status !== "done" && !x.github_repo && !(x as { local_path?: string | null }).local_path && !(x as { brief?: string | null }).brief);
  const signals = await getSignals(projects.filter((p) => p.status === "active" || p.status === "paused"));
  const ranked = rankProjects(projects, tasks.filter((t) => t.status !== "done"), signals);
  const rank = new Map(ranked.map((r, i) => [r.project.id, i]));
  const active = projects.filter((p) => p.status === "active").length;
  const over = active > settings.max_active_projects;
  const toPause = projects.filter((p) => p.status === "active").sort((a, b) => (rank.get(b.id) ?? 99) - (rank.get(a.id) ?? 99)).slice(0, Math.max(0, active - settings.max_active_projects));

  return (
    <div className="fade-in space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-[26px] md:text-[30px]">Projects</h1>
          <p className="mt-1 text-[14px] text-muted">Ranked by what needs you most. {projects.length} total.</p>
        </div>
        <div className="flex gap-2">
          <form action={findProjectFolders}><button className="btn" title="Looks in Documents, Desktop and your user folder for your project folders"><FolderSearch size={16} /> Find folders on this PC</button></form>
          <Link href="/projects/new" className="btn"><Plus size={16} /> New project</Link>
        </div>
      </header>
      {noCode.length > 0 && (
        <div className="card !py-3 text-[13.5px] text-muted">
          <span className="text-text">MyManager has no code to study for </span>
          {noCode.map((x, i) => <span key={x.id}>{i > 0 && ", "}<Link href={`/projects/${x.id}`} className="text-accent">{x.name}</Link></span>)}.
          {" "}Add a few lines about each on its page so it knows what they are.
        </div>
      )}
      {found != null && (
        <div className="card !py-3 text-[13.5px] text-muted">
          {Number(found) > 0 ? <>Linked <b className="text-text">{found}</b> project{found === "1" ? "" : "s"} to {found === "1" ? "its folder" : "their folders"} on this PC.</> : <>No new project folders found ({scanned} git folders looked at). You can set a folder on each project&apos;s page.</>}
        </div>
      )}

      {over && (
        <form action={pauseProjects} className="card flex flex-col gap-3 card-alert sm:flex-row sm:items-center">
          {toPause.map((p) => <input key={p.id} type="hidden" name="id" value={p.id} />)}
          <div className="min-w-0 flex-1 text-[14px]">
            <div className="font-medium">Pause {toPause.map((p) => p.name).join(", ")} for now?</div>
            <div className="text-muted">You&apos;ve got {active} on the go (you said {settings.max_active_projects} is your limit). These need you least this week. You can switch them back any time.</div>
          </div>
          <button className="btn btn-primary shrink-0 !min-h-11">Yes, pause {toPause.length === 1 ? "it" : `these ${toPause.length}`}</button>
        </form>
      )}

      {SECTIONS.map(({ status, title, hint }) => {
        const list = projects
          .filter((p) => p.status === status)
          .sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99) || a.priority - b.priority);
        if (!list.length) return null;
        return (
          <section key={status}>
            <div className="mb-3 flex items-baseline gap-2">
              <h2 className="kicker !text-muted">{title}</h2>
              <span className="text-[13px] text-faint">{list.length} · {hint}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((p) => {
                const pt = tasks.filter((t) => t.project_id === p.id);
                const open = pt.filter((t) => t.status !== "done").length;
                const done = pt.length - open;
                const pct = pt.length ? Math.round((done / pt.length) * 100) : 0;
                const due = dueInfo(p.deadline);
                const h = projectHealth(p, tasks, signals[p.id]);
                return (
                  <Link key={p.id} href={`/projects/${p.id}`} className={`card card-hover group flex flex-col gap-3 ${status === "archived" || status === "done" ? "opacity-60" : ""}`}>
                    <div className="flex items-center gap-3">
                      <ProjectAvatar name={p.name} size={38} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-semibold">{p.name}</span>
                          {h.level === "idle" ? <StatusDot status={p.status} /> : (
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: HEALTH_TONE[h.level], boxShadow: `0 0 10px ${HEALTH_TONE[h.level]}` }} title={`${h.label}${h.reasons.length ? `: ${h.reasons.join(", ")}` : ""}`} />
                          )}
                        </div>
                        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[12px] text-muted">{p.kind === "client" && <span className="chip chip-accent2 !py-0">Client</span>}<span className="truncate">touched {ago(p.last_touched_at)}</span></div>
                      </div>
                      <PriorityBadge p={p.priority} />
                    </div>
                    <div className="min-h-[2.5rem] text-[13.5px] text-muted">
                      {p.next_action ? <span className="line-clamp-2"><ArrowRight size={13} className="mr-1 inline text-accent" />{p.next_action}</span> : <span className="text-faint">No next action set</span>}
                    </div>
                    <div>
                      <div className="mb-1.5 flex justify-between text-[11.5px] text-muted">
                        <span>{open} open · {done} done{h.level !== "idle" && <> · <span style={{ color: HEALTH_TONE[h.level] }} title={h.reasons.join(", ")}>{h.level === "good" ? h.label : h.reasons[0]}</span></>}</span>
                        {due && <span className={due.tone === "bad" ? "text-bad" : due.tone === "warn" ? "text-warn" : ""}>Due {due.text}</span>}
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-line">
                        <div className="h-full rounded-full bg-gradient-to-r from-[#38bdf8] to-[#818cf8]" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <SignalChips s={signals[p.id]} />
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
