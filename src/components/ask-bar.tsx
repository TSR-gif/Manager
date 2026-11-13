"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp } from "lucide-react";
import { Orb } from "./orb";
import { MicButton } from "./mic-button";


/** "Ask anything" box on Today: hands the request straight to the assistant. */
export function AskBar({ name = "MyManager" }: { name?: string }) {
  const [q, setQ] = useState("");
  const router = useRouter();
  const go = (text: string, voice = false) => { if (text.trim()) router.push(`/agent?ask=${encodeURIComponent(text.trim())}${voice ? "&voice=1" : ""}`); };
  return (
    <div>
    <form onSubmit={(e) => { e.preventDefault(); go(q); }}
      className="askbox">
      <span className="ml-2"><Orb size={24} /></span>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Ask ${name} anything…`} aria-label={`Ask ${name}`}
        className="!h-11 flex-1 !px-1 text-[15.5px]" />
      <MicButton onText={setQ} onFinal={(t) => go(t, true)} />
      <button disabled={!q.trim()} className="btn btn-primary !h-11 !w-11 !p-0 disabled:opacity-30" aria-label="Ask"><ArrowUp size={18} /></button>
    </form>
    </div>
  );
}
