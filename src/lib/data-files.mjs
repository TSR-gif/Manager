// Reads the data files Thomas's apps keep (Excel workbooks with macros, database dumps) into plain text, read-only.
// No dependencies: xlsx/xlsm and zip are unpacked with node:zlib, VBA macros are decoded from vbaProject.bin.
// Plain .mjs so the tests can load it directly (tests/data-files.test.mjs).
import zlib from "node:zlib";

// ---------- zip ----------
/** Entries of a zip file: name -> () => Buffer. shortcut: no zip64, so zips over 4 GB won't open; fine for workbooks and weekly DB dumps. */
export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Not a zip file.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    out.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return method === 0 ? data : zlib.inflateRawSync(data);
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---------- spreadsheets ----------
const xmlText = (s) => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const colNum = (ref) => [...ref.replace(/\d+/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function excelDate(serial) {
  const d = new Date(Math.round((serial - 25569) * 86_400_000)); // 25569 = days from 1899-12-30 to 1970-01-01
  const iso = d.toISOString();
  return serial % 1 ? iso.slice(0, 16).replace("T", " ") : iso.slice(0, 10);
}

/** Every sheet of a workbook as rows of cells: { name, rows: [{ r, cells: [{ ref, v, f }] }] }. Dates come out as YYYY-MM-DD. */
export function readWorkbook(buf) {
  const z = unzip(buf);
  const get = (n) => (z.has(n) ? z.get(n)().toString("utf8") : "");
  const shared = [...get("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, "")));
  const styles = get("xl/styles.xml");
  const customDate = new Set([...styles.matchAll(/<numFmt [^>]*>/g)].filter((m) => /[dmy]/i.test(xmlText(attr(m[0], "formatCode") ?? "").replace(/"[^"]*"|\[[^\]]*\]/g, ""))).map((m) => Number(attr(m[0], "numFmtId"))));
  const xfs = (styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "").match(/<xf [^>]*>/g) ?? [];
  const isDate = xfs.map((x) => { const id = Number(attr(x, "numFmtId") ?? 0); return DATE_IDS.has(id) || customDate.has(id); });
  const rels = new Map([...get("xl/_rels/workbook.xml.rels").matchAll(/<Relationship [^>]*>/g)].map((m) => [attr(m[0], "Id"), attr(m[0], "Target")]));
  const sheets = [];
  for (const m of get("xl/workbook.xml").matchAll(/<sheet [^>]*>/g)) {
    const target = rels.get(attr(m[0], "r:id")) ?? "";
    const file = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const xml = get(file);
    const rows = [];
    for (const row of xml.matchAll(/<row [^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells = [];
      for (const c of (row[1] ?? "").matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = ` ${c[1]}`, inner = c[2] ?? "";
        const t = attr(tag, "t"), raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const f = inner.match(/<f[^>]*>([\s\S]*?)<\/f>/)?.[1];
        let v = raw === undefined ? undefined : xmlText(raw);
        if (t === "s" && v !== undefined) v = shared[Number(v)];
        else if (t === "inlineStr") v = xmlText(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? "");
        else if (t === "b") v = v === "1" ? "TRUE" : "FALSE";
        else if (!t && v !== undefined && isDate[Number(attr(tag, "s") ?? 0)] && !isNaN(Number(v))) v = excelDate(Number(v));
        if ((v === undefined || v === "") && !f) continue;
        cells.push({ ref: attr(tag, "r") ?? "", v: v ?? "", f: f ? xmlText(f) : undefined });
      }
      if (cells.length) rows.push({ r: Number(attr(row[0], "r")), cells });
    }
    sheets.push({ name: xmlText(attr(m[0], "name") ?? "?"), dim: xml.match(/<dimension ref="([^"]+)"/)?.[1] ?? "", rows });
  }
  const vbaBin = [...z.keys()].find((n) => /vbaProject\.bin$/i.test(n));
  return { sheets, vba: vbaBin ? z.get(vbaBin)() : null };
}

const rowText = (row) => `${row.r}: ${row.cells.sort((a, b) => colNum(a.ref) - colNum(b.ref)).map((c) => `${c.ref}=${String(c.v).replace(/\s+/g, " ").slice(0, 120)}${c.f ? ` [=${c.f.slice(0, 120)}]` : ""}`).join(" | ")}`;

/**
 * A workbook as text the assistant can read. No sheet: an overview of every sheet (first and last rows) and the macros.
 * With a sheet: up to 300 rows of it from fromRow.
 */
export function workbookText(buf, sheet = null, fromRow = 1, max = 40_000) {
  const wb = readWorkbook(buf);
  const out = [];
  if (sheet) {
    const s = wb.sheets.find((x) => x.name.toLowerCase() === String(sheet).toLowerCase());
    if (!s) return `No sheet called "${sheet}". Sheets: ${wb.sheets.map((x) => x.name).join(", ")}`;
    const rows = s.rows.filter((r) => r.r >= (fromRow || 1)).slice(0, 300);
    out.push(`# Sheet "${s.name}" (${s.dim}, ${s.rows.length} rows with something in them)`, ...rows.map(rowText));
    if (rows.length === 300) out.push(`… more rows: ask again with from_row ${rows[rows.length - 1].r + 1}`);
  } else {
    out.push(`Workbook with ${wb.sheets.length} sheets. Cells show as REF=value [=formula]. Ask for one sheet to see more of its rows.`);
    for (const s of wb.sheets) {
      out.push(`\n## Sheet "${s.name}" (${s.dim || "empty"}, ${s.rows.length} rows with something in them)`);
      const head = s.rows.slice(0, 25), tail = s.rows.length > 35 ? s.rows.slice(-8) : s.rows.slice(25);
      out.push(...head.map(rowText));
      if (s.rows.length > 35) out.push(`… ${s.rows.length - 33} rows not shown …`);
      out.push(...tail.map(rowText));
    }
    if (wb.vba) {
      try {
        const mods = vbaModules(wb.vba);
        out.push(`\n## Macros (VBA), ${mods.length} modules`);
        for (const m of mods) out.push(`\n### ${m.name}\n${m.code.trim() || "(empty)"}`);
      } catch (e) { out.push(`\n## Macros\nThe workbook has macros but they couldn't be read: ${e.message}`); }
    }
  }
  const text = out.join("\n");
  return text.length > max ? `${text.slice(0, max)}\n…(cut, ${text.length} characters in total; ask for one sheet at a time)` : text;
}

// ---------- VBA macros (MS-CFB container + MS-OVBA compression) ----------
/** MS-OVBA decompression of a compressed container. */
export function ovbaDecompress(buf) {
  if (buf[0] !== 1) throw new Error("not a VBA compressed stream");
  const out = [];
  let i = 1;
  while (i + 1 < buf.length) {
    const hdr = buf.readUInt16LE(i);
    const end = Math.min(i + (hdr & 0x0fff) + 3, buf.length);
    const start = out.length;
    i += 2;
    if (!(hdr & 0x8000)) { while (i < end) out.push(buf[i++]); continue; }
    while (i < end) {
      const flags = buf[i++];
      for (let b = 0; b < 8 && i < end; b++) {
        if (!(flags & (1 << b))) { out.push(buf[i++]); continue; }
        const token = buf.readUInt16LE(i); i += 2;
        let bits = 4;
        while ((1 << bits) < out.length - start) bits++;
        const lenMask = 0xffff >> bits;
        const len = (token & lenMask) + 3, off = (token >> (16 - bits)) + 1;
        for (let k = 0; k < len; k++) out.push(out[out.length - off]);
      }
    }
  }
  return Buffer.from(out);
}

/** Streams of a compound file (vbaProject.bin), by name. shortcut: looks streams up by name, not by folder; fine for VBA projects. */
function cfbStreams(buf) {
  const ss = 1 << buf.readUInt16LE(30), mss = 1 << buf.readUInt16LE(32);
  const sec = (id) => buf.subarray((id + 1) * ss, (id + 2) * ss);
  const difat = [];
  for (let k = 0; k < 109; k++) difat.push(buf.readUInt32LE(76 + k * 4));
  for (let d = buf.readUInt32LE(68), n = buf.readUInt32LE(72); n > 0 && d < 0xfffffffa; n--) {
    const s = sec(d);
    for (let k = 0; k < ss / 4 - 1; k++) difat.push(s.readUInt32LE(k * 4));
    d = s.readUInt32LE(ss - 4);
  }
  const fat = [];
  for (const id of difat.slice(0, buf.readUInt32LE(44))) { const s = sec(id); for (let k = 0; k < ss / 4; k++) fat.push(s.readUInt32LE(k * 4)); }
  const chain = (start, table) => { const ids = []; for (let id = start; id < 0xfffffffa && ids.length < table.length; id = table[id]) ids.push(id); return ids; };
  const big = (start) => Buffer.concat(chain(start, fat).map(sec));
  const dir = big(buf.readUInt32LE(48));
  const entries = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nl = dir.readUInt16LE(o + 64);
    entries.push({ name: dir.toString("utf16le", o, o + Math.max(0, nl - 2)), type: dir[o + 66], start: dir.readUInt32LE(o + 116), size: dir.readUInt32LE(o + 120) });
  }
  const root = entries[0];
  const mini = big(root.start);
  const minifatRaw = buf.readUInt32LE(60) < 0xfffffffa ? big(buf.readUInt32LE(60)) : Buffer.alloc(0);
  const minifat = []; for (let k = 0; k + 4 <= minifatRaw.length; k += 4) minifat.push(minifatRaw.readUInt32LE(k));
  const cutoff = buf.readUInt32LE(56);
  const read = (e) => (e.size < cutoff
    ? Buffer.concat(chain(e.start, minifat).map((id) => mini.subarray(id * mss, (id + 1) * mss)))
    : big(e.start)).subarray(0, e.size);
  return new Map(entries.filter((e) => e.type === 2).map((e) => [e.name, () => read(e)]));
}

/** The source code of every VBA module in a vbaProject.bin. */
export function vbaModules(bin) {
  const streams = cfbStreams(bin);
  const dirStream = streams.get("dir");
  if (!dirStream) throw new Error("no VBA dir stream");
  const d = ovbaDecompress(dirStream());
  const mods = [];
  let cur = null;
  for (let i = 0; i + 6 <= d.length;) {
    const id = d.readUInt16LE(i);
    const size = id === 0x0009 ? 6 : d.readUInt32LE(i + 2); // PROJECTVERSION says 4 but holds 6 bytes
    const data = d.subarray(i + 6, i + 6 + size);
    if (id === 0x0019) cur = { name: data.toString("latin1"), stream: data.toString("latin1"), offset: 0 };
    else if (id === 0x001a && cur) cur.stream = data.toString("latin1");
    else if (id === 0x0031 && cur) cur.offset = data.readUInt32LE(0);
    else if (id === 0x002b && cur) { mods.push(cur); cur = null; }
    i += 6 + size;
  }
  return mods.map((m) => {
    const s = streams.get(m.stream);
    let code = "";
    try { code = s ? ovbaDecompress(s().subarray(m.offset)).toString("latin1").replace(/^Attribute VB_.*\r?\n/gm, "") : ""; } catch { code = "(couldn't decode)"; }
    return { name: m.name, code };
  });
}

// ---------- database dumps (supabase db dump --data-only --use-copy) ----------
const HIDE = /pass|token|secret|hash|p256dh|auth_key|api_key|refresh/i;
const unescapeCopy = (v) => (v === "\\N" ? null : v.replace(/\\(.)/g, (_, c) => ({ t: "\t", n: "\n", r: "\r", "\\": "\\" })[c] ?? c));

/**
 * Tables in a data dump: { "public.invoices": { columns, rows } }. Only the public schema (Thomas's app data), so sign-in
 * tables (auth.*) are never read, and columns that look like passwords or keys come back as [hidden].
 */
export function parseCopyDump(sql) {
  const tables = {};
  const re = /^COPY "?([\w]+)"?\."?([\w]+)"? \(([^)]*)\) FROM stdin;\r?\n([\s\S]*?)^\\\.\r?$/gm;
  for (const m of sql.matchAll(re)) {
    if (m[1] !== "public") continue;
    const columns = m[3].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const hidden = columns.map((c) => HIDE.test(c));
    const rows = m[4].split(/\r?\n/).filter((l) => l.length).map((l) => l.split("\t").map((v, k) => (hidden[k] && v !== "\\N" ? "[hidden]" : unescapeCopy(v))));
    tables[`${m[1]}.${m[2]}`] = { columns, rows };
  }
  return tables;
}
