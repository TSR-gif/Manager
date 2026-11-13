/** Runs that really have a Claude Code process going in this server (survives hot reloads, not restarts). */
const g = globalThis as unknown as { __mmLiveRuns?: Set<string> };
export const liveRuns = (g.__mmLiveRuns ??= new Set<string>());
