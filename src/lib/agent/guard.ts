import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Every Claude Code session MyManager starts gets scripts/guard.mjs as a PreToolUse hook: the app itself blocks
 * deleting, overwriting what git can't restore, history rewrites, pushes, uninstalls, killing programs, system
 * settings and reading secrets, whatever the model decides. Returns the extra CLI args and env for the session.
 */
export function guarded(workDir: string | null, tag: string) {
  const hookCmd = `"${process.execPath}" "${path.join(process.cwd(), "scripts", "guard.mjs")}"`;
  const settings = { hooks: { PreToolUse: [{ matcher: "Bash|PowerShell|Read|Grep|Glob|Write|Edit|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: hookCmd, timeout: 20 }] }] } };
  const file = path.join(os.tmpdir(), `manager-guard-${tag}.json`);
  fs.writeFileSync(file, JSON.stringify(settings));
  const env: NodeJS.ProcessEnv = { ...process.env, MANAGER_GUARD_STATE: path.join(os.tmpdir(), `manager-guard-${tag}-created.json`) };
  if (workDir) env.MANAGER_GUARD_DIR = workDir; else delete env.MANAGER_GUARD_DIR;
  return { args: ["--settings", file], env };
}
