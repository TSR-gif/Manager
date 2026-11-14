import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * How MyManager talks to Vercel's API: a token from Settings (.env.local VERCEL_TOKEN) if he set one, otherwise
 * the Vercel command-line tool's own sign-in on this PC, so signing in once with `vercel login` is all it takes.
 * The token is only ever sent to api.vercel.com; it's never shown, logged, or passed to a script or Claude session
 * (worker-env strips VERCEL_*, and scripts/guard.mjs blocks Claude sessions from reading com.vercel.cli).
 */
function cliDirs() {
  const home = os.homedir();
  if (process.platform === "win32") return [path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "com.vercel.cli", "Data"), path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "com.vercel.cli", "Data")];
  if (process.platform === "darwin") return [path.join(home, "Library", "Application Support", "com.vercel.cli")];
  return [path.join(process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share"), "com.vercel.cli")];
}
const readJson = (f: string) => { try { return JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, unknown>; } catch { return null; } };

export function vercelAuth(): { token?: string; teamId?: string; from: "settings" | "cli" | "none" } {
  if (process.env.VERCEL_TOKEN) return { token: process.env.VERCEL_TOKEN, teamId: process.env.VERCEL_TEAM_ID || undefined, from: "settings" };
  for (const dir of cliDirs()) {
    const auth = readJson(path.join(dir, "auth.json"));
    const token = typeof auth?.token === "string" ? auth.token : undefined;
    if (!token) continue;
    const team = readJson(path.join(dir, "config.json"))?.currentTeam;
    return { token, teamId: process.env.VERCEL_TEAM_ID || (typeof team === "string" ? team : undefined), from: "cli" };
  }
  return { from: "none" };
}

/** Plain words for a Vercel problem, for the screens. */
export function vercelProblem(error: string) {
  if (/not signed in|VERCEL_TOKEN/i.test(error)) return "MyManager isn't signed in to Vercel on this PC yet (that's separate from Chrome)";
  if (/\b(401|403)\b/.test(error)) return "MyManager's Vercel sign-in has expired";
  return "Couldn't reach Vercel";
}
