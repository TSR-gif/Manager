import "server-only";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";
import { db } from "@/lib/db";
import { workbookText } from "@/lib/data-files.mjs";
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
  knowledge?: string | null; knowledge_updated_at?: string | null; data_paths?: string | null;
}

export const hasCode = (p: BriefProject) => !!(p.github_repo || p.local_path);
const dataPaths = (p: BriefProject) => (p.data_paths ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

/** Newest change time of the files in a project's data folders (a few levels down), so a restudy happens when the data moves on. */
function newestData(p: BriefProject) {
  let newest = 0, seen = 0;
  const visit = (f: string, depth: number) => {
    if (seen++ > 3000) return;
    let st: fs.Stats;
    try { st = fs.statSync(f); } catch { return; }
    if (!st.isDirectory()) { newest = Math.max(newest, st.mtimeMs); return; }
    if (depth > 0) for (const n of fs.readdirSync(f)) if (!n.startsWith(".") && n !== "node_modules") visit(path.join(f, n), depth - 1);
  };
  for (const d of dataPaths(p)) visit(d, 3);
  return newest;
}

const SECRET_FILE = /(^|\/)\.env(\.|$)|secret|credential|\.pem$|\.key$|(^|\/)\.(ssh|aws)\/|Login Data|Cookies/i;
const TEXT_EXT = new Set([".csv", ".tsv", ".sql", ".json", ".txt", ".md", ".log", ".xml"]);
/** Read one data file anywhere in Thomas's user folder, read-only: workbooks (with their macros) or text exports. */
export function readDataFile(file: string, sheet: string | null, fromRow = 1): string {
  let real: string, home: string;
  try { real = fs.realpathSync.native(path.resolve(file)); home = fs.realpathSync.native(os.homedir()); } catch { return `Couldn't find ${file}.`; }
  const rel = path.relative(home, real);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return "Only files in Thomas's user folder can be read.";
  if (SECRET_FILE.test(rel.replace(/\\/g, "/"))) return "Secret files are never read.";
  const st = fs.statSync(real);
  if (st.isDirectory()) return "That's a folder: list it with Glob or LS, then read the files in it.";
  if (st.size > 60 << 20) return "That file is too big to read here.";
  const ext = path.extname(real).toLowerCase();
  try {
    if (ext === ".xlsx" || ext === ".xlsm") return workbookText(fs.readFileSync(real), sheet, fromRow);
    if (ext === ".xls") return "Old .xls workbooks can't be read here. If it matters, ask Thomas to save a copy as .xlsx.";
    if (ext === ".pdf") {
      // pdftotext comes with Git for Windows; "-" prints the text instead of writing a file
      for (const bin of ["pdftotext", "C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe"]) {
        try {
          const t = execFileSync(bin, ["-layout", "-l", "30", real, "-"], { timeout: 30_000, maxBuffer: 16 << 20, windowsHide: true }).toString("utf8");
          return t.length > MAX ? `${t.slice(0, MAX)}\n…(cut, ${t.length} characters in total)` : t || "(no text in this PDF: it may be a scan)";
        } catch { /* try the next one */ }
      }
      return "Couldn't read this PDF here (pdftotext isn't on this PC). Try the Read tool.";
    }
    if (TEXT_EXT.has(ext)) { const t = fs.readFileSync(real, "utf8"); return t.length > MAX ? `${t.slice(0, MAX)}\n…(cut, ${t.length} characters in total)` : t; }
  } catch (e) { return `Couldn't read it: ${String(e).slice(0, 200)}`; }
  return "Read images with the Read tool. Other kinds of file can't be read here.";
}

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

export function knowledgeSections() {
  return `## What it knows about Thomas's business and life
(the real facts the app's data holds, with dates and numbers: e.g. clients, jobs, invoices paid and outstanding, money in and out by year, workers and hours, schedules, bets, points. Say how current the data is.)
## How the data is laid out
(tables / sheets, what each holds, key fields, how they link, which formulas or macros do the work)
## Where it lives
(code, database, files on his PC, hosting, domains, backups, and whether backups really work)
## Unfinished or broken
(real problems seen in the code or data: half-built features, errors, stale or duplicated files, data that stopped being entered)
## Needs Thomas
(only things only he can do or decide, each one line, most important first; "nothing" if none)
## Keep an eye on
(signals worth checking regularly, e.g. invoices going overdue, a backup that stops, a site that's down)`;
}

export function studyGoal(p: BriefProject) {
  const paths = dataPaths(p);
  return `Study the ${p.name} project in depth. Thomas: "The whole idea is for this to automate my day to day life." His apps hold a lot about his business and life, and you need to really understand each one: what it does, what its data says, where it lives, and what's broken. Skimming a README is not enough. Everything here is READ-ONLY: never change, move or delete anything, and never run anything that writes.
1. Call inspect_project("${p.name}").
2. ${hasCode(p) ? "Read the code with read_project_file: README/CLAUDE.md, the package or requirements file, entry points, config and hosting files (vercel.json, workflows), the database scripts or migrations (they show every table), and the core source files for each feature. Read as much as you need to really understand it, often 15 to 30 files. Never secrets or .env files." : "There's no code linked. Work from what Thomas has written and the data you can find."}
3. Find the data. ${paths.length ? `Its data is in: ${paths.join("; ")}. Check for new files there too.` : `Look for folders and files about ${p.name} on his PC with Glob (OneDrive, Documents, Desktop, Downloads), e.g. a company folder, spreadsheets, exports, invoices, reports.`} Also look for the project's code on his PC (an old copy or a folder named after it) and for stray copies of its data files. Read every current spreadsheet you find with read_data_file, not just one (it shows each sheet's first and last rows, formulas and the macros' code). The overview hides middle rows, so for the sheets that hold money, people, jobs or dates, ask for the whole sheet (sheet name, then from_row for more). Read PDFs with read_data_file too; for many similar PDFs (daily reports, invoices), read the newest one or two.${p.github_repo ? ` Call read_app_data("${p.name}", null) for the live app data from its weekly database backup, then read the tables that matter (money, clients, jobs, people, dates).` : ""}
4. Work out the real facts: totals, what's outstanding or overdue, what's recent, what stopped. Check your sums.
5. Call save_project_knowledge with data_paths (the folders/files that hold this project's data: full paths only, one per line, no notes, never a whole general folder like Downloads or Documents; or null) and the knowledge in this shape, plain words, specific, no guessing ("not sure" where you can't tell):
${knowledgeSections()}
${hasCode(p) ? `6. Call save_project_brief with the brief in this shape (it's written into the project's folder, so NO money figures, client or worker names, or personal details in it: those go in the knowledge only):
${briefSections()}` : "6. Don't write a brief (there's no code)."}
${p.rules ? `\nThomas's own rules for this project (respect them, don't copy them): ${p.rules}` : ""}
${p.knowledge ? `\nWhat you worked out last time (${p.knowledge_updated_at?.slice(0, 10) ?? "earlier"}). Check it against what's there now and update it:\n${p.knowledge}` : ""}
${p.brief ? `\nThe current brief is below.${p.brief_edited_by_you ? " Thomas corrected it himself: keep his corrections unless the code clearly shows they're now out of date." : ""} Update it rather than starting over:\n${p.brief}` : ""}
This runs in the background with nobody watching, so don't ask questions or offer to do things: put anything for Thomas under "Needs Thomas". Finish with one line saying what you learned that's new.`;
}

let studying = false;
/** Study one project now, in depth (saves the knowledge and the brief through their tools). */
export async function studyProject(id: string) {
  const { data } = await db().from("projects").select("*").eq("id", id).maybeSingle();
  const p = data as BriefProject | null;
  if (!p) return null;
  const sha = await latestCommit(p);
  const started = Date.now();
  const runId = await runAgent(studyGoal(p), () => {}, undefined, { kind: "study" });
  // Only mark the brief as up to date with this commit if a new brief really got saved during the run.
  const { data: after } = await db().from("projects").select("brief_updated_at").eq("id", id).maybeSingle();
  const saved = after?.brief_updated_at && new Date(after.brief_updated_at as string).getTime() >= started;
  if (sha && saved) await db().from("projects").update({ brief_commit: sha }).eq("id", id);
  return runId;
}

/** From the tick: study at most one project per pass: never studied in depth, or its code or data has moved on (or a week has passed). */
export async function refreshDueBriefs() {
  if (studying) return null;
  studying = true;
  try {
    const { data } = await db().from("projects").select("id,name,github_repo,local_path,brief,brief_updated_at,brief_commit,knowledge_updated_at,data_paths,status").in("status", ["active", "paused"]);
    const list = (data ?? []) as (BriefProject & { status: string })[];
    const missing = list.find((p) => !p.knowledge_updated_at) ?? list.find((p) => hasCode(p) && !p.brief);
    if (missing) return { project: missing.name, runId: await studyProject(missing.id) };
    for (const p of list) {
      const studied = new Date(p.knowledge_updated_at!).getTime();
      const age = Date.now() - studied;
      if (age < 12 * 3600_000) continue;
      const sha = hasCode(p) ? await latestCommit(p) : null;
      const moved = (sha && sha !== p.brief_commit) || (age > 86_400_000 && newestData(p) > studied) || (age > 7 * 86_400_000 && (hasCode(p) || dataPaths(p).length > 0));
      if (moved) return { project: p.name, runId: await studyProject(p.id) };
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
