// Local database server: a tiny PostgREST-compatible API so Manager runs on your own PC
// with no Supabase account. Supports exactly what the app uses.
//   node scripts/dev-rest.mjs                 -> built-in database (PGlite) stored in ./.localdb
//   DATABASE_URL=postgres://... node ...      -> use a real Postgres instead
//   node scripts/dev-rest.mjs --restore <backup.tar.gz>
//                                             -> bring back a backup from .localdb-backups. Only into an empty spot:
//                                                rename the current .localdb folder first (nothing is deleted).
// A backup of the built-in database is saved once a day to .localdb-backups (the last 14 are kept).
// Listens on :3001 (PORT_DB to change).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
let pool;

async function openDb() {
  if (process.env.DATABASE_URL) {
    const pg = (await import("pg")).default;
    pg.types.setTypeParser(1082, (v) => v); // keep dates as YYYY-MM-DD like PostgREST
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    return;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.LOCALDB_DIR || path.join(ROOT, ".localdb"); // tests use a throwaway folder
  const restoreAt = process.argv.indexOf("--restore");
  let loadDataDir;
  if (restoreAt !== -1) {
    const file = process.argv[restoreAt + 1];
    if (!file || !fs.existsSync(file)) { console.error("Give the backup file to restore: --restore .localdb-backups/<date>.tar.gz"); process.exit(1); }
    if (fs.existsSync(dir)) { console.error(`${dir} already exists. Rename it (for example to .localdb-old) and run this again. Nothing was changed.`); process.exit(1); }
    loadDataDir = new Blob([fs.readFileSync(file)]);
    console.log(`Restoring ${file} into ${dir}`);
  }
  const fresh = !fs.existsSync(dir) && !loadDataDir;
  const db = new PGlite(dir, { parsers: { 1082: (v) => v }, ...(loadDataDir ? { loadDataDir } : {}) });
  await db.waitReady;
  // Daily backup (a compressed copy of the whole database), newest 14 kept.
  const backupDir = process.env.LOCALDB_BACKUPS || path.join(ROOT, ".localdb-backups");
  const backup = async () => {
    try {
      fs.mkdirSync(backupDir, { recursive: true });
      const name = `${new Date().toISOString().slice(0, 10)}.tar.gz`;
      const target = path.join(backupDir, name);
      if (fs.existsSync(target)) return;
      const blob = await db.dumpDataDir("gzip");
      fs.writeFileSync(`${target}.part`, Buffer.from(await blob.arrayBuffer()));
      fs.renameSync(`${target}.part`, target);
      console.log("backed up the database to", target);
      const old = fs.readdirSync(backupDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.tar\.gz$/.test(f)).sort().slice(0, -14);
      for (const f of old) fs.unlinkSync(path.join(backupDir, f));
    } catch (e) { console.error("backup failed:", e.message); }
  };
  pool = { query: (sql, vals) => db.query(sql, vals) };
  // apply any migrations not yet applied, then seed a brand-new database
  await db.exec("create table if not exists _local_migrations (name text primary key, applied_at timestamptz default now())");
  const migDir = path.join(ROOT, "supabase", "migrations");
  const migrate = async () => {
    const done = new Set((await db.query("select name from _local_migrations")).rows.map((r) => r.name));
    for (const f of fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(migDir, f), "utf8").replace(/^create extension.*$/gim, "");
      // The change and the note that it's applied go in together, or neither does (no half-applied migrations).
      await db.transaction(async (tx) => {
        await tx.exec(sql);
        await tx.query("insert into _local_migrations (name) values ($1)", [f]);
      });
      console.log("applied", f);
    }
  };
  if (!fresh) await backup(); // before applying anything new
  await migrate();
  setInterval(() => { void backup(); }, 6 * 3600_000).unref();
  // after a `git pull` the new database changes apply by themselves, no restart needed
  setInterval(() => { migrate().catch((e) => console.error("migration failed:", e.message)); }, 15_000).unref();
  if (fresh) {
    await db.exec(fs.readFileSync(path.join(ROOT, "supabase", "seed.sql"), "utf8"));
    console.log("seeded your projects");
  }
}

const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;

function parseVal(v) {
  if (v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

function where(params, vals) {
  const out = [];
  for (const [k, raw] of params) {
    if (["select", "order", "limit", "offset", "columns", "on_conflict"].includes(k)) continue;
    const i = raw.indexOf(".");
    const op = raw.slice(0, i), v = raw.slice(i + 1);
    const col = ident(k);
    const ph = () => { vals.push(parseVal(v)); return `$${vals.length}`; };
    switch (op) {
      case "eq": out.push(`${col} = ${ph()}`); break;
      case "neq": out.push(`${col} <> ${ph()}`); break;
      case "gt": out.push(`${col} > ${ph()}`); break;
      case "gte": out.push(`${col} >= ${ph()}`); break;
      case "lt": out.push(`${col} < ${ph()}`); break;
      case "lte": out.push(`${col} <= ${ph()}`); break;
      case "is": out.push(`${col} is ${v === "null" ? "null" : v === "true" ? "true" : "false"}`); break;
      case "in": {
        const items = v.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, ""));
        vals.push(items);
        out.push(`${col}::text = any($${vals.length})`);
        break;
      }
      default: throw new Error(`unsupported op ${op}`);
    }
  }
  return out.length ? ` where ${out.join(" and ")}` : "";
}

function orderBy(params) {
  const o = params.get("order");
  if (!o) return "";
  return " order by " + o.split(",").map((part) => {
    const [c, dir, nulls] = part.split(".");
    return `${ident(c)} ${dir === "desc" ? "desc" : "asc"}${nulls ? ` ${nulls === "nullsfirst" ? "nulls first" : "nulls last"}` : ""}`;
  }).join(", ");
}

function cols(params) {
  const s = params.get("select");
  if (!s || s === "*") return "*";
  return s.split(",").map(ident).join(", ");
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const t = Buffer.concat(chunks).toString();
  return t ? JSON.parse(t) : null;
}

// Only MyManager itself may use the database: it sends this key (SUPABASE_SERVICE_ROLE_KEY). scripts/local.mjs
// makes a random one per PC, and coding helpers never get it, so they can't edit approvals behind the app's back.
const DB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const keyOk = (req) => {
  const k = String(req.headers["apikey"] ?? "") || String(req.headers["authorization"] ?? "").replace(/^Bearer\s+/i, "");
  if (!DB_KEY || k.length !== DB_KEY.length) return false;
  let d = 0;
  for (let i = 0; i < k.length; i++) d |= k.charCodeAt(i) ^ DB_KEY.charCodeAt(i);
  return d === 0;
};
// Database functions the app may call (supabase-js .rpc()). Listed here so nothing else can be called.
const RPC = new Set(["mm_queue_paid_action", "mm_claim_action", "mm_budget_used", "mm_create_invoice"]);

const server = http.createServer(async (req, res) => {
  try {
    if (!keyOk(req)) { res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ message: "Missing or wrong database key" })); return; }
    const url = new URL(req.url, "http://x");
    const rpc = url.pathname.match(/^\/(?:rest\/v1\/)?rpc\/([a-z_]+)$/);
    if (rpc) {
      if (req.method !== "POST" || !RPC.has(rpc[1])) { res.writeHead(404).end(); return; }
      const args = (await body(req)) ?? {};
      const keys = Object.keys(args).filter((k) => /^p_[a-z_]+$/.test(k));
      const v = keys.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
      const out = (await pool.query(`select * from ${ident(rpc[1])}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, v)).rows;
      // a function that returns one value comes back as that value, like PostgREST
      const scalar = out.length === 1 && Object.keys(out[0]).length === 1 && Object.keys(out[0])[0] === rpc[1];
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(scalar ? out[0][rpc[1]] : out));
      return;
    }
    const table = ident(url.pathname.replace(/^\/(rest\/v1\/)?/, ""));
    const p = url.searchParams;
    const prefer = req.headers["prefer"] ?? "";
    const accept = req.headers["accept"] ?? "";
    const vals = [];
    let sql, rows, count = null;

    if (req.method === "GET" || req.method === "HEAD") {
      const w = where(p, vals);
      sql = `select ${cols(p)} from ${table}${w}${orderBy(p)}${p.get("limit") ? ` limit ${Number(p.get("limit"))}` : ""}`;
      rows = req.method === "HEAD" ? [] : (await pool.query(sql, vals)).rows;
      if (prefer.includes("count=exact")) count = Number((await pool.query(`select count(*) from ${table}${w}`, vals)).rows[0].count);
    } else if (req.method === "POST") {
      const b = await body(req);
      const list = Array.isArray(b) ? b : [b];
      rows = [];
      for (const r of list) {
        const keys = Object.keys(r);
        const v = keys.map((k) => (r[k] !== null && typeof r[k] === "object" ? JSON.stringify(r[k]) : r[k]));
        const q = keys.length
          ? `insert into ${table} (${keys.map(ident).join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning ${cols(p)}`
          : `insert into ${table} default values returning ${cols(p)}`;
        rows.push(...(await pool.query(q, v)).rows);
      }
    } else if (req.method === "PATCH") {
      const b = await body(req);
      const keys = Object.keys(b);
      keys.forEach((k) => vals.push(b[k] !== null && typeof b[k] === "object" ? JSON.stringify(b[k]) : b[k]));
      const set = keys.map((k, i) => `${ident(k)} = $${i + 1}`).join(", ");
      sql = `update ${table} set ${set}${where(p, vals)} returning ${cols(p)}`;
      rows = (await pool.query(sql, vals)).rows;
    } else if (req.method === "DELETE") {
      sql = `delete from ${table}${where(p, vals)} returning *`;
      rows = (await pool.query(sql, vals)).rows;
    } else {
      res.writeHead(405).end();
      return;
    }

    const headers = { "Content-Type": "application/json" };
    if (count !== null) headers["Content-Range"] = `0-${Math.max(0, rows.length - 1)}/${count}`;
    if (accept.includes("vnd.pgrst.object")) {
      if (rows.length !== 1) {
        res.writeHead(406, headers).end(JSON.stringify({ message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" }));
        return;
      }
      res.writeHead(200, headers).end(JSON.stringify(rows[0]));
      return;
    }
    res.writeHead(req.method === "POST" ? 201 : 200, headers).end(req.method === "HEAD" ? undefined : JSON.stringify(rows));
  } catch (e) {
    res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ message: String(e.message ?? e) }));
  }
});

await openDb();
const PORT = Number(process.env.PORT_DB ?? 3001);
server.listen(PORT, "127.0.0.1", () => console.log(`Manager database ready on :${PORT}`));
