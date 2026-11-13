"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUp, Brain, Check, Globe, Loader2, ShieldCheck, Square, TriangleAlert, Volume2, Wrench } from "lucide-react";
import { speak, stopSpeaking } from "./speak";
import type { AgentEvent } from "@/lib/agent/run";
import { MicButton } from "./mic-button";
import { Orb } from "./orb";
import { Md } from "./md";

const SUGGESTIONS = [
  "Go see how my Day trader is going and find out what needs to be done.",
  "What should I focus on this week? Reprioritise my projects.",
  "Break the PunterIQ launch into tasks for the next 2 weeks.",
  "Plan my errands for tomorrow and add them as tasks.",
];

type Step =
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; label: string; done: boolean; isError?: boolean; approval?: boolean }
  | { kind: "search"; query: string }
  | { kind: "done"; text: string }
  | { kind: "error"; text: string };

function toSteps(events: AgentEvent[]): Step[] {
  const steps: Step[] = [];
  for (const e of events) {
    if (e.type === "thinking") steps.push({ kind: "thinking", text: e.text });
    else if (e.type === "text") steps.push({ kind: "text", text: e.text });
    else if (e.type === "search") steps.push({ kind: "search", query: e.query });
    else if (e.type === "tool" && e.name !== "ToolSearch") steps.push({ kind: "tool", id: e.id, label: e.label, done: false, approval: e.name === "request_approval" });
    else if (e.type === "tool_done") {
      const s = steps.find((x) => x.kind === "tool" && x.id === e.id) as Extract<Step, { kind: "tool" }> | undefined;
      if (s) { s.done = true; s.label = e.label; s.isError = e.isError; }
    } else if (e.type === "done") steps.push({ kind: "done", text: e.summary });
    else if (e.type === "error") steps.push({ kind: "error", text: e.message });
  }
  // each turn's final text is repeated in its "done" card; drop the duplicate
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  return steps.filter((s, i) => {
    if (s.kind !== "text") return true;
    const nextDone = steps.slice(i + 1).find((x) => x.kind === "done") as Extract<Step, { kind: "done" }> | undefined;
    return !(nextDone && norm(nextDone.text).includes(norm(s.text)));
  });
}

export function AgentConsole({ initialEvents, runId: initialRunId, goal: initialGoal, running, ask, voice, name = "MyManager" }: {
  initialEvents: AgentEvent[]; runId?: string; goal?: string; running?: boolean; ask?: string; voice?: boolean; name?: string;
}) {
  const [speaking, setSpeaking] = useState<number | null>(null);
  const say = (text: string, i: number) => { if (speak(text, () => setSpeaking(null))) setSpeaking(i); };
  const [events, setEvents] = useState<AgentEvent[]>(initialEvents);
  const [runId, setRunId] = useState(initialRunId);
  const [goal, setGoal] = useState(initialGoal);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setEvents(initialEvents); setRunId(initialRunId); setGoal(initialGoal); }, [initialRunId]);
  const newRun = useRef<string | null>(null);
  const asked = useRef(false);
  useEffect(() => {
    if (ask && !asked.current && !initialRunId) { asked.current = true; window.history.replaceState(null, "", "/agent"); void send(ask, voice); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [events.length]);

  async function send(text: string, spoken = false) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setInput("");
    if (!runId) { setGoal(text); setEvents([]); }
    try {
      const res = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal: text, runId }) });
      if (!res.ok || !res.body) throw new Error(await res.text());
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          const e = JSON.parse(l) as AgentEvent;
          if (e.type === "start") { if (!runId) newRun.current = e.runId; setRunId(e.runId); continue; }
          setEvents((prev) => [...prev, e]);
          if (spoken && e.type === "done") speak(e.summary);
        }
      }
    } catch (err) {
      setEvents((prev) => [...prev, { type: "error", message: String(err) }]);
    } finally {
      setBusy(false);
      if (newRun.current) { router.replace(`/agent?run=${newRun.current}`); newRun.current = null; }
      else router.refresh();
    }
  }

  const steps = toSteps(events);
  const empty = !goal && steps.length === 0;

  return (
    <div className="flex min-h-[70dvh] flex-col">
      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <div className="mb-4 hidden sm:block"><Orb size={64} /></div>
          <h2 className="text-[19px] font-semibold tracking-tight sm:text-[22px]">Hi, I&apos;m {name}. What can I do for you?</h2>
          <p className="mt-1 max-w-md text-[14px] text-muted">Ask a question or hand me a job. I plan it, do what I can (tasks, research, GitHub, decisions), and anything that costs money or acts as you goes to Approvals first.</p>
          <div className="mt-6 grid w-full max-w-2xl gap-2 sm:grid-cols-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="card card-hover !p-3 text-left text-[13.5px] text-muted hover:text-text">{s}</button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 space-y-3 pb-6">
          {goal && (
            <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-panel3 px-4 py-2.5 text-[14.5px]">{goal}</div>
          )}
          <ol className="relative space-y-2 border-l border-line pl-5">
            {steps.map((s, i) => (
              <li key={i} className="fade-in relative">
                <span className="absolute -left-[27px] top-1 grid h-[14px] w-[14px] place-items-center rounded-full border border-line2 bg-bg">
                  {s.kind === "tool" && !s.done ? <Loader2 size={9} className="animate-spin text-accent" /> : <span className={`h-1.5 w-1.5 rounded-full ${s.kind === "error" || (s.kind === "tool" && s.isError) ? "bg-bad" : s.kind === "done" ? "bg-good" : "bg-faint"}`} />}
                </span>
                {s.kind === "thinking" && (
                  <details className="group text-[13px] text-muted">
                    <summary className="flex cursor-pointer list-none items-center gap-1.5"><Brain size={13} /> Thinking <span className="text-faint group-open:hidden">· show</span></summary>
                    <div className="mt-1 whitespace-pre-wrap text-faint">{s.text}</div>
                  </details>
                )}
                {s.kind === "text" && (s.text.startsWith("↳ ")
                  ? <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-panel3 px-4 py-2.5 text-[14.5px]">{s.text.slice(2)}</div>
                  : <Md text={s.text} className="text-[14.5px] leading-relaxed" />)}
                {s.kind === "search" && <div className="flex items-center gap-1.5 text-[13px] text-muted"><Globe size={13} className="text-accent2" /> Searched the web for “{s.query}”</div>}
                {s.kind === "tool" && (
                  <div className={`flex items-center gap-1.5 text-[13px] ${s.isError ? "text-bad" : s.approval ? "text-warn" : "text-muted"}`}>
                    {s.approval ? <ShieldCheck size={13} /> : s.done ? <Check size={13} className="text-good" /> : <Wrench size={13} />}
                    {s.label}
                    {s.approval && s.done && !s.isError && <Link href="/approvals" className="ml-1 text-accent">review →</Link>}
                  </div>
                )}
                {s.kind === "done" && (
                  <div className="hero !p-4">
                    <Md text={s.text} className="text-[14.5px] leading-relaxed" />
                    <button type="button" onClick={() => (speaking === i ? (stopSpeaking(), setSpeaking(null)) : say(s.text, i))}
                      className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[12.5px] text-muted hover:text-text">
                      {speaking === i ? <><Square size={12} /> Stop</> : <><Volume2 size={14} /> Read aloud</>}
                    </button>
                  </div>
                )}
                {s.kind === "error" && <div className="flex items-start gap-1.5 text-[13.5px] text-bad"><TriangleAlert size={14} className="mt-0.5" />{s.text}</div>}
              </li>
            ))}
            {(busy || running) && (
              <li className="relative flex items-center gap-2 text-[13px] text-muted">
                <span className="absolute -left-[28px] top-0"><Orb size={16} state="working" /></span>
                {name} is working…
              </li>
            )}
          </ol>
          <div ref={bottom} />
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="sticky bottom-[84px] z-10 md:bottom-4">
        <div className="flex items-end gap-2 rounded-2xl border border-line2 bg-panel/95 p-2 shadow-2xl backdrop-blur-xl focus-within:border-accent">
          <textarea
            value={input} onChange={(e) => setInput(e.target.value)} rows={1}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder={goal ? "Follow up…" : "Ask anything…"}
            className="!max-h-40 !min-h-[44px] flex-1 resize-none !border-0 !bg-transparent !shadow-none"
          />
          <MicButton onText={setInput} onFinal={(t) => send(t, true)} />
          <button disabled={busy || !input.trim()} className="btn btn-primary !h-11 !w-11 !p-0 disabled:opacity-40" aria-label="Send">
            {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={18} />}
          </button>
        </div>
      </form>
    </div>
  );
}
