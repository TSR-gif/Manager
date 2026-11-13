import { Check, GitBranch, GitPullRequest, Rocket, TriangleAlert } from "lucide-react";
import type { Signals } from "@/lib/types";

export const TZ = "Australia/Melbourne";

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return `${Math.floor(s / (86400 * 30))}mo ago`;
}

/** YYYY-MM-DD in Melbourne for "today". */
export function todayISO(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

export function dueInfo(due: string | null): { text: string; tone: "bad" | "warn" | "muted" } | null {
  if (!due) return null;
  const d = due.slice(0, 10);
  const today = todayISO();
  const diff = Math.round((new Date(d).getTime() - new Date(today).getTime()) / 86_400_000);
  // No guilt: a missed date reads as "from Tue", not a red "5d overdue". The evening wrap-up asks if it's still wanted.
  if (diff < 0) return { text: diff === -1 ? "From yesterday" : `From ${new Date(d).toLocaleDateString("en-AU", diff > -7 ? { weekday: "short" } : { day: "numeric", month: "short" })}`, tone: "warn" };
  if (diff === 0) return { text: "Today", tone: "warn" };
  if (diff === 1) return { text: "Tomorrow", tone: "muted" };
  if (diff < 7) return { text: new Date(d).toLocaleDateString("en-AU", { weekday: "short" }), tone: "muted" };
  return { text: new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short" }), tone: "muted" };
}

export function money(cents: number) {
  return `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function hue(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
export function projectColor(name: string) {
  return `hsl(${hue(name)} 75% 66%)`;
}

export function ProjectAvatar({ name, size = 36 }: { name: string; size?: number }) {
  const h = hue(name);
  const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <span
      className="inline-grid shrink-0 place-items-center font-bold"
      style={{
        width: size, height: size, borderRadius: size * 0.3, fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${h} 70% 30%), hsl(${(h + 40) % 360} 70% 22%))`,
        color: `hsl(${h} 90% 85%)`, border: `1px solid hsl(${h} 60% 40% / .5)`,
      }}
    >
      {initials}
    </span>
  );
}

const statusTone: Record<string, string> = {
  active: "var(--good)", paused: "var(--warn)", idea: "var(--accent)", done: "var(--muted)", archived: "var(--faint)",
};
export function StatusDot({ status }: { status: string }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {status === "active" && <span className="absolute inset-0 animate-ping rounded-full opacity-40" style={{ background: statusTone[status] }} />}
      <span className="relative h-2 w-2 rounded-full" style={{ background: statusTone[status] ?? "#888" }} />
    </span>
  );
}

export function PriorityBadge({ p }: { p: number }) {
  const cls = p === 1 ? "chip-bad" : p === 2 ? "chip-warn" : p === 3 ? "chip-accent" : "";
  return <span className={`chip ${cls}`}>{priorityLabel(p)}</span>;
}

/** Plain words instead of P1–P5. */
export const priorityLabel = (p: number) => (p === 1 ? "Top priority" : p === 2 ? "High" : p === 3 ? "Normal" : p === 4 ? "Low" : "Someday");

export function SignalChips({ s }: { s?: Signals }) {
  if (!s) return null;
  const out: React.ReactNode[] = [];
  if (s.github && !s.github.error) {
    out.push(<span key="push" className="chip"><GitBranch size={11} />{ago(s.github.lastPushAt)}</span>);
    if (s.github.openPRs) out.push(<span key="pr" className="chip chip-accent"><GitPullRequest size={11} />{s.github.openPRs} PR</span>);
  }
  if (s.vercel?.state) {
    const st = s.vercel.state;
    const cls = st === "ERROR" ? "chip-bad" : st === "READY" ? "chip-good" : "chip-warn";
    out.push(
      <span key="v" className={`chip ${cls}`}>
        {st === "ERROR" ? <TriangleAlert size={11} /> : <Rocket size={11} />}
        {st === "READY" ? "live" : st.toLowerCase()}
      </span>,
    );
  }
  return out.length ? <div className="flex flex-wrap gap-1">{out}</div> : null;
}

export function CheckIcon() {
  return <Check size={12} strokeWidth={3.5} />;
}

export function Empty({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-6 text-center">
      <div className="mb-1 grid h-10 w-10 place-items-center rounded-xl bg-panel2 text-muted">{icon}</div>
      <div className="text-sm font-medium">{title}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}
