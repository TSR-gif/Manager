import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

/**
 * What a project is doing right now on Thomas's PC, read-only: programs running from its folder,
 * files that changed recently (data, results, logs), the end of its newest logs, and scheduled
 * Windows tasks that run it. Nothing is started, stopped or changed.
 */
const run = promisify(execFile);
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "__pycache__", ".venv", "venv", "env", ".mypy_cache", ".pytest_cache", "dist", "build", ".idea", ".vscode"]);
const SECRET = /(^|[\\/])\.env(\.|$)|secret|credential|\.pem$|\.key$|token/i;
const LOGLIKE = /\.(log|out|err|txt|jsonl)$/i;
const DATALIKE = /\.(csv|json|parquet|feather|pkl|db|sqlite|xlsx)$/i;

interface Proc { pid: number; name: string; started: string | null; cmd: string }

async function processes(dir: string): Promise<Proc[]> {
  const top = new Set<string>();
  try { for (const n of fs.readdirSync(dir)) if (/\.(py|js|mjs|ts|bat|cmd|ps1|sh)$/i.test(n)) top.add(n.toLowerCase()); } catch { /* ignore */ }
  const lowDir = path.resolve(dir).toLowerCase();
  const mine = (cmd: string) => {
    const c = cmd.toLowerCase();
    if (c.includes(lowDir) || c.includes(lowDir.replace(/\\/g, "/"))) return true;
    // `py backtest.py` started from inside the folder: the command line only has the script name
    return /\b(py|python\d*(\.exe)?|pythonw|node(\.exe)?|npm|npx)\b/.test(c) && [...top].some((f) => c.includes(f));
  };
  const list: Proc[] = [];
  try {
    if (process.platform === "win32") {
      const ps = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | Select-Object ProcessId,Name,CommandLine,@{n='Started';e={if($_.CreationDate){$_.CreationDate.ToString('o')}}} | ConvertTo-Json -Compress";
      const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { timeout: 20_000, maxBuffer: 16 << 20, windowsHide: true });
      const rows = JSON.parse(stdout || "[]") as { ProcessId: number; Name: string; CommandLine: string; Started?: string }[];
      for (const r of Array.isArray(rows) ? rows : [rows]) if (mine(r.CommandLine)) list.push({ pid: r.ProcessId, name: r.Name, started: r.Started ?? null, cmd: r.CommandLine });
    } else {
      const { stdout } = await run("ps", ["-eo", "pid=,lstart=,args="], { timeout: 10_000, maxBuffer: 8 << 20 });
      for (const line of stdout.split("\n")) {
        const m = line.trim().match(/^(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/);
        if (!m) continue;
        let cwd = "";
        try { cwd = fs.readlinkSync(`/proc/${m[1]}/cwd`).toLowerCase(); } catch { /* not ours */ }
        if (mine(m[3]) || (cwd.startsWith(lowDir) && /\b(py|python|node|npm)/.test(m[3]))) list.push({ pid: Number(m[1]), name: m[3].split(/\s+/)[0], started: new Date(m[2]).toISOString(), cmd: m[3] });
      }
    }
  } catch { /* can't list processes: say so below */ return [{ pid: -1, name: "", started: null, cmd: "" }]; }
  return list.filter((p) => p.pid !== process.pid && !/check_project_activity|Get-CimInstance/.test(p.cmd)).slice(0, 15);
}

async function scheduled(dir: string): Promise<string[]> {
  if (process.platform !== "win32") return [];
  const leaf = path.basename(dir).replace(/'/g, "''");
  const ps = `Get-ScheduledTask | Where-Object { ($_.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments) $($_.WorkingDirectory)" }) -match [regex]::Escape('${leaf}') } | ForEach-Object { $i = $_ | Get-ScheduledTaskInfo; "$($_.TaskName): $($_.State), last run $($i.LastRunTime), result $($i.LastTaskResult), next run $($i.NextRunTime)" }`;
  try {
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { timeout: 20_000, windowsHide: true });
    return stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 10);
  } catch { return []; }
}

interface F { rel: string; mtime: number; size: number }
function recentFiles(dir: string, sinceMs: number): F[] {
  const out: F[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 4 || out.length > 4000) return;
    let names: fs.Dirent[];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const n of names) {
      if (n.name.startsWith(".") && n.name !== ".github") continue;
      const full = path.join(d, n.name);
      if (n.isDirectory()) { if (!SKIP_DIRS.has(n.name)) walk(full, depth + 1); continue; }
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs >= sinceMs) out.push({ rel: path.relative(dir, full).replace(/\\/g, "/"), mtime: st.mtimeMs, size: st.size });
      } catch { /* ignore */ }
    }
  };
  walk(dir, 0);
  return out.filter((f) => !SECRET.test(f.rel) && !/\.bak\w*$/i.test(f.rel)).sort((a, b) => b.mtime - a.mtime);
}

function tail(full: string, lines: number) {
  try {
    const st = fs.statSync(full);
    const len = Math.min(st.size, 64 * 1024);
    const fd = fs.openSync(full, "r");
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    return buf.toString("utf8").split(/\r?\n/).filter((l) => l.trim()).slice(-lines).map((l) => l.slice(0, 300)).join("\n");
  } catch { return ""; }
}

const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const size = (b: number) => (b > 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : b > 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);

/** A plain-text report for the assistant. */
export async function projectActivity(dir: string, hours = 48): Promise<string> {
  if (!fs.existsSync(dir)) return `The folder ${dir} isn't on this PC any more (moved or deleted?).`;
  const [procs, tasks] = await Promise.all([processes(dir), scheduled(dir)]);
  const files = recentFiles(dir, Date.now() - hours * 3600_000);
  const out: string[] = [`# Activity in ${dir} (checked ${new Date().toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })})`];

  if (procs[0]?.pid === -1) out.push("## Running now\nCouldn't list running programs on this PC.");
  else out.push(`## Running now (${procs.length})\n${procs.length ? procs.map((p) => `- ${p.name} (pid ${p.pid}${p.started ? `, started ${ago(new Date(p.started).getTime())}` : ""}): ${p.cmd.slice(0, 220)}`).join("\n") : "Nothing from this folder is running right now."}`);
  if (tasks.length) out.push(`## Scheduled in Windows\n${tasks.map((t) => `- ${t}`).join("\n")}`);

  const newest = files[0];
  out.push(`## Files changed in the last ${hours} hours (${files.length})${newest ? `, newest ${ago(newest.mtime)}` : ""}`);
  if (files.length) {
    const byDir = new Map<string, F[]>();
    for (const f of files) { const k = f.rel.includes("/") ? f.rel.split("/")[0] + "/" : "(top folder)"; byDir.set(k, [...(byDir.get(k) ?? []), f]); }
    for (const [k, fs_] of [...byDir].slice(0, 12)) out.push(`- ${k}: ${fs_.length} file${fs_.length > 1 ? "s" : ""}, e.g. ${fs_.slice(0, 4).map((f) => `${f.rel} (${ago(f.mtime)}, ${size(f.size)})`).join("; ")}`);
  } else {
    out.push("Nothing changed. If a test or data download should be running, it may have stopped.");
  }

  const logs = files.filter((f) => LOGLIKE.test(f.rel) && !/requirements|readme|license/i.test(f.rel)).slice(0, 3);
  for (const l of logs) out.push(`## End of ${l.rel} (${ago(l.mtime)})\n${tail(path.join(dir, l.rel), 25)}`);
  const data = files.filter((f) => DATALIKE.test(f.rel) && /\.(csv|jsonl?)$/i.test(f.rel)).slice(0, 2);
  for (const d of data) out.push(`## Last rows of ${d.rel} (${ago(d.mtime)}, ${size(d.size)})\n${tail(path.join(dir, d.rel), 4)}`);
  return out.join("\n\n");
}
