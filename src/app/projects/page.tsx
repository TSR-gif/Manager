import Link from "next/link";
import { getProjects, getSettings, getTasks } from "@/lib/queries";
import { getSignals } from "@/lib/signals";
import { rankProjects } from "@/lib/focus";
import { SignalChips, StatusDot, ago } from "@/components/ui";

export const dynamic = "force-dynamic";

const ORDER = ["active", "paused", "idea", "done", "archived"] as const;

export default async function Projects() {
  const [projects, tasks, settings] = await Promise.all([getProjects(), getTasks(), getSettings()]);
  const signals = await getSignals(projects.filter((p) => p.status === "active" || p.status === "paused"));
  const rank = new Map(rankProjects(projects, tasks, signals).map((r, i) => [r.project.id, i]));
  const active = projects.filter((p) => p.status === "active").length;

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <div className="text-sm text-muted" style={active > settings.max_active_projects ? { color: "#facc15" } : undefined}>
            {active} active of {settings.max_active_projects} allowed
            {active > settings.max_active_projects && " — you're spread thin, pause some"}
          </div>
        </div>
        <Link href="/projects/new" className="btn btn-primary">New</Link>
      </header>

      {ORDER.map((status) => {
        const list = projects
          .filter((p) => p.status === status)
          .sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99) || a.priority - b.priority);
        if (!list.length) return null;
        return (
          <section key={status}>
            <div className="label mb-2 capitalize">{status} · {list.length}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              {list.map((p) => {
                const open = tasks.filter((t) => t.project_id === p.id).length;
                return (
                  <Link key={p.id} href={`/projects/${p.id}`} className="card block hover:border-accent">
                    <div className="flex items-center gap-2">
                      <StatusDot status={p.status} />
                      <span className="font-semibold">{p.name}</span>
                      <span className="chip ml-auto">P{p.priority}</span>
                    </div>
                    {p.next_action && <div className="mt-1 truncate text-sm text-muted">→ {p.next_action}</div>}
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <span className="chip">{open} open</span>
                      {p.deadline && <span className="chip">due {p.deadline}</span>}
                      <span className="chip">touched {ago(p.last_touched_at)}</span>
                    </div>
                    <div className="mt-1"><SignalChips s={signals[p.id]} /></div>
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
