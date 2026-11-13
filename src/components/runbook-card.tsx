import Link from "next/link";
import { CheckCircle2, CircleDashed, CircleX, Hand, Loader2, MonitorCog, Square } from "lucide-react";
import { runbookStepDone, runbookStop } from "@/app/actions";
import { ago } from "@/components/ui";
import type { Runbook, Step } from "@/lib/runbooks";

const STATUS: Record<Runbook["status"], { t: string; c: string }> = {
  draft: { t: "Draft", c: "" }, queued: { t: "Waiting for your OK", c: "chip-warn" }, running: { t: "Running", c: "chip-accent" },
  waiting: { t: "Needs you", c: "chip-warn" }, done: { t: "Done", c: "chip-good" }, stopped: { t: "Stopped", c: "" }, failed: { t: "Finished with problems", c: "chip-bad" },
};

function Icon({ s }: { s: Step }) {
  if (s.status === "done") return <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-good" />;
  if (s.status === "failed") return <CircleX size={15} className="mt-0.5 shrink-0 text-bad" />;
  if (s.status === "running") return <Loader2 size={15} className="mt-0.5 shrink-0 animate-spin text-accent" />;
  if (s.status === "waiting") return <Hand size={15} className="mt-0.5 shrink-0 text-warn" />;
  if (s.status === "skipped") return <CircleDashed size={15} className="mt-0.5 shrink-0 text-faint" />;
  return <span className="mt-[3px] h-[13px] w-[13px] shrink-0 rounded-full border border-line2" />;
}

export function RunbookCard({ r, project, tails }: { r: Runbook; project: string; tails: Record<string, string> }) {
  const st = STATUS[r.status] ?? STATUS.draft;
  const list = r.steps.list;
  const done = list.filter((s) => ["done", "skipped"].includes(s.status)).length;
  const live = r.status === "running" || r.status === "waiting";
  return (
    <li className={`card space-y-3 ${r.status === "waiting" ? "card-alert" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <MonitorCog size={15} className="text-accent2" />
        <span className="text-[13px] font-medium text-muted">{project}</span>
        <span className={`chip ${st.c}`}>{st.t}</span>
        <span className="ml-auto text-[12px] text-faint">{r.started_at ? `started ${ago(r.started_at)}` : `planned ${ago(r.created_at)}`}</span>
      </div>
      <div className="text-[16px] font-semibold leading-snug">{r.title}</div>
      {r.last_update && <div className="text-[13.5px] text-muted"><b className="font-medium text-text">Where it&apos;s at: </b>{r.last_update}</div>}
      <div className="flex items-center gap-2 text-[12px] text-faint">
        <div className="bar flex-1"><i style={{ width: `${Math.round((done / Math.max(1, list.length)) * 100)}%` }} /></div>
        {done} of {list.length} steps
      </div>
      <ol className="space-y-2 text-[13.5px]">
        {list.map((s) => (
          <li key={s.id} className="flex items-start gap-2">
            <Icon s={s} />
            <div className="min-w-0 flex-1">
              <div className={s.status === "skipped" ? "text-faint line-through" : ""}>{s.label}{s.optional && <span className="text-faint"> (optional)</span>}</div>
              {s.note && <div className="text-[12.5px] text-muted">{s.note}</div>}
              {s.kind === "start_job" && s.status === "running" && tails[s.id] && (
                <pre className="mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-panel3 p-2 font-mono text-[11.5px] text-muted">{tails[s.id]}</pre>
              )}
              {s.status === "waiting" && !s.approval_id && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <form action={runbookStepDone}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="step" value={s.id} /><button className="btn btn-primary !min-h-9 !px-3 !text-[13px]">{s.kind === "handoff" ? "Done" : "Fixed it, try again"}</button></form>
                  <form action={runbookStepDone}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="step" value={s.id} /><input type="hidden" name="outcome" value="skipped" /><button className="btn !min-h-9 !px-3 !text-[13px]">{s.kind === "handoff" ? "Not needed" : "Skip this step"}</button></form>
                </div>
              )}
              {s.status === "waiting" && s.approval_id && <Link href="/approvals" className="mt-1 inline-block text-[13px] text-accent">Waiting for your OK in Approvals →</Link>}
            </div>
          </li>
        ))}
      </ol>
      {r.status === "queued" && <Link href="/approvals" className="btn btn-sm w-fit">Review in Approvals</Link>}
      {live && (
        <form action={runbookStop}><input type="hidden" name="id" value={r.id} /><button className="btn btn-sm"><Square size={13} /> Stop the remaining steps</button></form>
      )}
    </li>
  );
}
