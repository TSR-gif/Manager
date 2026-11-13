"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Mic } from "lucide-react";
import { ASK_EVENT, type AskDetail } from "./assistant-bubble";

const QUICK: [string, string][] = [
  ["☀️ Plan my day", "Plan my day"],
  ["🛒 Do the groceries", "Do the groceries"],
  ["💻 Check my projects", "Check on all my projects and tell me what needs me"],
  ["🧾 Pay a bill", "Pay a bill"],
  ["📅 Remind me…", "Remind me to "],
];

type Rec = { start(): void; stop(): void; lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null };

/** The ask box: type or talk to MyManager like a person. Everything goes to the assistant, which asks before paying, sending or deleting. */
export function AskBar({ name = "MyManager", placeholder, about, quick = false }: { name?: string; placeholder?: string; about?: string; quick?: boolean }) {
  const [q, setQ] = useState("");
  const [listening, setListening] = useState(false);
  const [canTalk, setCanTalk] = useState(false);
  const rec = useRef<Rec | null>(null);
  const said = useRef("");
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const go = (text: string, voice = false) => {
    const t = text.trim();
    if (!t) return;
    const text2 = about ? `About ${about}: ${t}` : t;
    // the assistant bubble answers it right here; without one, go to the chat page
    const handled = !window.dispatchEvent(new CustomEvent<AskDetail>(ASK_EVENT, { detail: { text: text2, voice }, cancelable: true }));
    if (handled) { setQ(""); return; }
    router.push(`/agent?ask=${encodeURIComponent(about ? `About ${about}: ${t}` : t)}${voice ? "&voice=1" : ""}`);
  };
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setCanTalk(!!(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);
  function talk() {
    if (listening) { rec.current?.stop(); return; }
    const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const R = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!R) return;
    const r = new R();
    r.lang = "en-AU"; r.interimResults = true; r.continuous = false;
    r.onresult = (e) => { said.current = Array.from(e.results).map((x) => x[0].transcript).join(""); setQ(said.current); };
    r.onend = () => { setListening(false); if (said.current.trim()) go(said.current, true); said.current = ""; };
    r.onerror = () => setListening(false);
    rec.current = r; r.start(); setListening(true);
  }
  return (
    <div className="comp">
      <form onSubmit={(e) => { e.preventDefault(); go(q); }} className="box">
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder ?? `Ask ${name} anything`} aria-label={placeholder ?? `Ask ${name}`} />
        {canTalk && <button type="button" onClick={talk} className={`mic ${listening ? "on animate-pulse" : ""}`} aria-label={listening ? "Stop listening" : "Talk"}><Mic size={18} strokeWidth={1.7} /></button>}
        <button className="send" disabled={!q.trim()} aria-label="Send"><ArrowUp size={18} strokeWidth={2} /></button>
      </form>
      {quick && (
        <>
          <div className="qk">
            {QUICK.map(([label, text]) => (
              <button key={label} type="button" onClick={() => (text.endsWith(" ") ? (setQ(text), input.current?.focus()) : go(text))}>{label}</button>
            ))}
          </div>
          <div className="hint">Nothing gets paid, sent or deleted without your OK.</div>
        </>
      )}
    </div>
  );
}
