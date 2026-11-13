// One-step local start: `npm run local` (or double-click Start-Manager.bat on Windows).
// Starts the built-in database and the app, then opens http://localhost:3000.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const envFile = path.join(ROOT, ".env.local");
const isWin = process.platform === "win32";

// First run: write a local settings file.
if (!fs.existsSync(envFile)) {
  fs.writeFileSync(envFile, [
    "# Local settings for MyManager. Change APP_PASSWORD to whatever you like.",
    "APP_PASSWORD=manager",
    `AUTH_SECRET=${crypto.randomBytes(24).toString("hex")}`,
    "SUPABASE_URL=http://localhost:3001",
    "SUPABASE_SERVICE_ROLE_KEY=local",
    "# Agent brain: 'claude-code' uses the Claude Code app already signed in on this PC.",
    "# Set to 'api' and fill ANTHROPIC_API_KEY to use the Claude API instead.",
    "AGENT_BACKEND=claude-code",
    "ANTHROPIC_API_KEY=",
    "# Optional: live GitHub / Vercel status",
    "GITHUB_TOKEN=",
    "VERCEL_TOKEN=",
    "VERCEL_TEAM_ID=team_IiSZJwc7Mj1Edzz5rQ3gFRBA",
    "# Optional: Up Bank spending tile (Up app > Data sharing > Personal Access Token)",
    "UP_TOKEN=",
    "# Optional: phone approvals. Make a bot with @BotFather in Telegram and paste its token here.",
    "TELEGRAM_BOT_TOKEN=",
    "",
  ].join("\n"));
  console.log("Created .env.local (login password: manager)");
}

// Read .env.local so the helper processes (Telegram bot) get the same settings as the app.
const env = { ...process.env };
for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && env[m[1]] === undefined) env[m[1]] = m[2];
}
const managerKey = crypto.createHash("sha256").update(`${env.AUTH_SECRET ?? "manager"}:${env.APP_PASSWORD ?? ""}`).digest("hex");

const run = (cmd, args, name, opts = {}) => {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], shell: false, env: { ...env, ...opts.env } });
  const tag = (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  p.stdout.on("data", tag);
  p.stderr.on("data", tag);
  p.on("exit", (code) => { console.log(`[${name}] stopped (${code})`); if (!opts.optional) process.exit(code ?? 0); });
  return p;
};

const db = run(process.execPath, [path.join(ROOT, "scripts", "dev-rest.mjs")], "db");
// give the database a moment to open/migrate before the app starts
await new Promise((r) => setTimeout(r, 2500));
const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const app = run(process.execPath, [nextBin, "dev", "-p", "3000"], "app");

setTimeout(() => {
  const url = "http://localhost:3000";
  console.log(`\n  MyManager is running: ${url}\n`);
  const opener = isWin ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  if (process.env.NO_OPEN) return;
  try {
    const o = spawn(opener[0], opener[1], { stdio: "ignore", detached: true });
    o.on("error", () => console.log("  (Open that address in your browser.)"));
    o.unref();
  } catch {}
}, 6000);

// Proactive assistant: ask Manager every 5 minutes whether a brief or check-in is due.
const tickProactive = () => fetch("http://localhost:3000/api/proactive", {
  method: "POST", headers: { "Content-Type": "application/json", "x-manager-key": managerKey }, body: JSON.stringify({ op: "tick" }),
}).then((r) => r.json()).then((j) => { if (j.kind) console.log(`[assistant] ${j.kind} ${j.quiet ? "(nothing to report)" : "sent"}`); }).catch(() => {});
setTimeout(() => { tickProactive(); setInterval(tickProactive, 5 * 60_000); }, 60_000);

// Telegram bot: starts when a token is in .env.local. The Settings screen can add one while
// Manager is running, so check the file every 10 seconds and start/restart/stop the bot to match.
let bot = null;
let botToken = "";
const readToken = () => {
  try { return (fs.readFileSync(envFile, "utf8").match(/^\s*TELEGRAM_BOT_TOKEN\s*=\s*(\S*)\s*$/m)?.[1] ?? ""); } catch { return botToken; }
};
const syncBot = () => {
  const t = process.env.TELEGRAM_BOT_TOKEN || readToken();
  if (t === botToken) return;
  botToken = t;
  if (bot) { bot.kill(); bot = null; }
  if (t) bot = run(process.execPath, [path.join(ROOT, "scripts", "telegram.mjs")], "bot", { optional: true, env: { TELEGRAM_BOT_TOKEN: t, MANAGER_URL: "http://localhost:3000", MANAGER_KEY: managerKey } });
};
setTimeout(() => { syncBot(); setInterval(syncBot, 10_000); }, 8000);

const stop = () => { db.kill(); app.kill(); bot?.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
