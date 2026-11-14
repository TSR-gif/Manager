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
  | { kind: "refuse"; note: string }
  | { kind: "run"; command: string; project: string; note: string };

const words = (c: string) => c.trim().split(/\s+/);

export function isVercelLink(command: string) {
  const w = words(command);
  const rest = w[0]?.toLowerCase() === "npx" ? w.slice(w[1] === "-y" || w[1] === "--yes" ? 2 : 1) : w;
  return /^vercel(\.cmd)?$/i.test(rest[0] ?? "") && rest[1] === "link";
}

export async function planVercelLink(command: string, dir: string, projectId: string | null): Promise<LinkPlan> {
  if (!isVercelLink(command)) return { kind: "not_link" };
  const linked = readLinked(dir);
  if (linked) return { kind: "already", note: `This folder is already connected to the Vercel project${linked ? ` "${linked}"` : ""}. Nothing to do.` };

  const w = words(command);
  const i = w.findIndex((x) => x === "--project" || x === "-p");
  let name = i >= 0 ? w[i + 1] : undefined;
  if (!name && projectId) {
    const { data } = await db().from("projects").select("name,vercel_project").eq("id", projectId).maybeSingle();
    name = (data as { vercel_project?: string | null } | null)?.vercel_project ?? undefined;
  }
  if (!name || !/^[\w.-]+$/.test(name)) return { kind: "refuse", note: "Not run: I don't know which of your Vercel projects this folder belongs to, and linking without naming one can make a new project. Tell me the project's name on Vercel." };

  const found = await projectExists(name);
  if (found === "no_auth") return { kind: "refuse", note: "Not run yet: MyManager isn't signed in to Vercel on this PC, so I can't check the project exists. Sign MyManager in to Vercel first." };
  if (found === false) return { kind: "refuse", note: `Not run: there's no project called "${name}" in your Vercel account, and I won't make a new one without asking you.` };
  if (found === "unknown") return { kind: "refuse", note: `Not run: I couldn't reach Vercel to check "${name}" exists. I'll only link once I can see it's there.` };

  const npx = w[0]?.toLowerCase() === "npx" ? "npx " : "";
  return { kind: "run", project: name, command: `${npx}vercel link --yes --project ${name}`, note: `Connected this folder on your PC to your existing Vercel project "${name}". Nothing new was made on Vercel.` };
}

function readLinked(dir: string): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, ".vercel", "project.json"), "utf8")) as { projectId?: string; projectName?: string };
    return j.projectId ? (j.projectName ?? j.projectId) : null;
  } catch { return null; }
}

async function projectExists(name: string): Promise<boolean | "no_auth" | "unknown"> {
  const { token, teamId } = vercelAuth();
  if (!token) return "no_auth";
  try {
    const res = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(name)}${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ""}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (res.ok) return true;
    if (res.status === 404) return false;
    return "unknown";
  } catch { return "unknown"; }
}
