import Link from "next/link";
import { CheckCircle2, Lightbulb, ListTodo, PauseCircle, Snail, Timer, Trash2, TrendingUp } from "lucide-react";
import { completeReview, setProjectStatus } from "@/app/actions";
import { db, unwrap } from "@/lib/db";
import { getIdeas, getProjects, getSettings, getTasks } from "@/lib/queries";
import { ProjectAvatar, ago } from "@/components/ui";
import type { FocusSession, Task } from "@/lib/types";

export const dynamic = "force-dynamic";

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="mb-3 flex items-center gap-3">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-panel3 text-[13px] font-semibold text-accent">{n}</span>
        <span className="font-semibold">{title}</span>
      </div>
      {children}
    </section>
  );
}

export default async function Review() {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [projects, openTasks, settings, inbox] = await Promise.all([getProjects(), getTasks(), getSettings(), getIdeas("inbox")]);
  const done: Task[] = unwrap(await db().from("tasks").select("*").eq("status", "done").gte("done_at", since));
  const sessions: FocusSession[] = unwrap(await db().from("focus_sessions").select("*").gte("started_at", since));
  const minutes = sessions.reduce((m, s) => m + (s.ended_at ? (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000 : 0), 0);
  const active = projects.filter((p) => p.status === "active");
  const stalled = active.filter((p) => Date.now() - new Date(p.last_touched_at).getTime() > 7 * 86_400_000);
  const byProject = (id: string | null) => done.filter((t) => t.project_id === id).length;
  const maxDone = Math.max(1, ...active.map((p) => byProject(p.id)), byProject(null));
  const { data: usageRows } = await db().from("usage_events").select("path,device,seconds").gte("created_at", since);
  const SCREEN: Record<string, string> = { "/": "Today", "/agent": "Assistant", "/projects": "Projects", "/money": "Money", "/approvals": "Approvals", "/inbox": "Ideas", "/review": "Weekly review", "/me": "About you", "/settings": "Settings", "/more": "More" };
  const screenOf = (path: string) => SCREEN["/" + (path.split("/")[1] ?? "")] ?? "Other";
  const usage = new Map<string, { phone: number; desktop: number; secs: number }>();
  for (const u of (usageRows ?? []) as { path: string; device: string; seconds: number }[]) {
    const k = screenOf(u.path);
    const e = usage.get(k) ?? { phone: 0, desktop: 0, secs: 0 };
    if (u.device === "phone") e.phone++; else e.desktop++;
    e.secs += u.seconds ?? 0;
    usage.set(k, e);
  }
  const usageList = [...usage.entries()].sort((x, y) => y[1].phone + y[1].desktop - (x[1].phone + x[1].desktop));

  return (
    <div className="fade-in space-y-6">
      <header>
        <h1 className="text-[28px] font-semibold tracking-tight">Weekly review</h1>
        <p className="mt-1 text-[14px] text-muted">Last done {ago(settings.last_review_at)}. Ten minutes, once a week, keeps everything else honest.</p>
      </header>

      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: <CheckCircle2 size={18} />, label: "Tasks done", v: done.length, tone: "var(--good)" },
          { icon: <Timer size={18} />, label: "Focus hours", v: (minutes / 60).toFixed(1), tone: "var(--accent-2)" },
          { icon: <ListTodo size={18} />, label: "Still open", v: openTasks.length, tone: "var(--accent)" },
        ].map((x) => (
          <div key={x.label} className="card !p-4">
            <div style={{ color: x.tone }}>{x.icon}</div>
            <div className="mt-2 text-[24px] font-semibold tabular-nums">{x.v}</div>
            <div className="text-[12px] text-muted">{x.label}</div>
          </div>
        ))}
      </div>

      <Step n={1} title="What moved this week">
        <ul className="space-y-2.5">
          {[...active.map((p) => ({ id: p.id, name: p.name, n: byProject(p.id) })), { id: "everyday", name: "Everyday", n: byProject(null) }]
            .sort((a, b) => b.n - a.n)
            .map((r) => (
              <li key={r.id} className="flex items-center gap-3 text-[14px]">
                <ProjectAvatar name={r.name} size={24} />
                <span className="w-40 truncate">{r.name}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#9a8bff] to-[#5ec8ff]" style={{ width: `${(r.n / maxDone) * 100}%` }} />
                </div>
                <span className="w-14 text-right text-muted tabular-nums">{r.n} done</span>
              </li>
            ))}
        </ul>
      </Step>

      <Step n={2} title="What stalled — keep, pause or drop?">
        {stalled.length === 0 ? (
          <div className="flex items-center gap-2 text-[14px] text-muted"><TrendingUp size={16} className="text-good" /> Nothing stalled. Every active project was touched this week.</div>
        ) : (
          <ul className="space-y-2">
            {stalled.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-bg2/50 p-3">
                <Snail size={16} className="text-warn" />
                <span className="flex-1">{p.name} <span className="text-[12px] text-muted">untouched {ago(p.last_touched_at)}</span></span>
                <form action={setProjectStatus.bind(null, p.id, "paused")}><button className="btn btn-sm"><PauseCircle size={13} /> Pause</button></form>
                <form action={setProjectStatus.bind(null, p.id, "archived")}><button className="btn btn-bad btn-sm"><Trash2 size={13} /> Drop</button></form>
              </li>
            ))}
          </ul>
        )}
      </Step>

      <Step n={3} title="Reset priorities">
        <p className="text-[14px] text-muted">
          You have <b className="text-text">{active.length}</b> active projects (limit {settings.max_active_projects}).{" "}
          <Link href="/projects" className="text-accent">Adjust priorities and deadlines →</Link>
        </p>
        {inbox.length > 0 && (
          <Link href="/inbox" className="mt-3 flex items-center gap-2 text-[14px] text-accent"><Lightbulb size={15} /> Triage {inbox.length} waiting idea{inbox.length > 1 ? "s" : ""} →</Link>
        )}
      </Step>

      <form action={completeReview}><button className="btn btn-primary w-full !py-3">Finish review</button></form>
      {usageList.length > 0 && (
        <section className="card">
          <div className="mb-1 font-semibold">How you used MyManager this week</div>
          <p className="mb-3 text-[12.5px] text-muted">Only kept on this PC. Ask the assistant &quot;what should change based on how I use you?&quot; and it will suggest tweaks, never make them without asking.</p>
          <ul className="space-y-1.5 text-[13.5px]">
            {usageList.map(([k, v]) => (
              <li key={k} className="flex items-center gap-3">
                <span className="w-32 truncate">{k}</span>
                <span className="text-muted">{v.phone} on phone · {v.desktop} on computer</span>
                <span className="ml-auto text-[12px] text-faint">{Math.round(v.secs / 60)} min</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
