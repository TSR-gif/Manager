// What a runbook does next, worked out from its steps alone (plain JS so tests/security.test.mjs can check it).
// Steps run in order and each waits for the ones before it:
//  - a step waiting on Thomas (a hand-over, an OK, a failure he has to look at) holds everything after it;
//  - a required step that failed holds everything after it (he can try it again, skip it, or stop);
//  - a job that's still running holds the next step, unless that job was marked independent.

const isJob = (s) => s.kind === "start_job" || s.kind === "watch_process";

/** @returns {{ do: "wait_you" | "hold_failed" | "wait_job" | "run" | "watch" | "finish", step?: object }} */
export function nextMove(list) {
  const waiting = list.find((s) => s.status === "waiting" && s.blocking !== false);
  if (waiting) return { do: "wait_you", step: waiting };
  const i = list.findIndex((s) => s.status === "todo");
  if (i === -1) {
    const job = list.find((s) => isJob(s) && s.status === "running");
    return job ? { do: "watch", step: job } : { do: "finish" };
  }
  const before = list.slice(0, i);
  const failed = before.find((s) => s.status === "failed" && !s.optional);
  if (failed) return { do: "hold_failed", step: failed };
  const busy = before.find((s) => isJob(s) && s.status === "running" && !s.independent);
  if (busy) return { do: "wait_job", step: busy, next: list[i] };
  return { do: "run", step: list[i] };
}
