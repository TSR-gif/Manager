import Link from "next/link";
import { ArrowRight, Plus, TriangleAlert } from "lucide-react";
import { getProjects, getSettings, getTasks } from "@/lib/queries";
import { getSignals } from "@/lib/signals";
import { rankProjects } from "@/lib/focus";
import { PriorityBadge, ProjectAvatar, SignalChips, StatusDot, ago, dueInfo } from "@/components/ui";

export const dynamic = "force-dynamic";

const SECTIONS = [
  { status: "active", title: "Active", hint: "What you're actually working on" },
  { status: "paused", title: "Paused", hint: "On hold, not forgotten" },
  { status: "idea", title: "Ideas", hint: "Promoted from the inbox, not started" },
  { status: "done", title: "Done", hint: "Shipped" },
  { status: "archived", title: "Archived", hint: "Out of the way" },
] as const;

export default async function Projects() {
  const [projects, tasks, settings] = await Promise.all([getProjects(), getTasks({ includeDone: true }), getSettings()]);
  const signals = await getSignals(projects.filter((p) => p.status === "active" || p.status === "paused"));
  const ranked = rankProjects(projects, tasks.filter((t) => t.status !== "done"), signals);
  const rank = new Map(ranked.map((r, i) => [r.project.id, i]));
  const active = projects.filter((p) => p.status === "active").length;
  const over = active > settings.max_active_projects;

  return (
    <div className="fade-in space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-[14px] text-muted">Ranked by what needs you most. {projects.length} total.</p>
        </div>
        <Link href="/projects/new" className="btn btn-primary"><Plus size={16} /> New project</Link>
      </header>

      {over && (
        <div className="card flex items-start gap-3 !border-[rgba(255,200,87,.35)] !bg-[rgba(255,200,87,.06)]">
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-warn" />
          <div className="text-[14px]">
            <div className="font-medium">You&apos;re spread across {active} active projects (your limit is {settings.max_active_projects}).</div>
            <div className="text-muted">Pause the ones that don&apos;t need you this week so the Today screen can keep you on the right thing.</div>
          </div>
        </div>
      )}

      {SECTIONS.map(({ status, title, hint }) => {
        const list = projects
          .filter((p) => p.status === status)
          .sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99) || a.priority - b.priority);
        if (!list.length) return null;
        return (
          <section key={status}>
            <div className="mb-3 flex items-baseline gap-2">
              <h2 className="text-[15px] font-semibold">{title}</h2>
              <span className="text-[13px] text-faint">{list.length} · {hint}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((p) => {
                const pt = tasks.filter((t) => t.project_id === p.id);
                const open = pt.filter((t) => t.status !== "done").length;
                const done = pt.length - open;
                const pct = pt.length ? Math.round((done / pt.length) * 100) : 0;
                const due = dueInfo(p.deadline);
                return (
                  <Link key={p.id} href={`/projects/${p.id}`} className={`card card-hover group flex flex-col gap-3 ${status === "archived" || status === "done" ? "opacity-60" : ""}`}>
                    <div className="flex items-center gap-3">
                      <ProjectAvatar name={p.name} size={38} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-semibold">{p.name}</span>
                          <StatusDot status={p.status} />
                        </div>
                        <div className="text-[12px] text-muted">touched {ago(p.last_touched_at)}</div>
                      </div>
                      <PriorityBadge p={p.priority} />
                    </div>
                    <div className="min-h-[2.5rem] text-[13.5px] text-muted">
                      {p.next_action ? <span className="line-clamp-2"><ArrowRight size={13} className="mr-1 inline text-accent" />{p.next_action}</span> : <span className="text-faint">No next action set</span>}
                    </div>
                    <div>
                      <div className="mb-1.5 flex justify-between text-[11.5px] text-muted">
                        <span>{open} open · {done} done</span>
                        {due && <span className={due.tone === "bad" ? "text-bad" : due.tone === "warn" ? "text-warn" : ""}>Due {due.text}</span>}
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-line">
                        <div className="h-full rounded-full bg-gradient-to-r from-[#9a8bff] to-[#5ec8ff]" style={{ width: `${pct}%` }} />
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
