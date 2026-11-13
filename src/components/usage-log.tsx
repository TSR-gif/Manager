"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { logUsage } from "@/app/actions";

/**
 * Private usage log: which screens Thomas opens and for how long, so MyManager can suggest
 * changes in the weekly review ("you never open Money on your phone"). Stays in his own database.
 */
export function UsageLog() {
  const path = usePathname();
  const start = useRef(Date.now());
  const current = useRef(path);

  useEffect(() => {
    const device = window.matchMedia("(max-width: 767px)").matches ? "phone" : "desktop";
    const flush = () => {
      const secs = (Date.now() - start.current) / 1000;
      if (secs >= 1) void logUsage(current.current, secs, device).catch(() => {});
      start.current = Date.now();
    };
    if (current.current !== path) { flush(); current.current = path; }
    const onHide = () => { if (document.visibilityState === "hidden") flush(); else start.current = Date.now(); };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [path]);
  return null;
}
