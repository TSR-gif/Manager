import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { db } from "@/lib/db";
import { gh } from "@/lib/inspect";
import { runAgent } from "@/lib/agent/run";

/**
 * A living brief per project: MyManager studies the real repo (GitHub and/or the folder on this PC),
 * writes what it is, how it's built, how to run it, where it stands and what's next, and reads it
 * before answering or acting. Thomas's own rules for a project are kept separately and never overwritten.
 */
const run = promisify(execFile);

export interface BriefProject {
  id: string; name: string; github_repo: string | null; local_path?: string | null; brief?: string | null;
  brief_updated_at?: string | null; brief_commit?: string | null; brief_edited_by_you?: boolean; rules?: string | null;
  goal?: string | null; notes?: string | null; kind?: string | null;
}

export const hasCode = (p: BriefProject) => !!(p.github_repo || p.local_path);

/** The newest commit we can see: the PC folder first, then GitHub. */
export async function latestCommit(p: BriefProject): Promise<string | null> {
  if (p.local_path && fs.existsSync(path.join(p.local_path, ".git"))) {
    try { return (await run("git", ["-C", p.local_path, "rev-parse", "HEAD"], { timeout: 10_000, windowsHide: true })).stdout.trim(); } catch { /* fall through */ }
  }
  if (p.github_repo) {
    const c = await gh<{ sha: string }[]>(`repos/${p.github_repo}/commits?per_page=1`);
    return c?.[0]?.sha ?? null;
  }
  return null;
}

const MAX = 40_000;
/** Read one file of a project (read-only): from the PC folder if there is one, otherwise from GitHub. */
export async function readProjectFile(p: BriefProject, rel: string): Promise<string> {
  // "" or "." lists the project's top folder
  const clean = String(rel ?? "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\/?$/, "");
  if (clean.split("/").includes("..") || path.isAbsolute(clean) || /^[a-z]:/i.test(clean)) return "That path isn't allowed.";
  if (/(^|\/)\.env(\.|$)|secret|credential|\.pem$|\.key$/i.test(clean)) return "Secret files are never read.";
  if (p.local_path) {
    const full = path.resolve(p.local_path, clean || ".");
    // compare real locations, so a link or junction inside the project can't lead outside it
    let real = full;
    try { real = fs.realpathSync.native(full); } catch { /* missing: GitHub below */ }
    let root = path.resolve(p.local_path);
    try { root = fs.realpathSync.native(root); } catch { /* keep */ }
    const relPath = path.relative(root, real);
    if (relPath.startsWith("..") || path.isAbsolute(relPath)) return "That path isn't allowed.";
    try {
      const st = fs.statSync(full);
      if (st.isDirectory()) return fs.readdirSync(full).filter((n) => !n.startsWith(".") && n !== "node_modules").slice(0, 200).join("\n");
      const text = fs.readFileSync(full, "utf8");
      return text.length > MAX ? `${text.slice(0, MAX)}\n…(cut, ${text.length} characters in total)` : text;
    } catch { /* not on the PC: try GitHub */ }
  }
  if (p.github_repo) {
    const f = await gh<{ content?: string; type?: string } | { name: string; type: string }[]>(`repos/${p.github_repo}/contents/${clean ? clean.split("/").map(encodeURIComponent).join("/") : ""}`);
    if (Array.isArray(f)) return f.map((x) => `${x.name}${x.type === "dir" ? "/" : ""}`).join("\n");
    if (f?.content) {
      const text = Buffer.from(f.content, "base64").toString("utf8");
      return text.length > MAX ? `${text.slice(0, MAX)}\n…(cut)` : text;
    }
  }
  return `Couldn't find ${clean}.`;
}

export function briefSections() {
  return `## What it is
(one or two sentences: what it does and who it's for)
## How it's built
(stack, main folders and files and what each is for)
## How to run and test it
(exact commands on Thomas's Windows PC; say if there are no tests)
## Where it lives
(GitHub repo, the folder on his PC, where it's deployed or hosted, if anywhere)
## Where it's at
(current state in plain words, what recently changed)
## Known problems
(real ones you can see: bugs, clutter, failing checks, risky bits)
## What's next
(the 3 to 5 most useful next steps, most important first)`;
}

export function studyGoal(p: BriefProject) {
  return `Study the ${p.name} project and write its project brief. Thomas wants you to fully understand each of his projects, and you'll read this brief before answering or acting on ${p.name}.
1. Call inspect_project("${p.name}").
2. Read the files that explain it with read_project_file: any CLAUDE.md, README, the package/requirements file, the main entry points, config, and a few core source files. Use "" or a folder name to list files. Read enough to really understand it (about 5 to 12 files), but never secrets or .env files.
3. Call save_project_brief with a brief in this exact shape, plain words, specific (real file names, real commands), no guessing: say "not sure" where you can't tell.
${briefSections()}
${p.rules ? `\nThomas's own rules for this project (don't put them in the brief, they're kept separately, but respect them): ${p.rules}` : ""}
${p.brief ? `\nThe current brief is below.${p.brief_edited_by_you ? " Thomas corrected it himself: keep his corrections unless the code clearly shows they're now out of date." : ""} Update it rather than starting over:\n${p.brief}` : ""}
Finish with one line saying what changed in the brief.`;
}

let studying = false;
/** Study one project now (writes the brief through the save_project_brief tool). */
export async function studyProject(id: string) {
  const { data } = await db().from("projects").select("*").eq("id", id).maybeSingle();
  const p = data as BriefProject | null;
  if (!p || !hasCode(p)) return null;
  const sha = await latestCommit(p);
  const started = Date.now();
  const runId = await runAgent(studyGoal(p), () => {}, undefined, { kind: "study" });
  // Only mark the brief as up to date with this commit if a new brief really got saved during the run.
  const { data: after } = await db().from("projects").select("brief_updated_at").eq("id", id).maybeSingle();
  const saved = after?.brief_updated_at && new Date(after.brief_updated_at as string).getTime() >= started;
  if (sha && saved) await db().from("projects").update({ brief_commit: sha }).eq("id", id);
  return runId;
}

/** From the tick: refresh at most one brief per pass, when it's missing or the code has moved on. */
export async function refreshDueBriefs() {
  if (studying) return null;
  studying = true;
  try {
    const { data } = await db().from("projects").select("id,name,github_repo,local_path,brief,brief_updated_at,brief_commit,status").in("status", ["active", "paused"]);
    const list = ((data ?? []) as (BriefProject & { status: string })[]).filter(hasCode);
    const missing = list.find((p) => !p.brief);
    if (missing) return { project: missing.name, runId: await studyProject(missing.id) };
    for (const p of list) {
      const age = p.brief_updated_at ? Date.now() - new Date(p.brief_updated_at).getTime() : Infinity;
      if (age < 12 * 3600_000) continue;
      const sha = await latestCommit(p);
      if (sha && sha !== p.brief_commit) return { project: p.name, runId: await studyProject(p.id) };
    }
    return null;
  } finally {
    studying = false;
  }
}

/** What the assistant reads first about a project. */
export function briefHeader(p: BriefProject) {
  const parts: string[] = [];
  if (p.rules) parts.push(`## Thomas's rules for ${p.name} (always follow)\n${p.rules}`);
  if (p.brief) parts.push(`## Project brief (written ${p.brief_updated_at ? p.brief_updated_at.slice(0, 10) : "earlier"}${p.brief_edited_by_you ? ", corrected by Thomas" : ""})\n${p.brief}`);
  else parts.push(hasCode(p) ? "## Project brief\nNot written yet. Study the project (read_project_file) before big decisions, and save one with save_project_brief." : "## Project brief\nNo code to study for this project. Use what Thomas has written about it, and ask him if you need more.");
  return parts.join("\n\n");
}
