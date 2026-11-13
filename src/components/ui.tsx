import type { Signals } from "@/lib/types";

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

const statusColor: Record<string, string> = {
  active: "#4ade80", paused: "#facc15", idea: "#7c9cff", done: "#94a3b8", archived: "#475569",
};
export function StatusDot({ status }: { status: string }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: statusColor[status] ?? "#888" }} />;
}

export function SignalChips({ s }: { s?: Signals }) {
  if (!s) return null;
  const out: React.ReactNode[] = [];
  if (s.github && !s.github.error) {
    out.push(<span key="push" className="chip">pushed {ago(s.github.lastPushAt)}</span>);
    if (s.github.openPRs) out.push(<span key="pr" className="chip">{s.github.openPRs} PR</span>);
  }
  if (s.vercel?.state) {
    const bad = s.vercel.state === "ERROR";
    out.push(
      <span key="v" className="chip" style={bad ? { color: "#f87171", borderColor: "#7a2a33" } : undefined}>
        deploy {s.vercel.state.toLowerCase()}
      </span>,
    );
  }
  return out.length ? <div className="flex flex-wrap gap-1">{out}</div> : null;
}
