"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { chatApprovals, decideFromChat, type ChatApproval } from "@/app/actions";
import { useRouter } from "next/navigation";
import { ArrowUp, Brain, Check, Globe, Loader2, ShieldCheck, Square, TriangleAlert, Volume2, Wrench, X } from "lucide-react";
import { speak, stopSpeaking } from "./speak";
import type { AgentEvent } from "@/lib/agent/run";
import { MicButton } from "./mic-button";
import { Orb } from "./orb";
import { Md } from "./md";

const EMBED_SUGGESTIONS = [
  "What needs me today?",
  "How's everything going across my projects?",
  "Remind me to ",
];
const SUGGESTIONS = [
  "Go see how my Day trader is going and find out what needs to be done.",
  "How's everything going across my projects?",
  "Day trader is doing the backtest fix and the README. See it through and ask me if you need me.",
  "What should I code next on PunterIQ? Check the repo and list it.",
];

type Step =
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; label: string; done: boolean; isError?: boolean; approval?: boolean }
  | { kind: "search"; query: string }
  | { kind: "done"; text: string }
  | { kind: "error"; text: string }
  | { kind: "group"; items: Step[] };

/** Once a turn is finished, fold its working steps into one "what I did" line so the answer comes first. */
function foldSteps(steps: Step[], finished: boolean): Step[] {
  if (!finished) return steps;
  const out: Step[] = [];
  let buf: Step[] = [];
  for (const s of steps) {
    if (s.kind === "tool" || s.kind === "search" || s.kind === "thinking") { buf.push(s); continue; }
    if (s.kind === "done" && buf.length) out.push({ kind: "group", items: buf });
    else out.push(...buf);
    buf = [];
    out.push(s);
  }
  return [...out, ...buf];
}

/** Only offer "Yes, go ahead" when the answer really ends with a yes/no offer ("Want me to…?", "Shall I…?"). */
function yesNo(text: string) {
  const last = text.trim().split(/(?<=[.!?])\s+/).pop() ?? "";
  return /\?\s*$/.test(last) && /^(\*\*)?(want|shall|should|do you want|would you like|can i|could i|is it ok|ok to|happy for|are you happy|ready)\b/i.test(last.trim()) && !/\bor\b/i.test(last);
}

/** Answer first: the opening paragraph, with the rest behind "Show details" when it's long. */
function splitAnswer(text: string): [string, string] {
  const t = text.trim();
  const i = t.indexOf("\n\n");
  if (t.length < 450 || i < 0) return [t, ""];
  return [t.slice(0, i), t.slice(i + 2)];
}

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

/** `embedded` is the assistant bubble: it stays on the page he's on, takes asks through `incoming`, and reports back so the bubble can show it's busy or has an answer. */
export function AgentConsole({ initialEvents, runId: initialRunId, goal: initialGoal, running, ask, voice, name = "MyManager", embedded = false, inline = false, page, incoming, onRun, onBusy, onAnswer }: {
  initialEvents: AgentEvent[]; runId?: string; goal?: string; running?: boolean; ask?: string; voice?: boolean; name?: string;
  /** inline: part of a page (the Dashboard), which has its own ask box, so no box or welcome here */
  embedded?: boolean; inline?: boolean; page?: string; incoming?: { text: string; voice?: boolean; n: number }; onRun?: (id: string) => void; onBusy?: (busy: boolean) => void; onAnswer?: () => void;
}) {
  const [speaking, setSpeaking] = useState<number | null>(null);
  const say = (text: string, i: number) => { if (speak(text, () => setSpeaking(null))) setSpeaking(i); };
  const [events, setEvents] = useState<AgentEvent[]>(initialEvents);
  const [runId, setRunId] = useState(initialRunId);
  const [goal, setGoal] = useState(initialGoal);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const [asked2, setAsked] = useState(0); // bumps after each answer, so the OK cards below are looked up again
  const router = useRouter();

  // a different conversation was opened: show it. (Not on first mount: state already starts from the props, and
  // re-running it there would wipe an ask that's just been sent.)
  const shownRun = useRef(initialRunId);
  useEffect(() => {
    if (shownRun.current === initialRunId) return;
    shownRun.current = initialRunId;
    setEvents(initialEvents); setRunId(initialRunId); setGoal(initialGoal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRunId]);
  const newRun = useRef<string | null>(null);
  const asked = useRef(false);
  useEffect(() => {
    if (ask && !asked.current && !initialRunId && !embedded) { asked.current = true; window.history.replaceState(null, "", "/agent"); void send(ask, voice); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [events.length]);
  // an ask typed into a page's ask box, or a quick button, arrives here when the bubble is open
  const lastIncoming = useRef(0);
  useEffect(() => {
    if (incoming && incoming.n !== lastIncoming.current) { lastIncoming.current = incoming.n; void send(incoming.text, incoming.voice); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.n]);

  async function send(text: string, spoken = false) {
    if (!text.trim() || busy) return;
    setBusy(true);
    onBusy?.(true);
    setInput("");
    if (!runId) { setGoal(text); setEvents([]); }
    try {
      const res = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal: text, runId, page: page ?? window.location.pathname }) });
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
          if (e.type === "start") { if (!runId) newRun.current = e.runId; setRunId(e.runId); onRun?.(e.runId); continue; }
          setEvents((prev) => [...prev, e]);
          if (e.type === "done") onAnswer?.();
          if (spoken && e.type === "done") speak(e.summary);
        }
      }
    } catch (err) {
      setEvents((prev) => [...prev, { type: "error", message: String(err) }]);
    } finally {
      setBusy(false);
      onBusy?.(false);
      setAsked((n) => n + 1);
      if (embedded) { newRun.current = null; router.refresh(); } // stay on his page; refresh it in case the answer changed something here
      else if (newRun.current) { router.replace(`/agent?run=${newRun.current}`); newRun.current = null; }
      else router.refresh();
    }
  }

  const finished = !(busy || running);
  const steps = foldSteps(toSteps(events), finished);
  const lastDone = steps.map((x) => x.kind).lastIndexOf("done");
  const empty = !goal && steps.length === 0;
  if (inline && empty && !busy) return null;

  return (
    <div className={`flex flex-col ${embedded ? "min-h-full" : "min-h-[70dvh]"}`}>
      {empty ? (
        <div className={`flex flex-1 flex-col items-center justify-center text-center ${embedded ? "px-1 py-6" : "py-10"}`}>
          <div className={`mb-4 ${embedded ? "" : "hidden sm:block"}`}><Orb size={embedded ? 48 : 64} /></div>
          <h2 className="text-[19px] font-semibold tracking-tight sm:text-[22px]">Hi, I&apos;m {name}. What can I do for you?</h2>
          <p className="mt-1 max-w-md text-[14px] text-muted">Ask a question or hand me a job. I plan it, do what I can (tasks, research, GitHub, decisions), and ask for your OK, right here, before anything that costs money or acts as you.</p>
          <div className={`mt-6 grid w-full max-w-2xl gap-2 ${embedded ? "" : "sm:grid-cols-2"}`}>
            {(embedded ? EMBED_SUGGESTIONS : SUGGESTIONS).map((s) => (
              <button key={s} onClick={() => (s.endsWith(" ") ? setInput(s) : send(s))} className="card card-hover !p-3 text-left text-[13.5px] text-muted hover:text-text">{s}</button>
            ))}
          </div>
        </div>
      ) : (
        <div className={`flex-1 space-y-3 ${embedded ? "pb-4 pt-1" : "pb-28 md:pb-24"}`}>
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
                    {s.approval ? <ShieldCheck size={13} /> : s.done && s.isError ? <X size={13} className="text-bad" /> : s.done ? <Check size={13} className="text-good" /> : <Wrench size={13} />}
                    {s.label}
                    
                  </div>
                )}
                {s.kind === "group" && (
                  <details className="group text-[13px] text-muted">
                    <summary className="flex cursor-pointer list-none items-center gap-1.5">{s.items.some((x) => x.kind === "tool" && x.isError) && s.items.every((x) => x.kind !== "tool" || x.isError) ? <X size={13} className="text-bad" /> : <Check size={13} className="text-good" />} {s.items.filter((x) => x.kind !== "thinking").map((x) => (x.kind === "tool" ? x.label : x.kind === "search" ? "Searched the web" : "")).filter(Boolean).slice(0, 2).join(" · ") || "Worked it out"}{s.items.length > 2 ? ` +${s.items.length - 2}` : ""} <span className="text-faint group-open:hidden">· show</span></summary>
                    <ul className="mt-1.5 space-y-1 pl-5">
                      {s.items.map((x, j) => <li key={j} className={x.kind === "tool" && x.isError ? "text-bad" : ""}>{x.kind === "tool" ? x.label : x.kind === "search" ? `Searched the web for “${x.query}”` : "Thought it through"}</li>)}
                    </ul>
                  </details>
                )}
                {s.kind === "done" && (() => { const [lead, more] = splitAnswer(s.text); return (
                  <div className="hero !p-4">
                    <Md text={lead} className="text-[15px] leading-relaxed" />
                    {more && (
                      <details className="group mt-2">
                        <summary className="cursor-pointer list-none text-[13px] text-accent group-open:hidden">Show details</summary>
                        <Md text={more} className="text-[14.5px] leading-relaxed" />
                      </details>
                    )}
                    {i === lastDone && finished && yesNo(s.text) && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {["Yes, go ahead", "Not now"].map((q) => (
                          <button key={q} type="button" onClick={() => send(q)} className="btn !min-h-10 !px-4">{q}</button>
                        ))}
                      </div>
                    )}
                    <button type="button" onClick={() => (speaking === i ? (stopSpeaking(), setSpeaking(null)) : say(s.text, i))}
                      className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[12.5px] text-muted hover:text-text">
                      {speaking === i ? <><Square size={12} /> Stop</> : <><Volume2 size={14} /> Read aloud</>}
                    </button>
                  </div>
                ); })()}
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
          {runId && finished && <ChatOks runId={runId} n={asked2} />}
          <div ref={bottom} />
        </div>
      )}

      {!inline && <form onSubmit={(e) => { e.preventDefault(); send(input); }}
        className={`sticky z-10 ${embedded ? "bottom-0 bg-bg pb-3 pt-1" : "bottom-[84px] md:bottom-4"}`}>
        <div className={`flex items-end gap-2 rounded-2xl border border-line2 bg-panel/95 p-2 backdrop-blur-xl focus-within:border-accent ${embedded ? "shadow-sm" : "shadow-2xl"}`}>
          <textarea
            value={input} onChange={(e) => setInput(e.target.value)} rows={1}
            autoFocus={embedded && window.matchMedia("(min-width: 768px)").matches}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder={goal ? "Follow up…" : "Ask anything…"}
            className="!max-h-40 !min-h-[44px] flex-1 resize-none !border-0 !bg-transparent !shadow-none"
          />
          <MicButton onText={setInput} onFinal={(t) => send(t, true)} />
          <button disabled={busy || !input.trim()} className="btn btn-primary !h-11 !w-11 !p-0 disabled:opacity-40" aria-label="Send">
            {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={18} />}
          </button>
        </div>
      </form>}
    </div>
  );
}

/** The OK this chat is waiting on, right under the answer, so he never has to go and find it in Approvals. */
function ChatOks({ runId, n }: { runId: string; n: number }) {
  const [items, setItems] = useState<ChatApproval[]>([]);
  const [done, setDone] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  useEffect(() => { let on = true; chatApprovals(runId).then((x) => { if (on) setItems(x); }).catch(() => {}); return () => { on = false; }; }, [runId, n]);
  if (!items.length) return null;
  const decide = (id: string, ok: boolean) => start(async () => { await decideFromChat(id, ok); setDone((d) => ({ ...d, [id]: ok ? "Done. I'm on it." : "OK, I won't." })); });
  return (
    <div className="space-y-2">
      {items.map((a) => (
        <div key={a.id} className="dec !mb-0">
          <div className="dt"><b>{a.title}</b>{a.reason && <span>{a.reason}</span>}</div>
          {a.cost_cents > 0 && <div className="amt">${(a.cost_cents / 100).toFixed(2)}</div>}
          {done[a.id] ? <div className="text-[13.5px] text-muted">{done[a.id]}</div> : (
            <div className="da">
              <button disabled={pending} onClick={() => decide(a.id, true)} className="btn btn-primary">{a.cost_cents > 0 ? "Approve and pay" : "OK, do it"}</button>
              <button disabled={pending} onClick={() => decide(a.id, false)} className="btn">Not now</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
