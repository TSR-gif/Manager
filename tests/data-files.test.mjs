// Checks the read-only data file reader used by the in-depth project study. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { ovbaDecompress, parseCopyDump, readWorkbook, unzip, workbookText } from "../src/lib/data-files.mjs";

/** A tiny zip with stored (uncompressed) entries. The reader doesn't check CRCs, so they're left 0. */
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = Buffer.from(name), d = Buffer.from(text);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt32LE(d.length, 20); c.writeUInt32LE(d.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(h, n, d); centrals.push(c, n);
    offset += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(centrals);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 8); e.writeUInt16LE(Object.keys(files).length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, e]);
}

const book = zip({
  "xl/workbook.xml": '<workbook><sheets><sheet name="Invoices" sheetId="1" r:id="rId1"/></sheets></workbook>',
  "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  "xl/sharedStrings.xml": "<sst><si><t>Client</t></si><si><r><t>Acme </t></r><r><t>&amp; Co</t></r></si></sst>",
  "xl/styles.xml": '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
  "xl/worksheets/sheet1.xml": '<worksheet><dimension ref="A1:C2"/><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" s="1"><v>46000</v></c><c r="C2"><f>SUM(1,2)</f><v>3</v></c></row><row r="3"/></sheetData></worksheet>',
});

test("zip entries come back as written", () => {
  assert.equal(unzip(zip({ "a.txt": "hello" })).get("a.txt")().toString(), "hello");
});

test("workbook cells: shared strings, dates and formulas", () => {
  const wb = readWorkbook(book);
  assert.equal(wb.sheets[0].name, "Invoices");
  const cells = wb.sheets[0].rows[1].cells;
  assert.deepEqual(cells.map((c) => c.v), ["Acme & Co", "2025-12-09", "3"]);
  assert.equal(cells[2].f, "SUM(1,2)");
  assert.equal(wb.vba, null);
  assert.match(workbookText(book), /B2=2025-12-09 \| C2=3 \[=SUM\(1,2\)\]/);
  assert.match(workbookText(book, "nope"), /No sheet called "nope"/);
});

test("VBA decompression: literals then a copy token", () => {
  // chunk header 0xB00B (compressed, 14 bytes), 8 literals, then one token: copy 8 bytes from 8 back (0x7005)
  const packed = Buffer.from([1, 0x0b, 0xb0, 0x00, ...Buffer.from("abcdefgh"), 0x01, 0x05, 0x70]);
  assert.equal(ovbaDecompress(packed).toString("latin1"), "abcdefghabcdefgh");
  assert.throws(() => ovbaDecompress(Buffer.from([0])));
});

test("database dumps: public tables only, secrets hidden", () => {
  const sql = [
    'COPY "auth"."users" ("id", "email") FROM stdin;', "1\ta@b.c", "\\.",
    'COPY "public"."invoices" ("id", "client", "paid_at", "api_key") FROM stdin;', "1\tAcme\\tCo\t\\N\tsk_123", "2\tBob\t2026-01-01\t\\N", "\\.",
  ].join("\n");
  const t = parseCopyDump(sql);
  assert.deepEqual(Object.keys(t), ["public.invoices"]);
  assert.deepEqual(t["public.invoices"].rows, [["1", "Acme\tCo", null, "[hidden]"], ["2", "Bob", "2026-01-01", null]]);
});
