// Starts one runbook job and writes how it ended to a small file, so MyManager still knows after a restart
// whether the job finished, failed or was interrupted.  Usage: node job-runner.mjs <exit-file> <program> [args...]
import { spawn } from "node:child_process";
import fs from "node:fs";

const [exitFile, cmd, ...args] = process.argv.slice(2);
const write = (o) => { try { fs.writeFileSync(exitFile, JSON.stringify({ ...o, finished_at: new Date().toISOString() })); } catch { /* nowhere to write */ } };
if (!exitFile || !cmd) { console.error("job-runner: missing arguments"); process.exit(2); }
const child = spawn(cmd, args, { stdio: "inherit", windowsHide: true });
child.on("error", (e) => { write({ code: null, error: e.message }); process.exit(1); });
child.on("exit", (code, signal) => { write({ code: code ?? null, signal: signal ?? null }); process.exit(code ?? 1); });
