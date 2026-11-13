// Single-user auth: a password from APP_PASSWORD.
// Works in both the Edge middleware and Node server actions (Web Crypto).
// Two different values come from it:
//  - managerKey(): the key MyManager's own helpers (phone bot, assistant bridge) send in the x-manager-key header.
//    scripts/local.mjs works out the same value (sha256 of "AUTH_SECRET:APP_PASSWORD") and hands it to them.
//  - sessionToken(): the browser's login cookie. It's different from the key, so a key copied out of a
//    helper's config file can't be used as a login cookie.
// Changing APP_PASSWORD (or AUTH_SECRET) changes both, which signs every browser and helper out.
export const COOKIE = "mgr_session";

async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const base = () => `${process.env.AUTH_SECRET ?? "manager"}:${process.env.APP_PASSWORD ?? ""}`;

export const managerKey = () => sha256(base());
export const sessionToken = () => sha256(`${base()}:browser-session`);

/** Compares two strings in time that doesn't depend on where they first differ. */
export function sameText(a: string | null | undefined, b: string): boolean {
  if (typeof a !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ---- the assistant's tool pass ----
// A Claude session MyManager starts gets a pass for its own run only, good for a few hours, and only
// /api/agent/tool accepts it. It can't approve anything, can't use the phone bot's API, and isn't the login cookie,
// so a session that goes wrong can't approve its own requests. Format: <run id>.<expires ms>.<signature>
export async function toolToken(runId: string, ttlMs = 3 * 3600_000): Promise<string> {
  const exp = Date.now() + ttlMs;
  return `${runId}.${exp}.${await sha256(`${base()}:tool:${runId}:${exp}`)}`;
}
/** The run id the pass belongs to, or null if it's missing, forged or expired. */
export async function checkToolToken(token: string | null | undefined): Promise<string | null> {
  const [runId, exp, sig] = String(token ?? "").split(".");
  if (!runId || !exp || !sig || !/^[\w-]{1,64}$/.test(runId) || !(Number(exp) > Date.now())) return null;
  return sameText(sig, await sha256(`${base()}:tool:${runId}:${exp}`)) ? runId : null;
}
