import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { saveAssistant, setAutonomy } from "@/app/actions";
import { Orb } from "@/components/orb";
import { agentBackend } from "@/lib/agent/run";
import { getSettings } from "@/lib/queries";
import { AgentConsole } from "@/components/agent-console";
import { ago } from "@/components/ui";
import type { AgentEvent } from "@/lib/agent/run";

export const dynamic = "force-dynamic";

interface RunRow { id: string; goal: string; status: string; created_at: string; kind?: string; unread?: boolean; events?: AgentEvent[] }

const KIND_LABEL: Record<string, string> = { brief: "Morning brief", checkin: "Check-in", job: "Job" };

export default async function AgentPage({ searchParams }: { searchParams: Promise<{ run?: string; ask?: string }> }) {
  const { run, ask } = await searchParams;
  const [{ data: runs }, current, settings] = await Promise.all([
    db().from("agent_runs").select("id,goal,status,created_at,kind,unread").order("created_at", { ascending: false }).limit(30),
    run ? db().from("agent_runs").select("id,goal,status,created_at,events").eq("id", run).maybeSingle() : Promise.resolve({ data: null }),
    getSettings(),
  ]);
  const autonomy = (settings as { autonomy?: string }).autonomy ?? "balanced";
  const cur = current.data as RunRow | null;
  if (cur && (runs ?? []).find((r: RunRow) => r.id === cur.id)?.unread) await db().from("agent_runs").update({ unread: false }).eq("id", cur.id);
  const s = settings as unknown as { assistant_name?: string; proactive?: boolean; brief_time?: string; checkin_hours?: number; quiet_start?: string };
  const name = s.assistant_name || "Manager";
  const backend = agentBackend();
  const needsKey = backend === "api" && !process.env.ANTHROPIC_API_KEY;

  return (
    <div className="fade-in grid gap-6 lg:grid-cols-[1fr_250px]">
      <div className="min-w-0">
        <header className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <Orb size={44} state={cur?.status === "running" ? "working" : "idle"} />
            <div>
            <h1 className="text-[28px] font-semibold tracking-tight">{name}</h1>
            <p className="text-[13.5px] text-muted">
              {backend === "claude-code" ? "Running on the Claude Code app on this PC." : "Powered by the Claude API."} Money, accounts and messages as you always come to you first.
            </p>
            </div>
          </div>
          {cur && <Link href="/agent" className="btn"><Plus size={15} /> New</Link>}
        </header>
        <form action={setAutonomy} className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="label">How much can I decide?</span>
          <div className="flex rounded-xl border border-line bg-panel p-0.5">
            {[["ask", "Ask first"], ["balanced", "Balanced"], ["decide", "Decide for me"]].map(([v, l]) => (
              <button key={v} name="autonomy" value={v}
                className={`rounded-[9px] px-3 py-1.5 transition ${autonomy === v ? "bg-panel3 text-text shadow-[inset_0_0_0_1px_var(--line-2)]" : "text-muted hover:text-text"}`}>{l}</button>
            ))}
          </div>
        </form>
        <details className="card mb-4 !p-0 text-[13.5px]">
          <summary className="cursor-pointer list-none px-4 py-3 text-muted hover:text-text">
            {s.proactive ? <>Messages you first: morning brief at <b className="text-text">{s.brief_time}</b>, check-ins every <b className="text-text">{s.checkin_hours}h</b> until {s.quiet_start}</> : "Proactive messages are off"} · <span className="text-accent">change</span>
          </summary>
          <form action={saveAssistant} className="grid grid-cols-2 gap-3 border-t border-line p-4 md:grid-cols-5">
            <label className="space-y-1.5"><span className="label">Name</span><input name="assistant_name" defaultValue={name} maxLength={24} /></label>
            <label className="space-y-1.5"><span className="label">Morning brief</span><input name="brief_time" type="time" defaultValue={s.brief_time ?? "07:30"} /></label>
            <label className="space-y-1.5"><span className="label">Check in every (h)</span><input name="checkin_hours" type="number" min="0" max="12" defaultValue={s.checkin_hours ?? 3} /></label>
            <label className="space-y-1.5"><span className="label">Quiet from</span><input name="quiet_start" type="time" defaultValue={s.quiet_start ?? "21:30"} /></label>
            <label className="flex items-end gap-2 pb-2.5"><input type="checkbox" name="proactive" defaultChecked={!!s.proactive} className="!h-4 !w-4" /> Message me first</label>
            <button className="btn col-span-2 md:col-span-5">Save</button>
          </form>
        </details>
        {needsKey && (
          <div className="card mb-4 text-[13.5px] !border-[rgba(255,200,87,.35)]">
            Add <code className="text-warn">ANTHROPIC_API_KEY</code> in Vercel → manager → Settings → Environment Variables to switch the agent on.
          </div>
        )}
        <AgentConsole key={cur?.id ?? "new"} initialEvents={cur?.events ?? []} runId={cur?.id} goal={cur?.goal} running={cur?.status === "running"} ask={cur ? undefined : ask} name={name} />
      </div>

      <aside className="hidden lg:block">
        <div className="label mb-2">Recent</div>
        <ul className="space-y-1">
          {(runs ?? []).map((r: RunRow) => (
            <li key={r.id}>
              <Link href={`/agent?run=${r.id}`} className={`block rounded-xl px-3 py-2 transition hover:bg-panel2 ${r.id === cur?.id ? "bg-panel2" : ""}`}>
                <div className="flex items-center gap-1.5">
                  {r.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                  <div className={`truncate text-[13.5px] ${r.unread ? "font-semibold" : ""}`}>{r.kind && KIND_LABEL[r.kind] ? KIND_LABEL[r.kind] : r.goal}</div>
                </div>
                <div className="text-[11.5px] text-faint">{r.status} · {ago(r.created_at)}</div>
              </Link>
            </li>
          ))}
          {(runs ?? []).length === 0 && <li className="px-3 text-[13px] text-faint">No runs yet</li>}
        </ul>
      </aside>
    </div>
  );
}
