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
