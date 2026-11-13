import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { db } from "@/lib/db";

/**
 * Thomas's projects live as git folders on his PC. This finds them (by their GitHub remote, or folder name)
 * and reads their local state: branch, uncommitted changes, MyManager's work branches.
 */
const run = promisify(execFile);
const git = async (dir: string, ...args: string[]) => (await run("git", ["-C", dir, ...args], { timeout: 15_000, windowsHide: true })).stdout.trim();

const SKIP = new Set(["node_modules", "AppData", "Library", ".git", ".cache", ".npm", ".vscode", "OneDrive - Personal", "$Recycle.Bin", "Windows", "Program Files"]);

function roots() {
  const home = os.homedir();
  const extra = (process.env.PROJECT_ROOTS ?? "").split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  return [...extra, path.join(home, "Documents"), path.join(home, "Desktop"), path.join(home, "source", "repos"), path.join(home, "Projects"), path.join(home, "dev"), home]
    .filter((d, i, a) => a.indexOf(d) === i && fs.existsSync(d));
}

export interface LocalRepo { dir: string; folder: string; remote: string | null }

/** Git folders up to 2 levels under the usual places (Documents, Desktop, source\repos, home). */
export function scanRepos(): LocalRepo[] {
  const found = new Map<string, LocalRepo>();
  const visit = (dir: string, depth: number) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.name === ".git")) {
      let remote: string | null = null;
      try {
        const cfg = fs.readFileSync(path.join(dir, ".git", "config"), "utf8");
        const m = cfg.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/);
        const u = m?.[1] ?? null;
        const r = u?.match(/github\.com[:/]([^/]+\/[^/.\s]+?)(?:\.git)?$/i);
        remote = r ? r[1] : u;
      } catch { /* not a normal repo */ }
      found.set(dir, { dir, folder: path.basename(dir), remote });
      return;
    }
    if (depth <= 0) return;
    for (const e of entries) if (e.isDirectory() && !e.name.startsWith(".") && !SKIP.has(e.name)) visit(path.join(dir, e.name), depth - 1);
  };
  for (const r of roots()) visit(r, 2);
  return [...found.values()];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Fill in projects.local_path for projects whose folder we can find. Never overwrites one Thomas set. */
export async function linkProjectFolders() {
  const { data } = await db().from("projects").select("id,name,github_repo,local_path");
  const projects = (data ?? []) as { id: string; name: string; github_repo: string | null; local_path: string | null }[];
  const repos = scanRepos();
  const linked: { name: string; dir: string }[] = [];
  for (const p of projects) {
    if (p.local_path && fs.existsSync(p.local_path)) continue;
    const want = p.github_repo?.toLowerCase();
    const hit = (want && repos.find((r) => r.remote?.toLowerCase() === want))
      || (want && repos.find((r) => norm(r.folder) === norm(want.split("/")[1] ?? "")))
      || repos.find((r) => norm(r.folder) === norm(p.name));
    if (hit) {
      await db().from("projects").update({ local_path: hit.dir }).eq("id", p.id);
      linked.push({ name: p.name, dir: hit.dir });
    }
  }
  return { linked, scanned: repos.length };
}

export interface LocalState {
  dir: string; branch: string; changed: number; changedFiles: string[]; ahead: number | null; behind: number | null;
  lastCommit: string; workBranches: { name: string; commits: number; last: string }[];
}

/** What the project looks like on this PC right now. */
export async function localState(dir: string): Promise<LocalState | null> {
  if (!dir || !fs.existsSync(path.join(dir, ".git"))) return null;
  try {
    const [status, last, branches] = await Promise.all([
      git(dir, "status", "--porcelain", "-b"),
      git(dir, "log", "-1", "--format=%s (%cr)").catch(() => ""),
      git(dir, "branch", "--list", "mymanager/*", "--format=%(refname:short)").catch(() => ""),
    ]);
    const lines = status.split("\n");
    const head = lines[0] ?? "";
    const branch = head.replace(/^## /, "").split("...")[0];
    const ab = head.match(/\[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\]/);
    const changedFiles = lines.slice(1).filter(Boolean).map((l) => l.slice(3));
    const base = (await git(dir, "symbolic-ref", "--short", "refs/remotes/origin/HEAD").catch(() => "")) || "main";
    const workBranches = await Promise.all(branches.split("\n").filter(Boolean).map(async (b) => ({
      name: b,
      commits: Number(await git(dir, "rev-list", "--count", `${base}..${b}`).catch(() => "0")) || 0,
      last: await git(dir, "log", "-1", "--format=%s (%cr)", b).catch(() => ""),
    })));
    return { dir, branch, changed: changedFiles.length, changedFiles: changedFiles.slice(0, 15), ahead: ab?.[1] ? Number(ab[1]) : ab ? 0 : null, behind: ab?.[2] ? Number(ab[2]) : ab ? 0 : null, lastCommit: last, workBranches };
  } catch {
    return null;
  }
}

export function localStateText(s: LocalState) {
  return [
    `## On this PC (${s.dir})`,
    `- Branch: ${s.branch}${s.ahead ? `, ${s.ahead} commit(s) not pushed` : ""}${s.behind ? `, ${s.behind} behind GitHub` : ""}`,
    `- Uncommitted changes: ${s.changed}${s.changed ? ` (${s.changedFiles.slice(0, 8).join(", ")})` : ""}`,
    `- Last commit: ${s.lastCommit || "none"}`,
    ...(s.workBranches.length ? [`- MyManager work branches: ${s.workBranches.map((b) => `${b.name} (${b.commits} commit(s), last: ${b.last})`).join("; ")}`] : []),
  ].join("\n");
}

/** Short summary of what a work branch changed, for Thomas to review before anything is pushed. */
export async function branchSummary(dir: string, branch: string) {
  const base = (await git(dir, "symbolic-ref", "--short", "refs/remotes/origin/HEAD").catch(() => "")) || "main";
  const [log, stat] = await Promise.all([
    git(dir, "log", "--format=- %s", `${base}..${branch}`).catch(() => ""),
    git(dir, "diff", "--shortstat", `${base}...${branch}`).catch(() => ""),
  ]);
  return { base, log, stat };
}

/** Push a MyManager work branch to GitHub (only ever called from an approved "code.push" action). */
export async function pushBranch(dir: string, branch: string, sha?: string) {
  if (!/^mymanager\/[a-z0-9-]+$/i.test(branch)) throw new Error("Only MyManager work branches can be pushed this way.");
  // Thomas approved one exact commit. If the branch has moved since, push nothing and ask again.
  if (sha) {
    const now = (await git(dir, "rev-parse", `refs/heads/${branch}`)).trim();
    if (now !== sha) throw new Error(`The branch changed after you approved it (approved ${sha.slice(0, 7)}, now ${now.slice(0, 7)}). Nothing was pushed; ask for a new push.`);
    await git(dir, "push", "origin", `${sha}:refs/heads/${branch}`);
    await git(dir, "branch", `--set-upstream-to=origin/${branch}`, branch).catch(() => "");
  } else await git(dir, "push", "-u", "origin", branch);
  const remote = await git(dir, "remote", "get-url", "origin").catch(() => "");
  const r = remote.match(/github\.com[:/]([^/]+\/[^/.\s]+?)(?:\.git)?$/i);
  return { branch, url: r ? `https://github.com/${r[1]}/compare/${encodeURIComponent(branch)}?expand=1` : null };
}
