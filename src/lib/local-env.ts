import "server-only";
import fs from "node:fs";
import path from "node:path";

/** True when Manager runs on Thomas's own PC (not the cloud), so settings can be saved to .env.local. */
export const isLocal = () => !process.env.VERCEL;

/**
 * Save one setting into .env.local and apply it right away, so the person can paste a key into
 * the app instead of editing files. The file stays on their PC and is git-ignored.
 */
export function setLocalEnv(key: string, value: string) {
  if (!isLocal()) throw new Error("Only available when MyManager runs on your PC.");
  if (!/^[A-Z0-9_]+$/.test(key) || /[\r\n]/.test(value)) throw new Error("Bad setting");
  const file = path.join(process.cwd(), ".env.local");
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
  const i = lines.findIndex((l) => l.replace(/^\s+/, "").startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.splice(lines.length && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length, 0, `${key}=${value}`);
  fs.writeFileSync(file, lines.join("\n").replace(/\n*$/, "\n"));
  if (value) process.env[key] = value;
  else delete process.env[key];
}
