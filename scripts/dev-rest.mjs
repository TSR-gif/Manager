// Dev-only: a tiny PostgREST-compatible server over a local Postgres, so the app can be
// run and screenshotted without a Supabase project. Supports exactly what the app uses.
// Usage: DATABASE_URL=postgres://... node scripts/dev-rest.mjs   (listens on :3001)
import http from "node:http";
import pg from "pg";

pg.types.setTypeParser(1082, (v) => v); // keep dates as YYYY-MM-DD like PostgREST
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
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

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
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
}).listen(3001, () => console.log("dev-rest on :3001"));
