import fs from "node:fs";
import path from "node:path";

/**
 * The environment for anything MyManager starts that it doesn't fully control: Claude sessions (assistant, coder,
 * reviewer), loop checks (npm test and friends) and runbook jobs. MyManager's own settings (.env.local: the password,
 * the database key, GitHub/Vercel/Up/Telegram tokens) and anything that looks like a key are left out, so a
 * script or session can't pick them up from its environment. Windows' own variables (PATH, APPDATA, ...) stay so
 * programs still start. Reading files is the guard's job (scripts/guard.mjs); this only covers the environment.
 */
const SECRETISH = /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|SERVICE_ROLE|CREDENTIAL|SESSION_?KEY|AUTH_SECRET|^MANAGER_|^SUPABASE_|^ANTHROPIC_|^OPENAI_|^UP_|^TELEGRAM_|^VERCEL_|^GITHUB_|^GH_)/i;

function appKeys(): Set<string> {
  const keys = new Set<string>();
  try {
    for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=/);
      if (m) keys.add(m[1].toUpperCase());
    }
  } catch { /* no settings file */ }
  return keys;
}

export function workerEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const skip = appKeys();
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || skip.has(k.toUpperCase()) || SECRETISH.test(k)) continue;
    env[k] = v;
  }
  return { ...env, ...extra } as NodeJS.ProcessEnv;
}
