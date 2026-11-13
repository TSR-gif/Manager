"use client";
import { useEffect, useState } from "react";

export function FocusTimer({ startedAt, minutes }: { startedAt: string; minutes: number }) {
  const end = new Date(startedAt).getTime() + minutes * 60_000;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, end - now);
  const mm = Math.floor(left / 60_000);
  const ss = Math.floor((left % 60_000) / 1000);
  useEffect(() => {
    if (left === 0 && typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("Focus block done", { body: "Log what you got done, then take a break." });
    }
  }, [left]);
  return (
    <span className="btn font-mono tabular-nums" style={left === 0 ? { color: "#4ade80" } : undefined}>
      {left === 0 ? "Time's up" : `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`}
    </span>
  );
}
