"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Moon, Layers, Sun, Target } from "lucide-react";
import { Orb } from "./orb";
import { MicButton } from "./mic-button";

const RITUALS = [
  { icon: Sun, label: "Catch me up", prompt: "Catch me up. Lead with the one thing to do first and why, in one line. Then at most 5 things in order, and anything waiting for my OK. Don't count overdue tasks at me: fold them in or ask if I still want them. End with \"OK with this plan?\" Short enough to read on a phone." },
  { icon: Target, label: "Plan my day", prompt: "Plan my day. Pick at most 5 things I can actually finish today from my everyday tasks and top projects, in the order to do them, one line each. Then ask \"OK?\". Only when I reply OK, set those due today. Short enough to read on a phone." },
  { icon: Layers, label: "How's everything going?", prompt: "How's everything going? One line per project: what's running, what finished this week, what needs me. Lead with anything waiting on me. Put quiet projects together in one line at the end. Short enough to read on a phone." },
  { icon: Moon, label: "Wrap up my day", prompt: "Wrap up my day. Start with one line: how many things I finished today. Then list each unfinished task that was due today or earlier, numbered, and ask when I will do each one: tomorrow, a day I pick, or drop it. I can answer in one message like \"1 tomorrow, 2 Friday, 3 drop\". Don't move anything until I answer. Never make me feel bad about it. End with: Tomorrow starts with <the first thing>." },
];

/** "Ask anything" box on Today: hands the request straight to the assistant. */
export function AskBar({ name = "MyManager" }: { name?: string }) {
  const [q, setQ] = useState("");
  const router = useRouter();
  const go = (text: string, voice = false) => { if (text.trim()) router.push(`/agent?ask=${encodeURIComponent(text.trim())}${voice ? "&voice=1" : ""}`); };
  return (
    <div className="space-y-2">
    <form onSubmit={(e) => { e.preventDefault(); go(q); }}
      className="flex items-center gap-2 rounded-xl border border-line2 bg-[#0b0d12] p-1.5 transition focus-within:border-[rgba(56,189,248,.5)] focus-within:shadow-[0_0_0_3px_rgba(56,189,248,.1)]">
      <span className="ml-1.5"><Orb size={22} /></span>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Ask ${name} anything…`} aria-label={`Ask ${name}`}
        className="!h-10 flex-1 !border-0 !bg-transparent !px-1 !shadow-none text-[14.5px]" />
      <MicButton onText={setQ} onFinal={(t) => go(t, true)} />
      <button disabled={!q.trim()} className="btn btn-primary !h-10 !w-10 !p-0 disabled:opacity-30" aria-label="Ask"><ArrowUp size={18} /></button>
    </form>
    <div className="scrollbar-none flex gap-1.5 overflow-x-auto pb-0.5">
      {RITUALS.map((r) => (
        <button key={r.label} type="button" onClick={() => go(r.prompt)}
          className="chip shrink-0 cursor-pointer !rounded-lg !px-3 !py-1.5 text-[12.5px] transition hover:border-line2 hover:bg-panel2 hover:text-text">
          <r.icon size={13} /> {r.label}
        </button>
      ))}
    </div>
    </div>
  );
}
