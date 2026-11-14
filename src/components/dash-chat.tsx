"use client";
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { ASK_EVENT, type AskDetail } from "./assistant-bubble";
import { AgentConsole } from "./agent-console";

/**
 * The Dashboard's own chat: asking in the Dashboard's box answers right here on the page (the bubble stays out of
 * the way on the Dashboard). The conversation shows above the box; "New chat" starts over.
 */
export function DashChat({ name = "MyManager" }: { name?: string }) {
  const [incoming, setIncoming] = useState<{ text: string; voice?: boolean; n: number }>();
  const [chat, setChat] = useState(0);
  const [has, setHas] = useState(false);
  const box = useRef<HTMLElement>(null);
  // the answer comes in here, under the cards: bring it into view as soon as he asks
  useEffect(() => { if (incoming) box.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [incoming]);
  useEffect(() => {
    const onAsk = (e: Event) => {
      const d = (e as CustomEvent<AskDetail>).detail;
      if (!d?.text?.trim()) return;
      e.preventDefault();
      setHas(true);
      setIncoming((p) => ({ text: d.text, voice: d.voice, n: (p?.n ?? 0) + 1 }));
    };
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, []);
  return (
    <section ref={box} className={has ? "dashchat" : ""} aria-live="polite">
      {has && (
        <div className="mb-1 flex items-center">
          <div className="sec !m-0 flex-1">Chat</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setChat((c) => c + 1); setHas(false); setIncoming(undefined); }}><Plus size={14} /> New chat</button>
        </div>
      )}
      <AgentConsole key={chat} initialEvents={[]} name={name} embedded inline page="/" incoming={incoming} />
    </section>
  );
}
