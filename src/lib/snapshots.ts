import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { gh } from "@/lib/inspect";
import { parseCopyDump, unzip } from "@/lib/data-files.mjs";

/**
 * Live data of Thomas's apps, read-only, without MyManager holding any database password: apps like TS Rail back up
 * their Supabase database to GitHub every week (a "supabase-backup-YYYY-MM-DD-database" artifact). MyManager downloads
 * the newest one with the GitHub sign-in already on this PC into .localdb-snapshots/ (never committed, never uploaded)
 * and reads its tables. Nothing is ever written to the app or its database.
 */
const DIR = path.join(process.cwd(), ".localdb-snapshots");
type Tables = Record<string, { columns: string[]; rows: (string | null)[][] }>;
interface Artifact { id: number; name: string; created_at: string; expired: boolean; size_in_bytes: number }
const cache = new Map<string, { id: number; tables: Tables }>();

const file = (repo: string) => path.join(DIR, `${repo.replace(/[^a-z0-9]+/gi, "-")}.zip`);

/** The newest database backup artifact of a repo, if it has any. */
async function newestBackup(repo: string) {
  const r = await gh<{ artifacts: Artifact[] }>(`repos/${repo}/actions/artifacts?per_page=50`);
  return (r?.artifacts ?? []).filter((a) => !a.expired && /^supabase-backup-.*-database$/.test(a.name))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

function download(repo: string, id: number) {
  return new Promise<Buffer>((resolve, reject) => {
    execFile(process.platform === "win32" ? "gh.exe" : "gh", ["api", `repos/${repo}/actions/artifacts/${id}/zip`],
      { encoding: "buffer", maxBuffer: 512 << 20, timeout: 120_000, windowsHide: true }, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

/** The tables of the newest backup (downloaded once per new backup). null when the app has no backups to read. */
export async function snapshotTables(repo: string): Promise<{ date: string; tables: Tables } | { error: string }> {
  const a = await newestBackup(repo);
  if (!a) return { error: `${repo} has no database backups on GitHub to read (its weekly backup isn't saving anything yet).` };
  const meta = `${file(repo)}.json`;
  let zip: Buffer | null = null;
  try { if (JSON.parse(fs.readFileSync(meta, "utf8")).id === a.id) zip = fs.readFileSync(file(repo)); } catch { /* not downloaded yet */ }
  if (!zip) {
    try { zip = await download(repo, a.id); } catch (e) { return { error: `Couldn't download the backup: ${String(e).slice(0, 200)}` }; }
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(file(repo), zip);
    fs.writeFileSync(meta, JSON.stringify({ id: a.id, name: a.name, created_at: a.created_at }));
  }
  const hit = cache.get(repo);
  if (hit?.id !== a.id) {
    const entries = unzip(zip);
    const name = [...entries.keys()].find((n) => /(^|\/)data\.sql$/.test(n));
    if (!name) return { error: "The backup has no data.sql in it." };
    cache.set(repo, { id: a.id, tables: parseCopyDump(entries.get(name)!().toString("utf8")) });
  }
  return { date: a.created_at.slice(0, 10), tables: cache.get(repo)!.tables };
}

/** Text for the assistant: every table with its columns and row count, or up to 200 rows of one table. */
export async function snapshotText(repo: string, table: string | null, offset = 0) {
  const s = await snapshotTables(repo);
  if ("error" in s) return s.error;
  const names = Object.keys(s.tables).sort();
  if (!table) return `Backup of ${repo} from ${s.date} (read-only copy on this PC). ${names.length} tables:\n${names.map((n) => `- ${n} (${s.tables[n].rows.length} rows): ${s.tables[n].columns.join(", ")}`).join("\n")}`;
  const key = names.find((n) => n === table || n === `public.${table}`);
  if (!key) return `No table "${table}". Tables: ${names.join(", ")}`;
  const t = s.tables[key];
  const rows = t.rows.slice(offset, offset + 200);
  const cell = (v: string | null) => (v === null ? "" : v.replace(/\s+/g, " ").slice(0, 200));
  return [`${key} from the ${s.date} backup: rows ${offset + 1} to ${offset + rows.length} of ${t.rows.length}`, t.columns.join("\t"), ...rows.map((r) => r.map(cell).join("\t")),
    ...(offset + rows.length < t.rows.length ? [`… ask again with offset ${offset + rows.length} for more`] : [])].join("\n");
}
