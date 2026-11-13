// Single-user auth: a password from APP_PASSWORD, kept as a hashed cookie.
// Works in both the Edge middleware and Node server actions (Web Crypto).
export const COOKIE = "mgr_session";

export async function sessionToken(): Promise<string> {
  const pw = process.env.APP_PASSWORD ?? "";
  const secret = process.env.AUTH_SECRET ?? "manager";
  const data = new TextEncoder().encode(`${secret}:${pw}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
