import Link from "next/link";
import { Plus } from "lucide-react";
import { pauseProjects } from "@/app/actions";
import { db } from "@/lib/db";
import { getActions, getProjects, getSettings, getTasks } from "@/lib/queries";
import { getSignals } from "@/lib/signals";
import { rankProjects } from "@/lib/focus";
import { HEALTH_TONE, projectHealth } from "@/lib/health";
import { ProjectAvatar } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Projects({ searchParams }: { searchParams: Promise<{ found?: string; scanned?: string }> }) {
  const { found, scanned } = await searchParams;
  const [projects, tasks, settings, pending] = await Promise.all([getProjects(), getTasks({ includeDone: true }), getSettings(), getActions(["pending"])]);
  const { data: wq } = await db().from("missions").select("project_id").eq("status", "waiting");
  const needs = new Set([...pending.map((a) => (a as { project_id?: string | null }).project_id), ...((wq ?? []) as { project_id: string | null }[]).map((m) => m.project_id)].filter(Boolean) as string[]);
  const signals = await getSignals(projects.filter((p) => p.status === "active" || p.status === "paused"));
  const ranked = rankProjects(projects, tasks.filter((t) => t.status !== "done"), signals);
  const rank = new Map(ranked.map((r, i) => [r.project.id, i]));
  const active = projects.filter((p) => p.status === "active").length;
  const over = active > settings.max_active_projects;
  const toPause = projects.filter((p) => p.status === "active").sort((a, b) => (rank.get(b.id) ?? 99) - (rank.get(a.id) ?? 99)).slice(0, Math.max(0, active - settings.max_active_projects));

  return (
    <div className="fade-in mx-auto max-w-[620px] pt-2 md:pt-8 space-y-5">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="display text-[26px] md:text-[30px]">Projects</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/projects/new" className="btn btn-ghost btn-sm"><Plus size={15} /> New</Link>
        </div>
      </header>
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
            <div className="text-muted">{active} on the go, your limit is {settings.max_active_projects}. These need you least.</div>
          </div>
          <button className="btn btn-primary shrink-0 !min-h-11">Yes, pause {toPause.length === 1 ? "it" : `these ${toPause.length}`}</button>
        </form>
      )}

      {(() => {
        const sorted = (st: string) => projects.filter((p) => p.status === st).sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99) || a.priority - b.priority);
        const Row = ({ p }: { p: (typeof projects)[number] }) => {
          const h = projectHealth(p, tasks, signals[p.id]);
          const needsYou = needs.has(p.id);
          const tone = needsYou ? "var(--warn)" : h.level === "bad" ? HEALTH_TONE.bad : h.level === "idle" ? "var(--faint)" : HEALTH_TONE.good;
          return (
            <li>
              <Link href={`/projects/${p.id}`} className="flex min-h-[56px] items-center gap-3 px-4 py-2.5 transition hover:bg-panel2/60">
                <ProjectAvatar name={p.name} size={28} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{p.name}</span>
                {needsYou ? <span className="text-[12.5px] font-medium text-warn">Needs you</span> : <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone }} />}
              </Link>
            </li>
          );
        };
        const rest = [...sorted("paused"), ...sorted("idea"), ...sorted("done"), ...sorted("archived")];
        return (
          <>
            <ul className="card divide-y divide-line !p-0">{sorted("active").map((p) => <Row key={p.id} p={p} />)}</ul>
            {rest.length > 0 && (
              <details className="card !p-0">
                <summary className="cursor-pointer list-none px-4 py-3 text-[14px] font-medium">Not active <span className="text-faint">{rest.length}</span></summary>
                <ul className="divide-y divide-line border-t border-line opacity-80">{rest.map((p) => <Row key={p.id} p={p} />)}</ul>
              </details>
            )}
          </>
        );
      })()}
    </div>
  );
}
