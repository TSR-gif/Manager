"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Sparkles } from "lucide-react";
import { MicButton } from "./mic-button";

/** "Ask anything" box on Today: hands the request straight to the assistant. */
export function AskBar() {
  const [q, setQ] = useState("");
  const router = useRouter();
  const go = (text: string) => { if (text.trim()) router.push(`/agent?ask=${encodeURIComponent(text.trim())}`); };
  return (
    <form onSubmit={(e) => { e.preventDefault(); go(q); }}
      className="flex items-center gap-2 rounded-2xl border border-line2 bg-panel/90 p-2 shadow-[0_20px_50px_-25px_rgba(139,123,255,.6)] focus-within:border-accent">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#9a8bff] to-[#5ec8ff]"><Sparkles size={16} className="text-white" /></span>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask me anything…"
        className="!h-11 flex-1 !border-0 !bg-transparent !shadow-none text-[15px]" />
      <MicButton onText={setQ} onFinal={go} />
      <button disabled={!q.trim()} className="btn btn-primary !h-11 !w-11 !p-0 disabled:opacity-40" aria-label="Ask"><ArrowUp size={18} /></button>
    </form>
  );
}
