// One-step local start: `npm run local` (or double-click Start-Manager.bat on Windows).
// Starts the built-in database and the app, then opens http://localhost:3000.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const envFile = path.join(ROOT, ".env.local");
const isWin = process.platform === "win32";
// Only this PC can open MyManager. Other devices on the Wi-Fi can't reach it.
const HOST = process.env.MANAGER_HOST || "127.0.0.1";

// First run: write a local settings file.
if (!fs.existsSync(envFile)) {
  const firstPassword = crypto.randomBytes(9).toString("base64url");
  fs.writeFileSync(envFile, [
    "# Local settings for MyManager. Change APP_PASSWORD to whatever you like.",
    `APP_PASSWORD=${firstPassword}`,
    `AUTH_SECRET=${crypto.randomBytes(24).toString("hex")}`,
    "SUPABASE_URL=http://localhost:3001",
    `SUPABASE_SERVICE_ROLE_KEY=${crypto.randomBytes(24).toString("hex")}`,
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
  console.log(`Created .env.local. Your login password is: ${firstPassword}  (change it in .env.local any time)`);
}

// Read .env.local so the helper processes (Telegram bot) get the same settings as the app.
const env = { ...process.env };
for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && env[m[1]] === undefined) env[m[1]] = m[2];
}
if (!env.APP_PASSWORD || ["manager", "password", "changeme"].includes(env.APP_PASSWORD.toLowerCase())) {
  console.log("\n  WARNING: your MyManager password is still the default. Change APP_PASSWORD in .env.local, then restart.\n");
}
// The built-in database checks a key on every request. Older installs have the placeholder "local", which anyone
// could send, so use a key worked out from this PC's AUTH_SECRET instead. Only the database and the app get it.
let localDbKey = "";
if (!env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY === "local") {
  env.SUPABASE_SERVICE_ROLE_KEY = localDbKey = crypto.createHash("sha256").update(`${env.AUTH_SECRET ?? crypto.randomBytes(24).toString("hex")}:local-db`).digest("hex");
}
// The app reads .env.local itself (and again whenever it changes), so it gets only what isn't in that file. Handing
// it the file's values too would pin them: a password or database changed from a card would snap back on reload.
const appEnv = { ...process.env, ...(localDbKey ? { MM_LOCAL_DB_KEY: localDbKey } : {}) };
// Same value as managerKey() in src/lib/auth.ts (tests/security.test.mjs checks they match).
// The helpers' key follows the password: changing it on a card in MyManager rewrites .env.local, so read it fresh.
const currentKey = () => {
  const now = { ...env };
  try { for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) { const m = line.match(/^\s*(APP_PASSWORD|AUTH_SECRET)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) now[m[1]] = m[2]; } } catch {}
  return keyFrom(now);
};
function keyFrom(env) { return crypto.createHash("sha256").update(`${env.AUTH_SECRET ?? "manager"}:${env.APP_PASSWORD ?? ""}`).digest("hex"); }
const managerKey = currentKey();

const run = (cmd, args, name, opts = {}) => {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], shell: false, env: { ...(opts.base ?? env), ...opts.env } });
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
const app = run(process.execPath, [nextBin, "dev", "-p", "3000", "-H", HOST], "app", { base: appEnv });

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
const tickProactive = () => fetch("http://127.0.0.1:3000/api/proactive", {
  method: "POST", headers: { "Content-Type": "application/json", "x-manager-key": currentKey() }, body: JSON.stringify({ op: "tick" }),
}).then((r) => r.json()).then((j) => { if (j.kind) console.log(`[assistant] ${j.kind} ${j.quiet ? "(nothing to report)" : "sent"}`); }).catch(() => {});
setTimeout(() => { tickProactive(); setInterval(tickProactive, 5 * 60_000); }, 60_000);

// Telegram bot: starts when a token is in .env.local. The Settings screen can add one while
// Manager is running, so check the file every 10 seconds and start/restart/stop the bot to match.
let bot = null;
let botToken = "";
let botKey = "";
const readToken = () => {
  try { return (fs.readFileSync(envFile, "utf8").match(/^\s*TELEGRAM_BOT_TOKEN\s*=\s*(\S*)\s*$/m)?.[1] ?? ""); } catch { return botToken; }
};
const syncBot = () => {
  const t = process.env.TELEGRAM_BOT_TOKEN || readToken();
  const k = currentKey();
  if (t === botToken && k === botKey) return;
  botToken = t; botKey = k;
  if (bot) { bot.kill(); bot = null; }
  if (t) {
    bot = run(process.execPath, [path.join(ROOT, "scripts", "telegram.mjs")], "bot", { optional: true, env: { TELEGRAM_BOT_TOKEN: t, MANAGER_URL: "http://127.0.0.1:3000", MANAGER_KEY: botKey } });
    // if it stops (no internet, Telegram down), try again on a later check
    const me = bot;
    me.on("exit", () => { if (bot === me) bot = null; setTimeout(() => { if (botToken === t) botToken = ""; }, 20_000); });
  }
};
setTimeout(() => { syncBot(); setInterval(syncBot, 10_000); }, 8000);

const stop = () => { db.kill(); app.kill(); bot?.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
