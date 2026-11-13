import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { scanRepos } from "@/lib/local-repos";

/**
 * Which of Thomas's project folders use which online services (Vercel, Supabase, …), and whether the
 * command-line tools on this PC are already signed in. Read-only: looks at config files only, never at
 * .env or key files, and never prints secrets.
 */
const run = promisify(execFile);
const isWin = process.platform === "win32";

async function cli(cmd: string, args: string[]) {
  try {
    const { stdout, stderr } = await run(isWin ? "cmd.exe" : cmd, isWin ? ["/d", "/c", cmd, ...args] : args, { timeout: 25_000, windowsHide: true, maxBuffer: 1 << 20 });
    return { ok: true, text: `${stdout}${stderr}`.trim() };
  } catch (e) {
    const x = e as { stdout?: string; stderr?: string; code?: unknown };
    return { ok: false, text: `${x.stdout ?? ""}${x.stderr ?? ""}`.trim() };
  }
}

const readJson = (f: string) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

export async function findServices(): Promise<string> {
  const repos = scanRepos();
  const lines: string[] = [];
  for (const r of repos) {
    const has = (rel: string) => fs.existsSync(path.join(r.dir, rel));
    const pkg = readJson(path.join(r.dir, "package.json")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null;
    const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
    const found: string[] = [];
    const vp = readJson(path.join(r.dir, ".vercel", "project.json")) as { projectId?: string; orgId?: string; projectName?: string } | null;
    if (vp) found.push(`Vercel (linked${vp.projectName ? ` to "${vp.projectName}"` : ""})`);
    else if (has("vercel.json")) found.push("Vercel (has vercel.json, not linked on this PC)");
    else if (deps.next) found.push("Next.js app (Vercel-ready, not linked)");
    if (has("supabase/config.toml")) {
      const t = fs.readFileSync(path.join(r.dir, "supabase", "config.toml"), "utf8");
      const id = t.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
      found.push(`Supabase (supabase folder${id ? `, project "${id}"` : ""}${has("supabase/.temp/project-ref") ? ", linked" : ""})`);
    } else if (deps["@supabase/supabase-js"] || deps["@supabase/ssr"]) found.push("Supabase (uses the Supabase library)");
    if (has("firebase.json")) found.push("Firebase");
    if (has("netlify.toml")) found.push("Netlify");
    if (has("requirements.txt") || has("pyproject.toml")) found.push("Python");
    lines.push(`- ${r.folder} (${r.dir})${r.remote ? `, GitHub ${r.remote}` : ""}: ${found.join(", ") || "no online services found"}`);
  }
  const tools = await signIns();
  return `# Project folders on this PC (${repos.length})\n${lines.join("\n") || "None found."}\n\n# MyManager's own sign-ins on this PC\nThese are the command-line tools MyManager uses. They are separate from Thomas's browser: being signed in on Chrome doesn't sign these in. Say so when you tell him one is signed out.\n${tools.join("\n")}\n\nTo sign in to a service, plan a handoff step in draft_runbook with the command (e.g. "npx vercel login", "npx supabase login"): it opens a window and Thomas finishes the sign-in himself.`;
}

// (the Vercel CLI prints a "Vercel CLI 65.x" banner on stderr, which lands after the answer)
const lastLine = (t: string) => t.split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !/^Vercel CLI \d/i.test(x)).pop() ?? "";
const missing = (t: string) => !t || /not recognized|not found|ENOENT|missing packages|could not determine executable/i.test(t);

/** A tool that's on the PC, or already in npx's cache. `npx --no-install` never downloads anything. */
async function tryCli(cmd: string, args: string[]) {
  const direct = await cli(cmd, args);
  if (direct.ok || !missing(direct.text)) return { ...direct, installed: true };
  const viaNpx = await cli("npx", ["--no-install", cmd, ...args]);
  return { ...viaNpx, installed: viaNpx.ok || !missing(viaNpx.text) };
}

/**
 * Whether each command-line tool is really signed in, by asking it something read-only.
 * (Supabase used to be judged by ~/.supabase/access-token, but on Windows its sign-in is kept in Windows'
 * credential store, so that file is usually missing even when it's signed in.)
 */
export async function signIns() {
  const [vercel, supabase, gh] = await Promise.all([
    tryCli("vercel", ["whoami"]),
    tryCli("supabase", ["projects", "list"]),
    cli("gh", ["auth", "status"]),
  ]);
  const vercelState = vercel.ok ? `signed in as ${lastLine(vercel.text)}`
    : !vercel.installed ? "not installed on this PC. Signing in with `npx vercel login` installs it in that window (it asks first)"
    : /token is not valid|invalid token|expired/i.test(vercel.text) ? "its sign-in has expired, so it needs signing in again"
    : /no existing credentials|not logged in|vercel login/i.test(vercel.text) ? "not signed in"
    : `couldn't check (${lastLine(vercel.text).slice(0, 120)})`;
  const supaState = supabase.ok ? "signed in"
    : !supabase.installed ? "not installed on this PC (it can be run with `npx supabase`)"
    : /access token|supabase login|unauthorized|401/i.test(supabase.text) ? "not signed in"
    : `couldn't check (${lastLine(supabase.text).slice(0, 120)})`;
  return [
    `Vercel command-line tool: ${vercelState}`,
    `Supabase command-line tool: ${supaState}`,
    `GitHub command-line tool: ${gh.ok || /Logged in/i.test(gh.text) ? "signed in" : "not signed in"}`,
  ];
}

/** The read-only check that proves a sign-in worked, for each sign-in command MyManager can hand over. */
const SIGN_IN_CHECKS: [RegExp, string, string, string[]][] = [
  [/\bvercel\s+login\b/i, "Vercel", "vercel", ["whoami"]],
  [/\bsupabase\s+login\b/i, "Supabase", "supabase", ["projects", "list"]],
  [/\bgh\s+auth\s+login\b/i, "GitHub", "gh", ["auth", "status"]],
  [/\bnpm\s+login\b/i, "npm", "npm", ["whoami"]],
];
export function signInService(command: string) { return SIGN_IN_CHECKS.find(([re]) => re.test(command))?.[1] ?? null; }

/** Is MyManager's own command-line sign-in for this service working right now? null = no check for that command. */
export async function checkSignIn(command: string): Promise<boolean | null> {
  const c = SIGN_IN_CHECKS.find(([re]) => re.test(command));
  if (!c) return null;
  const r = c[2] === "gh" ? await cli("gh", c[3]) : await tryCli(c[2], c[3]);
  return r.ok || (c[2] === "gh" && /Logged in/i.test(r.text));
}
