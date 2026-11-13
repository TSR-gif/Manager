export function nextMove<S extends { kind: string; status: string; blocking?: boolean; optional?: boolean; independent?: boolean }>(list: S[]):
  { do: "wait_you" | "hold_failed" | "wait_job" | "run" | "watch" | "finish"; step?: S; next?: S };
