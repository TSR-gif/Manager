import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Real walls for coding helpers (the review's "a check, not a sandbox" gap).
 * With CODER_SANDBOX=wsl in .env.local, coders, reviewers and loop checks run inside the Ubuntu WSL distro under
 * Claude Code's sandbox (bubblewrap): shell commands can only write inside their own copy of the project (plus the
 * bits of git it needs to commit to its own branch), can't read the rest of the PC, MyManager, or Claude's sign-in,
 * and can only reach a short list of package sites. Loop checks (npm test etc.) run under Anthropic's sandbox runner
 * with the same walls. Nothing from Windows' environment crosses over.
 * If it's switched on but not working, nothing runs: coding never quietly falls back to running unsandboxed.
 * CODER_SANDBOX=native does the same without WSL (Linux or macOS). Unset = the guard hook only (docs/SAFETY.md).
 */
export type SandboxMode = "off" | "wsl" | "native";
export function sandboxMode(): SandboxMode {
  const m = (process.env.CODER_SANDBOX ?? "").trim().toLowerCase();
  return m === "wsl" || m === "native" ? m : "off";
}
const DISTRO = () => process.env.CODER_SANDBOX_DISTRO || "Ubuntu";
const isWin = process.platform === "win32";

/** C:\Users\x\proj -> /mnt/c/Users/x/proj (WSL's view of a Windows path). Other paths come back unchanged. */
export function toWsl(p: string) {
  const m = p.match(/^([a-zA-Z]):[\\/](.*)$/);
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}` : p.replace(/\\/g, "/");
}
const lin = (p: string) => (sandboxMode() === "wsl" ? toWsl(p) : p);
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Only what wsl.exe needs; WSLENV empty so nothing from Windows' environment crosses into Linux. */
const winEnv = () => ({ SystemRoot: process.env.SystemRoot ?? "C:\\Windows", PATH: process.env.PATH ?? "", WSLENV: "" }) as unknown as NodeJS.ProcessEnv;
const linuxEnv = () => ({ PATH: process.env.PATH ?? "", HOME: os.homedir(), USER: process.env.USER ?? "" }) as unknown as NodeJS.ProcessEnv;

const DOMAINS = ["registry.npmjs.org", "registry.yarnpkg.com", "pypi.org", "files.pythonhosted.org", "github.com", "codeload.github.com", "objects.githubusercontent.com"];

function run(cmd: string, args: string[], ms = 60_000) {
  return new Promise<{ ok: boolean; out: string }>((resolve) => {
    execFile(cmd, args, { timeout: ms, windowsHide: true, env: isWin ? winEnv() : process.env }, (e, so, se) => resolve({ ok: !e, out: `${so}${se}`.trim() }));
  });
}
/** A bash command line inside the sandbox's Linux, with nvm's node on PATH and nothing from Windows' environment. */
function shell(script: string): [string, string[]] {
  const body = `source ~/.nvm/nvm.sh >/dev/null 2>&1; ${script}`;
  // --exec runs bash directly: with "--" WSL hands the line to the distro's login shell first, which expands $PATH
  // and the rest before nvm is loaded (found testing on Thomas's PC).
  return sandboxMode() === "wsl" ? ["wsl.exe", ["-d", DISTRO(), "--exec", "bash", "-lc", body]] : ["bash", ["-lc", body]];
}

let ready: { at: number; problem: string | null } | null = null;
/** Why the sandbox can't be used right now, or null if it's ready (checked at most every 10 minutes). */
export async function sandboxProblem(): Promise<string | null> {
  if (sandboxMode() === "off") return null;
  if (ready && Date.now() - ready.at < 10 * 60_000) return ready.problem;
  const [cmd, args] = shell("for t in claude bwrap socat srt rg git node; do command -v $t >/dev/null || echo MISSING:$t; done; echo CHECKED");
  const r = await run(cmd, args);
  const missing = [...r.out.matchAll(/MISSING:(\w+)/g)].map((m) => m[1]);
  const problem = !r.out.includes("CHECKED") ? `the ${sandboxMode() === "wsl" ? `WSL distro "${DISTRO()}"` : "sandbox"} didn't answer (${r.out.slice(0, 160)})`
    : missing.length ? `the sandbox is missing ${missing.join(", ")}` : null;
  ready = { at: Date.now(), problem };
  return problem;
}

/** The parts of the project's git folder a worktree has to write to, to commit on its own mymanager/<id> branch. */
async function gitWrites(workDir: string): Promise<string[]> {
  const r = await run("git", ["-C", workDir, "rev-parse", "--git-common-dir", "--git-dir"]);
  if (!r.ok) return [];
  const [common, own] = r.out.split(/\r?\n/).map((p) => path.resolve(workDir, p.trim()));
  return [own, path.join(common, "objects"), path.join(common, "refs", "heads", "mymanager"), path.join(common, "logs", "refs", "heads", "mymanager")];
}

/** The walls, in the shape both Claude Code's "sandbox" setting and the sandbox runner (srt) read. */
export async function walls(workDir: string | null) {
  const home = os.homedir();
  const gitBits = workDir ? (await gitWrites(workDir)).map(lin) : [];
  const own = workDir ? [lin(workDir), ...gitBits] : [];
  return {
    filesystem: {
      // the whole Windows drive (WSL) or home folder (native) is hidden, except this job's copy and its git bits
      denyRead: [sandboxMode() === "wsl" ? "/mnt" : home, "~/.claude", "~/.ssh", "~/.aws", "~/.config", "~/.npmrc", "~/.git-credentials"],
      allowRead: own,
      allowWrite: own,
      denyWrite: workDir ? [`${lin(workDir)}/.git`, `${lin(workDir)}/.claude`] : [],
    },
    network: { allowedDomains: DOMAINS, deniedDomains: [] as string[] },
  };
}

/** Claude Code settings for a sandboxed session: the sandbox, the guard hook (Linux side) and file-tool limits. */
export async function claudeSettings(workDir: string | null, readOnly: boolean) {
  const w = await walls(workDir);
  const appDir = lin(process.cwd());
  const home = os.homedir();
  const winHome = sandboxMode() === "wsl" ? toWsl(home) : home;
  return {
    sandbox: {
      enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false, failIfUnavailable: true,
      filesystem: { ...w.filesystem, allowWrite: readOnly ? [] : w.filesystem.allowWrite }, network: w.network,
    },
    // Read/Edit/Write aren't covered by the shell sandbox: keep them off MyManager, keys and Claude's own sign-in.
    permissions: {
      deny: [`Read(/${appDir}/**)`, `Read(/${winHome}/Documents/**)`, `Read(/${winHome}/AppData/**)`, `Read(/${winHome}/.ssh/**)`, "Read(~/.claude/**)", "Read(~/.ssh/**)", "Read(~/.aws/**)",
        ...(readOnly ? ["Edit", "Write", "NotebookEdit"] : [])],
    },
    hooks: { PreToolUse: [{ matcher: "Bash|Read|Grep|Glob|Write|Edit|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: `node ${q(`${appDir}/scripts/guard.mjs`)}`, timeout: 20 }] }] },
  };
}

/**
 * How to start `claude` with these args in the sandbox. Returns the program and its arguments (no shell on the
 * Windows side), or a reason it can't. The prompt still goes in on stdin.
 */
export async function sandboxedClaude(opts: { workDir: string; readOnly?: boolean; tag: string; args: string[] }): Promise<{ cmd: string; args: string[] } | { problem: string }> {
  const problem = await sandboxProblem();
  if (problem) return { problem };
  const settings = await claudeSettings(opts.workDir, !!opts.readOnly);
  const file = path.join(os.tmpdir(), `manager-sandbox-${opts.tag}.json`);
  fs.writeFileSync(file, JSON.stringify(settings));
  const wd = lin(opts.workDir);
  const env = [`HOME="$HOME"`, `PATH="$PATH"`, `USER="$USER"`, "LANG=C.UTF-8", "CI=1",
    `MANAGER_GUARD_STATE=${q(`/tmp/manager-guard-${opts.tag}-created.json`)}`, ...(opts.readOnly ? [] : [`MANAGER_GUARD_DIR=${q(wd)}`])];
  const [cmd, args] = shell(`cd ${q(wd)} && exec env -i ${env.join(" ")} claude --settings ${q(lin(file))} ${opts.args.map(q).join(" ")}`);
  return { cmd, args };
}

/** Run a loop check (npm test etc.) inside the same walls with Anthropic's sandbox runner. */
export async function sandboxedCheck(command: string, workDir: string): Promise<{ cmd: string; args: string[] } | { problem: string }> {
  const problem = await sandboxProblem();
  if (problem) return { problem };
  const file = path.join(os.tmpdir(), `manager-srt-${Date.now().toString(36)}.json`);
  fs.writeFileSync(file, JSON.stringify(await walls(workDir)));
  const wd = lin(workDir);
  const [cmd, args] = shell(`cd ${q(wd)} && exec env -i HOME="$HOME" PATH="$PATH" LANG=C.UTF-8 CI=1 FORCE_COLOR=0 srt --settings ${q(lin(file))} -- bash -c ${q(command)}`);
  return { cmd, args };
}

/**
 * WSL's git can't follow the Windows path ("gitdir: C:/...") that Windows' git writes into a worktree's .git file.
 * A relative link works for both, so in WSL mode the link is rewritten relative (same drive only).
 */
export function relativeGitLink(workDir: string): string | null {
  if (sandboxMode() !== "wsl") return null;
  const file = path.join(workDir, ".git");
  let text = "";
  try { if (!fs.statSync(file).isFile()) return null; text = fs.readFileSync(file, "utf8"); } catch { return null; }
  const m = text.match(/^gitdir:\s*(.+?)\s*$/m);
  if (!m) return "the copy's .git link couldn't be read";
  const target = path.resolve(workDir, m[1]);
  const rel = path.relative(workDir, target);
  if (path.isAbsolute(rel)) return `the copy and the project are on different drives (${target}), so WSL can't follow it`;
  const want = `gitdir: ${rel.replace(/\\/g, "/")}\n`;
  // Windows' git marks this file hidden, and Node can't replace a hidden file, only overwrite it in place.
  if (text !== want) { fs.truncateSync(file); fs.writeFileSync(file, want, { flag: "r+" }); }
  return null;
}

type Launch = { cmd: string; args: string[]; shell: boolean; env: NodeJS.ProcessEnv };

/**
 * How to start a Claude Code helper (coder or reviewer) for a job's copy of a project: inside the sandbox when it's
 * switched on, otherwise with the guard hook only. With the sandbox on and broken, it returns the problem instead:
 * nothing runs unsandboxed.
 */
export async function claudeLaunch(opts: { workDir: string; readOnly?: boolean; tag: string; args: string[] }): Promise<Launch | { problem: string }> {
  if (sandboxMode() === "off") {
    const { guarded } = await import("@/lib/agent/guard");
    const guard = guarded(opts.readOnly ? null : opts.workDir, opts.tag); // the app blocks anything destructive, whatever the model does
    const args = [...opts.args, ...guard.args];
    return { cmd: process.env.CLAUDE_BIN ?? (isWin ? "claude.cmd" : "claude"), args: isWin ? args.map((a) => (/[\s&()^|<>]/.test(a) ? `"${a}"` : a)) : args, shell: isWin, env: guard.env };
  }
  const link = relativeGitLink(opts.workDir);
  if (link) return { problem: link };
  const r = await sandboxedClaude(opts);
  return "problem" in r ? r : { ...r, shell: false, env: isWin ? winEnv() : linuxEnv() };
}

/** How to run a loop check (npm test etc.) in a job's copy: in the sandbox runner when it's on, otherwise with a clean env. */
export async function checkLaunch(command: string, workDir: string): Promise<Launch | { problem: string }> {
  if (sandboxMode() === "off") {
    const { workerEnv } = await import("@/lib/worker-env");
    return { cmd: command, args: [], shell: true, env: workerEnv({ CI: "1", FORCE_COLOR: "0" }) };
  }
  const link = relativeGitLink(workDir);
  if (link) return { problem: link };
  const r = await sandboxedCheck(command, workDir);
  return "problem" in r ? r : { ...r, shell: false, env: isWin ? winEnv() : linuxEnv() };
}
