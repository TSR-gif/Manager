import { HEALTH_TONE, type Health } from "@/lib/health";

/** Small traffic-light chip; hover shows why. */
export function HealthChip({ h, compact = false }: { h: Health; compact?: boolean }) {
  if (h.level === "idle") return null;
  const tone = HEALTH_TONE[h.level];
  return (
    <span className="chip shrink-0" title={h.reasons.join(" · ") || "Nothing needs you"}
      style={{ color: tone, borderColor: `color-mix(in srgb, ${tone} 35%, transparent)`, background: `color-mix(in srgb, ${tone} 9%, transparent)` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />
      {compact ? null : h.label}
    </span>
  );
}

/** 14-day bar sparkline of completed tasks. */
export function DoneBars({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex h-10 items-end gap-[3px]" aria-label="Tasks done per day, last 14 days">
      {data.map((d) => (
        <span key={d.date} title={`${d.date}: ${d.count} done`} className="flex-1 rounded-[3px]"
          style={{ height: `${Math.max(8, (d.count / max) * 100)}%`, background: d.count ? "var(--accent)" : "var(--line)" }} />
      ))}
    </div>
  );
}
