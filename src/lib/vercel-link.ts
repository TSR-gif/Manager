import "server-only";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { vercelAuth } from "@/lib/vercel-auth";

/**
 * `vercel link` connects a folder on his PC to a Vercel project. Run bare (`vercel link --yes`) it can make a brand
 * new project when the folder doesn't match one, so MyManager only ever links to a project that already exists:
 * it names the project, checks it's really in his Vercel account, and skips the step if the folder is already linked.
 * MyManager itself doesn't need the link to see deploys (it uses the project name); this is for his own `vercel` use.
 */
export type LinkPlan =
  | { kind: "not_link" }
  | { kind: "already"; note: string }
  | { kind: "refuse"; note: string; error?: string }
  | { kind: "write"; project: VercelProject; note: string };
export type VercelProject = { id: string; name: string; orgId: string };

const words = (c: string) => c.trim().split(/\s+/);

export function isVercelLink(command: string) {
  const w = words(command);
  const rest = w[0]?.toLowerCase() === "npx" ? w.slice(w[1] === "-y" || w[1] === "--yes" || w[1] === "--no-install" ? 2 : 1) : w;
  return /^vercel(\.cmd)?$/i.test(rest[0] ?? "") && rest[1] === "link";
}

/**
 * MyManager doesn't run `vercel link` itself any more: that tool can make a new project, and newer versions offer to
 * pull settings into .env.local. It looks the project up through Vercel's API instead (in every team the sign-in can
 * see) and writes the same small .vercel/project.json the tool would write.
 */
export async function planVercelLink(command: string, dir: string, projectId: string | null): Promise<LinkPlan> {
  if (!isVercelLink(command)) return { kind: "not_link" };
  const linked = readLinked(dir);
  if (linked) return { kind: "already", note: `This folder is already connected to the Vercel project "${linked}". Nothing to do.` };

  const w = words(command);
  const i = w.findIndex((x) => x === "--project" || x === "-p");
  let name = i >= 0 ? w[i + 1] : undefined;
  if (!name && projectId) {
    const { data } = await db().from("projects").select("name,vercel_project").eq("id", projectId).maybeSingle();
    name = (data as { vercel_project?: string | null } | null)?.vercel_project ?? undefined;
  }
  if (!name || !/^[\w.-]+$/.test(name)) return { kind: "refuse", note: "I don't know which of your Vercel projects this folder belongs to, and I won't make a new one. Tell me its name on Vercel." };

  const found = await findVercelProject(name);
  if (found === "no_auth") return { kind: "refuse", note: "MyManager isn't signed in to Vercel on this PC yet, so I can't look the project up.", error: "not logged in: vercel login" };
  if (found === "unknown") return { kind: "refuse", note: `I couldn't reach Vercel to look up "${name}". I'll try again later.` };
  if (!found) return { kind: "refuse", note: `There's no project called "${name}" in any Vercel team MyManager can see, and I won't make a new one without asking you.` };
  return { kind: "write", project: found, note: `Connected this folder on your PC to your Vercel project "${found.name}". Nothing new was made on Vercel.` };
}

/** Writes .vercel/project.json (what `vercel link` writes) and keeps .vercel out of git. */
export function writeVercelLink(dir: string, p: VercelProject) {
  fs.mkdirSync(path.join(dir, ".vercel"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".vercel", "project.json"), JSON.stringify({ projectId: p.id, orgId: p.orgId, projectName: p.name }));
  const gi = path.join(dir, ".gitignore");
  try {
    const t = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
    if (!/^\/?\.vercel\/?\s*$/m.test(t)) fs.appendFileSync(gi, `${t && !t.endsWith("\n") ? "\n" : ""}.vercel\n`);
  } catch { /* the link still works */ }
}

function readLinked(dir: string): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, ".vercel", "project.json"), "utf8")) as { projectId?: string; projectName?: string };
    return j.projectId ? (j.projectName ?? j.projectId) : null;
  } catch { return null; }
}

/** The project by name, in his own account or any team the sign-in belongs to. */
export async function findVercelProject(name: string): Promise<VercelProject | null | "no_auth" | "unknown"> {
  const { token, teamId } = vercelAuth();
  if (!token) return "no_auth";
  const get = (url: string) => fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  try {
    const teams: (string | undefined)[] = [teamId];
    const t = await get("https://api.vercel.com/v2/teams?limit=50");
    if (t.status === 401 || t.status === 403) return "no_auth";
    if (t.ok) for (const x of ((await t.json()) as { teams?: { id: string }[] }).teams ?? []) if (!teams.includes(x.id)) teams.push(x.id);
    if (teamId) teams.push(undefined);
    let reached = false;
    for (const team of teams) {
      const res = await get(`https://api.vercel.com/v9/projects/${encodeURIComponent(name)}${team ? `?teamId=${encodeURIComponent(team)}` : ""}`);
      if (res.ok) { const j = (await res.json()) as { id: string; name: string; accountId: string }; return { id: j.id, name: j.name, orgId: j.accountId }; }
      if (res.status === 404 || res.status === 403) reached = true;
    }
    return reached ? null : "unknown";
  } catch { return "unknown"; }
}
