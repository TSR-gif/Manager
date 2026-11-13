"use client";
import { useEffect, useState } from "react";

/** Circular countdown for the active focus block. */
export function FocusTimer({ startedAt, minutes, size = 148 }: { startedAt: string; minutes: number; size?: number }) {
  const start = new Date(startedAt).getTime();
  const total = minutes * 60_000;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, start + total - now);
  const pct = 1 - left / total;
  const mm = Math.floor(left / 60_000);
  const ss = Math.floor((left % 60_000) / 1000);
  useEffect(() => {
    if (left === 0 && typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("Focus block done", { body: "Log what you got done, then take a break." });
    }
  }, [left]);
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="fg" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" /><stop offset="100%" stopColor="#818cf8" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line)" strokeWidth="7" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke="url(#fg)" strokeWidth="7" fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: "stroke-dashoffset 1s linear" }} />
      </svg>
      <div className="absolute text-center">
        <div className="font-mono text-[28px] font-semibold tabular-nums tracking-tight">
          {left === 0 ? "Done" : `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`}
        </div>
        <div className="text-[11px] text-muted">{left === 0 ? "take a break" : "focus left"}</div>
      </div>
    </div>
  );
}
