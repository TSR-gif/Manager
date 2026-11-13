"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp } from "lucide-react";

/** "Ask about this project" box: sends the question to the assistant with the project named. */
export function ProjectAsk({ name }: { name: string }) {
  const [q, setQ] = useState("");
  const router = useRouter();
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/agent?ask=${encodeURIComponent(`About ${name}: ${q.trim()}`)}`); }}
      className="askbox">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Ask or tell me anything about ${name}`} aria-label={`Ask about ${name}`}
        className="!h-11 flex-1 !px-2 text-[15px]" />
      <button disabled={!q.trim()} className="btn btn-primary !h-11 !w-11 !p-0 disabled:opacity-30" aria-label="Ask"><ArrowUp size={18} /></button>
    </form>
  );
}
