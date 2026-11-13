"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-reads the page every few seconds while something is running, only while the tab is in front, and never while he's typing. */
export function AutoRefresh({ every = 8 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return; // don't move things while he's typing
      router.refresh();
    };
    const t = setInterval(tick, every * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [router, every]);
  return null;
}
