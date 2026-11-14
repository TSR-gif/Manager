import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { db } from "@/lib/db";
import { vercelAuth } from "@/lib/vercel-auth";
import { findVercelProject } from "@/lib/vercel-link";

/**
 * Which accounts each project really uses (its Vercel project, the Supabase database its settings point at, its
 * GitHub repo), checked against what MyManager's own sign-ins on this PC can see. So MyManager can say "Manager's
 * database is in a Supabase account I'm not signed in to" by itself instead of asking him which login is which.
 * Read-only. Reads only database addresses (never keys) from Vercel and the project folder's supabase files.
 */
const run = promisify(execFile);
const isWin = process.platform === "win32";
async function cli(cmd: string, args: string[]) {
  const attempt = (c: string, a: string[]) => run(isWin ? "cmd.exe" : c, isWin ? ["/d", "/c", c, ...a] : a, { timeout: 30_000, windowsHide: true, maxBuffer: 4 << 20 })
    .then((x) => ({ ok: true, text: `${x.stdout}` }), (e) => ({ ok: false, text: `${e.stdout ?? ""}${e.stderr ?? ""}` }));
  const direct = await attempt(cmd, args);
  if (direct.ok || !/not recognized|not found|ENOENT/i.test(direct.text)) return direct;
  return attempt("npx", ["--no-install", cmd, ...args]);
}

export type ProjectAccounts = { name: string; lines: string[]; problems: string[] };

const refOf = (url: string) => url.match(/https:\/\/([a-z0-9]{20})\.supabase\.co/i)?.[1]?.toLowerCase();

/** The Supabase databases MyManager's sign-in can see (ref -> name). null = it isn't signed in or couldn't check. */
async function supabaseRefs(): Promise<Map<string, string> | null> {
  const r = await cli("supabase", ["projects", "list", "-o", "json"]);
  if (!r.ok) return null;
  try {
    const list = JSON.parse(r.text.slice(r.text.indexOf("["))) as { id?: string; ref?: string; name: string }[];
    return new Map(list.map((p) => [(p.ref ?? p.id ?? "").toLowerCase(), p.name]));
  } catch { return null; }
}

/** Database addresses in a Vercel project's settings (plain values only; keys are never read). */
async function vercelSupabaseRefs(projectId: string, orgId: string) {
  const { token } = vercelAuth();
  if (!token) return [];
  try {
    const res = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env?teamId=${encodeURIComponent(orgId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) return [];
    const j = (await res.json()) as { envs?: { key: string; type: string; value?: string }[] };
    return (j.envs ?? []).filter((e) => /SUPABASE_URL$/.test(e.key) && e.type === "plain" && e.value).map((e) => refOf(e.value!)).filter(Boolean) as string[];
  } catch { return []; }
}

function folderSupabaseRef(dir: string | null) {
  if (!dir) return null;
  try { return fs.readFileSync(path.join(dir, "supabase", ".temp", "project-ref"), "utf8").trim().toLowerCase() || null; } catch { return null; }
}

export async function accountCheck(): Promise<ProjectAccounts[]> {
  const { data } = await db().from("projects").select("name,vercel_project,github_repo,local_path,status").neq("status", "archived").order("priority");
  const projects = (data ?? []) as { name: string; vercel_project: string | null; github_repo: string | null; local_path: string | null }[];
  const supa = await supabaseRefs();
  const out: ProjectAccounts[] = [];
  for (const p of projects) {
    const lines: string[] = [], problems: string[] = [];
    const refs = new Set<string>();
    if (p.vercel_project) {
      const v = await findVercelProject(p.vercel_project);
      if (v === "no_auth") problems.push("MyManager isn't signed in to Vercel, so I can't check its Vercel project.");
      else if (v === "unknown") lines.push(`Vercel: couldn't reach Vercel to check "${p.vercel_project}".`);
      else if (!v) problems.push(`Vercel: there's no project "${p.vercel_project}" in any Vercel account MyManager is signed in to.`);
      else { lines.push(`Vercel: "${v.name}", which MyManager's Vercel sign-in can see.`); for (const r of await vercelSupabaseRefs(v.id, v.orgId)) refs.add(r); }
    }
    const fr = folderSupabaseRef(p.local_path);
    if (fr) refs.add(fr);
    for (const r of refs) {
      if (!supa) { lines.push(`Supabase: uses database ${r}; MyManager isn't signed in to Supabase, so I can't check it.`); continue; }
      if (supa.has(r)) lines.push(`Supabase: "${supa.get(r)}", in the account MyManager is signed in to.`);
      else problems.push(`Supabase: its database (${r}) is in a Supabase account MyManager isn't signed in to.`);
    }
    if (p.github_repo) {
      const g = await cli("gh", ["repo", "view", p.github_repo, "--json", "viewerPermission", "-q", ".viewerPermission"]);
      if (g.ok && g.text.trim()) lines.push(`GitHub: ${p.github_repo} (MyManager can ${/ADMIN|MAINTAIN|WRITE/.test(g.text) ? "read and push" : "read"} it).`);
      else problems.push(`GitHub: MyManager's GitHub sign-in can't see ${p.github_repo}.`);
    }
    if (lines.length || problems.length) out.push({ name: p.name, lines, problems });
  }
  return out;
}

export function accountReport(list: ProjectAccounts[]) {
  if (!list.length) return "No projects with online accounts found.";
  return list.map((p) => `- ${p.name}: ${[...p.problems.map((x) => `PROBLEM: ${x}`), ...p.lines].join(" ")}`).join("\n");
}
