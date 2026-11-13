"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";

type Rec = { start(): void; stop(): void; lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null };

/** Voice input via the browser's built-in speech recognition (Chrome, Edge, Safari, Android). */
export function MicButton({ onText, onFinal, className = "" }: { onText: (t: string) => void; onFinal?: (t: string) => void; className?: string }) {
  const [on, setOn] = useState(false);
  const [ok, setOk] = useState(false);
  const rec = useRef<Rec | null>(null);
  const last = useRef("");

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    setOk(!!(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);

  function toggle() {
    if (on) { rec.current?.stop(); return; }
    const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const R = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!R) return;
    const r = new R();
    r.lang = "en-AU";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      const t = Array.from(e.results).map((x) => x[0].transcript).join("");
      last.current = t;
      onText(t);
    };
    r.onend = () => { setOn(false); if (last.current.trim()) onFinal?.(last.current); last.current = ""; };
    r.onerror = () => setOn(false);
    rec.current = r;
    r.start();
    setOn(true);
  }

  if (!ok) return null;
  return (
    <button type="button" onClick={toggle} aria-label={on ? "Stop listening" : "Speak"}
      className={`btn !h-11 !w-11 !p-0 ${on ? "!border-bad !text-bad animate-pulse" : ""} ${className}`}>
      {on ? <MicOff size={18} /> : <Mic size={18} />}
    </button>
  );
}
