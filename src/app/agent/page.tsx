import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { Orb } from "@/components/orb";
import { agentBackend } from "@/lib/agent/run";
import { getSettings } from "@/lib/queries";
import { AgentConsole } from "@/components/agent-console";
import { ago } from "@/components/ui";
import type { AgentEvent } from "@/lib/agent/run";

export const dynamic = "force-dynamic";

interface RunRow { id: string; goal: string; status: string; created_at: string; kind?: string; unread?: boolean; events?: AgentEvent[] }

const KIND_LABEL: Record<string, string> = { brief: "Morning catch-up", checkin: "Check-in" };
const AUTONOMY_LABEL: Record<string, string> = { ask: "Asks you first", balanced: "Does small things itself", decide: "Decides for you" };

export default async function AgentPage({ searchParams }: { searchParams: Promise<{ run?: string; ask?: string; voice?: string }> }) {
  const { run, ask, voice } = await searchParams;
  const [{ data: runs }, current, settings] = await Promise.all([
    db().from("agent_runs").select("id,goal,status,created_at,kind,unread").order("created_at", { ascending: false }).limit(30),
    run ? db().from("agent_runs").select("id,goal,status,created_at,events").eq("id", run).maybeSingle() : Promise.resolve({ data: null }),
    getSettings(),
  ]);
  const autonomy = (settings as { autonomy?: string }).autonomy ?? "balanced";
  const cur = current.data as RunRow | null;
  if (cur && (runs ?? []).find((r: RunRow) => r.id === cur.id)?.unread) await db().from("agent_runs").update({ unread: false }).eq("id", cur.id);
  const s = settings as unknown as { assistant_name?: string; proactive?: boolean; brief_time?: string; checkin_hours?: number; quiet_start?: string };
  const name = s.assistant_name || "MyManager";
  const backend = agentBackend();
  const needsKey = backend === "api" && !process.env.ANTHROPIC_API_KEY;

  return (
    <div className="fade-in grid gap-6 lg:grid-cols-[1fr_250px]">
      <div className="min-w-0">
        <header className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <Orb size={40} state={cur?.status === "running" ? "working" : "idle"} />
            <div>
            <h1 className="text-[28px] font-semibold tracking-tight">{name}</h1>
            <p className="text-[13.5px] text-muted">
              Your assistant. Ask it anything, or tell it what to do.
            </p>
            </div>
          </div>
          {cur && <Link href="/agent" className="btn"><Plus size={15} /> New</Link>}
        </header>
        <Link href="/settings" className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted hover:text-text">
          <span className="chip">{AUTONOMY_LABEL[autonomy] ?? "Balanced"}</span>
          <span>{!s.proactive ? "Only replies when you ask" : (s as { message_mode?: string }).message_mode === "needed" ? "Messages you only when needed" : (s as { message_mode?: string }).message_mode === "more" ? "Catch-up and check-ins" : `Morning catch-up at ${s.brief_time ?? "07:30"}`}</span>
          <span className="text-accent">Change</span>
        </Link>
        {needsKey && (
          <div className="card mb-4 text-[13.5px] !border-[rgba(255,200,87,.35)]">
            The assistant isn&apos;t switched on in this online copy yet. Use MyManager on your PC for now.
          </div>
        )}
        <AgentConsole key={cur?.id ?? "new"} initialEvents={cur?.events ?? []} runId={cur?.id} goal={cur?.goal} running={cur?.status === "running"} ask={cur ? undefined : ask} voice={voice === "1"} name={name} />
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
                <div className="text-[11.5px] text-faint">{r.status === "running" ? "working… · " : r.status === "failed" ? "didn&apos;t finish · " : r.status === "stopped" ? "stopped · " : ""}{ago(r.created_at)}</div>
              </Link>
            </li>
          ))}
          {(runs ?? []).length === 0 && <li className="px-3 text-[13px] text-faint">Nothing yet</li>}
        </ul>
      </aside>
    </div>
  );
}
