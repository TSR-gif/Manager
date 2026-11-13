import "server-only";
import { execFile } from "node:child_process";
import { db } from "./db";
import { getSignals } from "./signals";
import type { Project, Task } from "./types";

/**
 * "Go see how X is going": gathers everything Manager can see about one project so the assistant can
 * give a real answer. GitHub is read with GITHUB_TOKEN, or with the GitHub CLI (`gh`) if Thomas is
 * signed in to it on his PC, so it works with whichever he has. Read only.
 */

const sh = (args: string[]) =>
  new Promise<string | null>((resolve) => {
    execFile(process.platform === "win32" ? "gh.exe" : "gh", args, { timeout: 20_000, maxBuffer: 4 << 20, windowsHide: true }, (err, out) => resolve(err ? null : out));
  });

let ghCli: boolean | null = null;
let ghCliCheckedAt = 0;
export async function gh<T = unknown>(path: string): Promise<T | null> {
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    try {
      const r = await fetch(`https://api.github.com/${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }, cache: "no-store" });
      if (r.ok) return (await r.json()) as T;
    } catch { /* fall back to the gh sign-in on this PC */ }
  }
  if (ghCli === false && Date.now() - ghCliCheckedAt < 10 * 60_000) return null;
  const out = await sh(["api", "-X", "GET", path]);
  if (out === null) { if (ghCli !== true) { ghCli = (await sh(["api", "user"])) !== null; ghCliCheckedAt = Date.now(); } return null; }
  ghCli = true;
  try { return JSON.parse(out) as T; } catch { return null; }
}

export async function githubAccess(): Promise<"token" | "cli" | "none"> {
  if (process.env.GITHUB_TOKEN) return "token";
  return (await sh(["api", "user"])) !== null ? "cli" : "none";
}

const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Melbourne" }) : "?");
const ago = (iso?: string | null) => {
  if (!iso) return "never";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};

interface Commit { sha: string; commit: { message: string; author?: { date?: string } } }
interface Issue { number: number; title: string; created_at: string; pull_request?: unknown; labels?: { name: string }[] }
interface TreeItem { path: string; type: string; size?: number }

const CODE_EXT = /\.(py|ts|tsx|js|jsx|mjs|cs|go|rs|java|kt|rb|php|html|css|sql|md)$/i;
const SKIP = /(^|\/)(node_modules|dist|build|\.next|vendor|venv|\.venv|__pycache__|coverage)\//;

async function todos(repo: string, branch: string, tree: TreeItem[]) {
  const files = tree.filter((t) => t.type === "blob" && CODE_EXT.test(t.path) && !SKIP.test(t.path) && (t.size ?? 0) < 200_000)
    .sort((a, b) => (a.path.split("/").length - b.path.split("/").length) || a.path.localeCompare(b.path)).slice(0, 40);
  const found: string[] = [];
  await Promise.all(files.map(async (f) => {
    const c = await gh<{ content?: string; encoding?: string }>(`repos/${repo}/contents/${encodeURIComponent(f.path).replace(/%2F/g, "/")}?ref=${branch}`);
    if (!c?.content) return;
    const text = Buffer.from(c.content, "base64").toString("utf8");
    text.split(/\r?\n/).forEach((line, i) => {
      if (/\b(TODO|FIXME|HACK|XXX)\b/.test(line)) found.push(`${f.path}:${i + 1} ${line.trim().slice(0, 140)}`);
    });
  }));
  return found.slice(0, 25);
}

export async function inspectProject(p: Project): Promise<string> {
  const out: string[] = [`# ${p.name}`, `Status: ${p.status}, priority ${p.priority}. Goal: ${p.goal ?? "none set"}. Next step on file: ${p.next_action ?? "none"}.`];
  if (p.notes) out.push(`Notes: ${p.notes}`);
  const { briefHeader } = await import("@/lib/briefs");
  out.push(`\n${briefHeader(p as Parameters<typeof briefHeader>[0])}`);

  const { data: taskRows } = await db().from("tasks").select("*").eq("project_id", p.id);
  const tasks = (taskRows ?? []) as Task[];
  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done").sort((a, b) => String(b.done_at).localeCompare(String(a.done_at)));
  out.push(`\n## Tasks in Manager\nOpen (${open.length}): ${open.map((t) => `"${t.title}"${t.due ? ` due ${t.due.slice(0, 10)}` : ""}${t.status === "doing" ? " (in progress)" : ""}`).join("; ") || "none"}`);
  if (done.length) out.push(`Recently done: ${done.slice(0, 5).map((t) => `"${t.title}" ${day(t.done_at)}`).join("; ")}`);
  out.push(`Last touched in Manager: ${ago(p.last_touched_at)}.`);

  const localPath = (p as { local_path?: string | null }).local_path;
  if (localPath) {
    out.push("Its folder is on this PC: call check_project_activity to see what's running and what changed recently before saying how it's tracking.");
    const { localState, localStateText } = await import("@/lib/local-repos");
    const ls = await localState(localPath);
    out.push(ls ? `\n${localStateText(ls)}` : `\n## On this PC\nFolder ${localPath} isn't a git folder any more (moved or deleted?).`);
  }

  if (p.github_repo) {
    const repo = p.github_repo;
    const meta = await gh<{ default_branch: string; pushed_at: string; description: string | null; private: boolean }>(`repos/${repo}`);
    if (!meta) {
      out.push(`\n## Code (${repo})\nCouldn't read GitHub just now.${localPath ? " That's fine: use the folder on his PC above (read_project_file, check_project_activity)." : " Work from what you have; don't ask Thomas to connect anything or create a task about it."}`);
    } else {
      const branch = meta.default_branch;
      const [commits, issues, pulls, tree, readme, runs] = await Promise.all([
        gh<Commit[]>(`repos/${repo}/commits?per_page=12&sha=${branch}`),
        gh<Issue[]>(`repos/${repo}/issues?state=open&per_page=30`),
        gh<Issue[]>(`repos/${repo}/pulls?state=open&per_page=20`),
        gh<{ tree: TreeItem[] }>(`repos/${repo}/git/trees/${branch}?recursive=1`),
        gh<{ content?: string }>(`repos/${repo}/readme`),
        gh<{ workflow_runs: { name: string; conclusion: string | null; status: string; created_at: string }[] }>(`repos/${repo}/actions/runs?per_page=3&branch=${branch}`),
      ]);
      out.push(`\n## Code (${repo}, branch ${branch})`);
      if (meta.description) out.push(`Description: ${meta.description}`);
      out.push(`Last push: ${ago(meta.pushed_at)} (${day(meta.pushed_at)}).`);
      if (commits?.length) out.push(`Recent commits:\n${commits.map((c) => `- ${day(c.commit.author?.date)}: ${c.commit.message.split("\n")[0].slice(0, 120)}`).join("\n")}`);
      const realIssues = (issues ?? []).filter((i) => !i.pull_request);
      out.push(`Open issues (${realIssues.length}): ${realIssues.map((i) => `#${i.number} ${i.title}`).join("; ") || "none"}`);
      out.push(`Open pull requests (${pulls?.length ?? 0}): ${(pulls ?? []).map((i) => `#${i.number} ${i.title} (opened ${ago(i.created_at)})`).join("; ") || "none"}`);
      if (runs?.workflow_runs?.length) out.push(`Latest automated checks: ${runs.workflow_runs.map((r) => `${r.name}: ${r.conclusion ?? r.status} (${ago(r.created_at)})`).join("; ")}`);
      const files = (tree?.tree ?? []).filter((t) => t.type === "blob" && !SKIP.test(t.path));
      if (files.length) {
        const top = [...new Set(files.map((f) => f.path.split("/")[0]))].slice(0, 30);
        out.push(`Files: ${files.length} in total. Top level: ${top.join(", ")}`);
        const hasTests = files.some((f) => /(^|\/)(tests?|__tests__|spec)\/|(_test|\.test|\.spec)\.\w+$/.test(f.path));
        out.push(hasTests ? "Has automated tests." : "No automated tests found.");
        const t = await todos(repo, branch, tree!.tree);
        out.push(`TODO / FIXME notes in the code (${t.length}):${t.length ? "\n" + t.map((x) => `- ${x}`).join("\n") : " none found"}`);
      }
      if (readme?.content) out.push(`README (start):\n${Buffer.from(readme.content, "base64").toString("utf8").slice(0, 2500)}`);
    }
  } else {
    out.push(localPath ? "\n## Code\nThe code is in the folder on his PC above (no GitHub repo linked, that's fine)." : "\n## Code\nNo code linked to this project. That's fine for non-code projects; don't ask him to connect anything.");
  }

  if (p.vercel_project) {
    const s = (await getSignals([p]))[p.id]?.vercel;
    out.push(`\n## Website\n${s?.error ? "Couldn't check the live site just now (not important, don't ask Thomas about it)." : s?.state ? `Latest live deploy: ${s.state}${s.createdAt ? `, ${ago(s.createdAt)}` : ""}${s.url ? ` (${s.url})` : ""}.` : "No deploys found."}`);
  }
  return out.join("\n");
}
