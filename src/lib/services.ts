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
  const [vercel, supabase, gh] = await Promise.all([
    cli("vercel", ["whoami"]),
    cli("supabase", ["--version"]),
    cli("gh", ["auth", "status"]),
  ]);
  const supaToken = isWin ? fs.existsSync(path.join(process.env.USERPROFILE ?? "", ".supabase", "access-token")) : fs.existsSync(path.join(process.env.HOME ?? "", ".supabase", "access-token"));
  const tools = [
    `Vercel command-line tool: ${vercel.ok ? `signed in as ${vercel.text.split(/\r?\n/).pop()}` : /not recognized|not found|ENOENT/i.test(vercel.text) || !vercel.text ? "not installed (it can be run with `npx vercel`)" : "installed but not signed in"}`,
    `Supabase command-line tool: ${supabase.ok ? `installed (${supabase.text.split(/\r?\n/).pop()})${supaToken ? ", signed in" : ", not signed in"}` : "not installed (it can be run with `npx supabase`)"}`,
    `GitHub command-line tool: ${gh.ok || /Logged in/i.test(gh.text) ? "signed in" : "not signed in"}`,
  ];
  return `# Project folders on this PC (${repos.length})\n${lines.join("\n") || "None found."}\n\n# Sign-ins on this PC\n${tools.join("\n")}\n\nTo sign in to a service, plan a handoff step in draft_runbook with the command (e.g. "npx vercel login", "npx supabase login"): it opens a window and Thomas finishes the sign-in himself.`;
}
