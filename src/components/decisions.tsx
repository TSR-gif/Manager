import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { answerMissionForm, decideAction, runbookStepDone, undoActivity } from "@/app/actions";
import { approveLabel, helperLook, kindLook } from "@/lib/helper-look";
import type { Ask, Done, WaitingStep, Work } from "@/lib/today";
import type { Action } from "@/lib/types";

type Name = (id: string | null) => string | undefined;
const look = (name: string | undefined, kind = "") => (name ? helperLook(name) : kindLook(kind));
const dollars = (c: number) => `$${(c / 100).toLocaleString("en-AU", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

function Tile({ l, sm }: { l: { emoji: string; bg: string }; sm?: boolean }) {
  return <div className={`tile ${sm ? "sm" : ""}`} style={{ background: l.bg }}>{l.emoji}</div>;
}

/** "Needs you": one line per decision, with the question, the amount and the buttons. */
export function Decisions({ approvals, asks, steps, name, max = 99, hideTile }: { approvals: Action[]; asks: Ask[]; steps: WaitingStep[]; name: Name; max?: number; hideTile?: boolean }) {
  let left = max;
  const take = <T,>(xs: T[]) => { const out = xs.slice(0, Math.max(0, left)); left -= out.length; return out; };
  const qs = take(asks), ss = take(steps), as = take(approvals);
  const hidden = asks.length + steps.length + approvals.length - qs.length - ss.length - as.length;
  return (
    <>
      {qs.map((m) => (
        <div key={m.id} className="dec">
          {!hideTile && <Tile l={look(name(m.project_id))} />}
          <div className="dt"><b>{m.question}</b><span>{[name(m.project_id), m.goal].filter(Boolean).join(" · ")}</span></div>
          <form action={answerMissionForm} className="ans">
            <input type="hidden" name="id" value={m.id} />
            <input name="answer" placeholder="Your answer" required autoComplete="off" />
            <button className="btn btn-primary">Send</button>
          </form>
        </div>
      ))}
      {ss.map((s) => (
        <div key={s.runbookId + s.stepId} className="dec">
          {!hideTile && <Tile l={look(name(s.project_id), "runbook")} />}
          <div className="dt"><b>{s.label}</b><span>{s.note && s.handoff ? s.note : [name(s.project_id), s.runbook, s.handoff ? "your turn" : "this step didn't work"].filter(Boolean).join(" · ")}</span></div>
          <div className="da">
            {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="btn btn-primary">Open sign-in</a>}
            <form action={runbookStepDone}><input type="hidden" name="id" value={s.runbookId} /><input type="hidden" name="step" value={s.stepId} /><button className={`btn ${s.url ? "" : "btn-primary"}`}>{s.handoff ? "Done" : "Try again"}</button></form>
            <form action={runbookStepDone}><input type="hidden" name="id" value={s.runbookId} /><input type="hidden" name="step" value={s.stepId} /><input type="hidden" name="outcome" value="skipped" /><button className="btn">{s.handoff ? "Not needed" : "Skip"}</button></form>
          </div>
        </div>
      ))}
      {as.map((a) => (
        <div key={a.id} className="dec">
          {!hideTile && <Tile l={look(name(a.project_id), a.kind)} />}
          <div className="dt"><b>{a.title}</b><span>{[name(a.project_id), a.reason].filter(Boolean).join(" · ") || "Waiting for your OK"}</span></div>
          {a.cost_cents > 0 && <div className="amt">{dollars(a.cost_cents)}</div>}
          <div className="da">
            <form action={decideAction.bind(null, a.id, true)}><button className="btn btn-primary">{approveLabel(a.kind, a.cost_cents)}</button></form>
            <form action={decideAction.bind(null, a.id, false)}><button className="btn">Not now</button></form>
          </div>
        </div>
      ))}
      {hidden > 0 && <Link href="/approvals" className="mt-1 inline-block text-[13.5px] font-medium">See {hidden} more →</Link>}
    </>
  );
}

/** "Working on": what MyManager is doing, with progress. */
export function WorkingOn({ work, name }: { work: Work[]; name: Name }) {
  return (
    <>
      {work.map((w) => (
        <Link key={w.key} href={w.href} className="wk">
          <Tile l={look(name(w.project_id), w.kind === "runbook" ? "runbook" : "mission")} sm />
          <div className="dt"><b className="truncate">{w.title}</b><span>{w.sub}</span></div>
          <div className={`pb ${w.pct == null ? "spin" : ""}`}><i style={w.pct == null ? undefined : { width: `${Math.max(6, Math.round(w.pct * 100))}%` }} /></div>
        </Link>
      ))}
    </>
  );
}

/** "Done for you": one line, with every item and its Undo behind it. */
export function DoneForYou({ done }: { done: Done[] }) {
  const kept = done.filter((d) => !d.undone);
  if (!done.length) return null;
  const first = kept.slice(0, 2).map((d) => d.title[0].toLowerCase() + d.title.slice(1));
  return (
    <details className="donefor group block">
      <summary className="flex cursor-pointer list-none items-start gap-2.5">
        <CheckCircle2 size={17} className="mt-px shrink-0 text-[#1a9b5c]" />
        <span className="flex-1"><b>Done for you:</b> {first.join(", ")}{kept.length > 2 ? `, and ${kept.length - 2} more` : ""}</span>
        <span className="hidden font-medium text-text md:inline group-open:hidden">See all</span>
      </summary>
      <ul className="mt-2 pl-7">
        {done.map((d) => (
          <li key={d.id} className="flex min-h-9 items-center gap-2 border-b border-line text-[13.5px] last:border-0">
            <span className={`min-w-0 flex-1 truncate ${d.undone ? "text-faint line-through" : ""}`}>{d.title}</span>
            {!!d.undo && !d.undone && <form action={undoActivity}><input type="hidden" name="id" value={d.id} /><button className="btn btn-ghost btn-sm">Undo</button></form>}
          </li>
        ))}
      </ul>
    </details>
  );
}
