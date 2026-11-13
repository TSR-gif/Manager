"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Moon, Sparkles, Sun, Target } from "lucide-react";
import { MicButton } from "./mic-button";

const RITUALS = [
  { icon: Sun, label: "Morning brief", prompt: "Give me my morning brief: what's due or overdue today, the one project I should work on and why, anything waiting for my approval, and anything stale. Then suggest a realistic plan for today (max 5 things) and add any missing tasks." },
  { icon: Target, label: "Plan my day", prompt: "Plan my day. Look at my everyday tasks and top projects, pick a finite list I can actually finish today, set due dates to today for those, and tell me the order to do them in." },
  { icon: Moon, label: "Shutdown", prompt: "Run my end-of-day shutdown: what did I finish today, what carried over, move unfinished today items to tomorrow, and tell me the first thing to do tomorrow morning." },
];

/** "Ask anything" box on Today: hands the request straight to the assistant. */
export function AskBar() {
  const [q, setQ] = useState("");
  const router = useRouter();
  const go = (text: string) => { if (text.trim()) router.push(`/agent?ask=${encodeURIComponent(text.trim())}`); };
  return (
    <div className="space-y-2">
    <form onSubmit={(e) => { e.preventDefault(); go(q); }}
      className="flex items-center gap-2 rounded-2xl border border-line2 bg-panel/90 p-2 shadow-[0_20px_50px_-25px_rgba(139,123,255,.6)] focus-within:border-accent">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#9a8bff] to-[#5ec8ff]"><Sparkles size={16} className="text-white" /></span>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask me anything…"
        className="!h-11 flex-1 !border-0 !bg-transparent !shadow-none text-[15px]" />
      <MicButton onText={setQ} onFinal={go} />
      <button disabled={!q.trim()} className="btn btn-primary !h-11 !w-11 !p-0 disabled:opacity-40" aria-label="Ask"><ArrowUp size={18} /></button>
    </form>
    <div className="flex gap-2 overflow-x-auto pb-0.5">
      {RITUALS.map((r) => (
        <button key={r.label} type="button" onClick={() => go(r.prompt)}
          className="chip shrink-0 cursor-pointer !px-3 !py-1.5 text-[12.5px] transition hover:border-accent hover:text-text">
          <r.icon size={13} /> {r.label}
        </button>
      ))}
    </div>
    </div>
  );
}
