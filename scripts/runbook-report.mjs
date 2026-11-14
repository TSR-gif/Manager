#!/usr/bin/env node
// Plain report of MyManager's recent runbooks and what each step said, for working out why something got stuck.
// Read-only. Uses MyManager's own settings to reach its local database, and never prints them.
// Usage (MyManager must be running): node scripts/runbook-report.mjs [how many, default 6]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.env.MM_ROOT || path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
let key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!key || key === "local") key = crypto.createHash("sha256").update(`${env.AUTH_SECRET}:local-db`).digest("hex");
const base = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const n = Number(process.argv[2]) || 6;
const get = async (q) => { const r = await fetch(`${base}/rest/v1/${q}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }); if (!r.ok) throw new Error(`${r.status} ${await r.text()}`); return r.json(); };
const runbooks = await get(`runbooks?select=id,title,status,last_update,created_at,project_id,work_dir,steps&order=created_at.desc&limit=${n}`);
const projects = await get("projects?select=id,name,vercel_project,local_path");
const pname = (id) => projects.find((p) => p.id === id);
for (const r of runbooks) {
  const p = pname(r.project_id);
  console.log(`\n# ${r.title}  [${r.status}]  ${r.created_at}  id ${r.id.slice(0, 8)}`);
  console.log(`  project: ${p ? `${p.name} (vercel: ${p.vercel_project ?? "none"}, folder: ${p.local_path ?? "none"})` : "none"}  work_dir: ${r.work_dir ?? "none"}`);
  if (r.last_update) console.log(`  where it's at: ${r.last_update}`);
  for (const s of r.steps?.list ?? []) {
    console.log(`  - ${s.id} ${s.kind} [${s.status}${s.fixing ? ", assistant looking" : ""}${s.approval_id ? ", waiting on approval" : ""}] ${s.label}${s.command ? `  \`${s.command}\`` : ""}`);
    if (s.note) console.log(`      note: ${s.note}`);
    if (s.error) console.log(`      error: ${s.error}`);
  }
}
const acts = await get("actions?select=kind,title,status,created_at&status=eq.pending&order=created_at.desc&limit=10");
console.log(`\n# Waiting in Approvals: ${acts.length}`);
for (const a of acts) console.log(`  - ${a.kind}: ${a.title}`);
