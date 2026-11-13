import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { AgentConsole } from "@/components/agent-console";
import { ago } from "@/components/ui";
import type { AgentEvent } from "@/lib/agent/run";

export const dynamic = "force-dynamic";

interface RunRow { id: string; goal: string; status: string; created_at: string; events?: AgentEvent[] }

export default async function AgentPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const { run } = await searchParams;
  const [{ data: runs }, current] = await Promise.all([
    db().from("agent_runs").select("id,goal,status,created_at").order("created_at", { ascending: false }).limit(30),
    run ? db().from("agent_runs").select("id,goal,status,created_at,events").eq("id", run).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const cur = current.data as RunRow | null;
  const hasKey = !!process.env.ANTHROPIC_API_KEY;

  return (
    <div className="fade-in grid gap-6 lg:grid-cols-[1fr_250px]">
      <div className="min-w-0">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">Agent</h1>
            <p className="text-[13.5px] text-muted">Powered by Claude. Risky steps always come to you first.</p>
          </div>
          {cur && <Link href="/agent" className="btn"><Plus size={15} /> New</Link>}
        </header>
        {!hasKey && (
          <div className="card mb-4 text-[13.5px] !border-[rgba(255,200,87,.35)]">
            Add <code className="text-warn">ANTHROPIC_API_KEY</code> in Vercel → manager → Settings → Environment Variables to switch the agent on.
          </div>
        )}
        <AgentConsole key={cur?.id ?? "new"} initialEvents={cur?.events ?? []} runId={cur?.id} goal={cur?.goal} running={cur?.status === "running"} />
      </div>

      <aside className="hidden lg:block">
        <div className="label mb-2">Recent</div>
        <ul className="space-y-1">
          {(runs ?? []).map((r: RunRow) => (
            <li key={r.id}>
              <Link href={`/agent?run=${r.id}`} className={`block rounded-xl px-3 py-2 transition hover:bg-panel2 ${r.id === cur?.id ? "bg-panel2" : ""}`}>
                <div className="truncate text-[13.5px]">{r.goal}</div>
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
