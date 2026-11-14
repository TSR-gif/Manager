// Plain words for what a runbook step did. Thomas gets one sentence; the raw output stays with MyManager.
// No server-only imports, so the screens can use it too (for steps saved before this existed).

export type Svc = "Vercel" | "Supabase" | "GitHub";

export function serviceOf(text: string): Svc | null {
  if (/\bvercel\b/i.test(text)) return "Vercel";
  if (/\bsupabase\b/i.test(text)) return "Supabase";
  if (/\bgh\b|\bgithub\b/i.test(text)) return "GitHub";
  return null;
}

export const needsSignIn = (t: string) => /logged out|no existing credentials|not logged in|vercel login|token is not valid|invalid token|access token not provided|supabase login|gh auth login|not authenticated/i.test(t);

/** Output that's really a report from a tool (table borders, npm notices, version banners), not a sentence. */
export function looksRaw(t?: string | null) {
  if (!t) return false;
  return /npm warn|Vercel CLI \d|^\s*>|-{6,}|\|.*\|.*\||Cannot find project ref|ORG ID|REFERENCE ID|\s\/\s.*\s\/\s|https?:\/\/\S+\s+\d{4}-\d\d-\d\d/m.test(t);
}

const lines = (t: string) => t.split(/\r?\n/).map((x) => x.replace(/^[>\s]+/, "").trim()).filter((x) => x && !/^Vercel CLI \d/i.test(x) && !/^npm (warn|notice)/i.test(x));

/** A Supabase "projects list" table, as names. */
function supabaseNames(t: string) {
  return t.split(/\r?\n/).filter((l) => (l.match(/\|/g) ?? []).length >= 4 && !/REFERENCE ID|^\s*-+\|/.test(l))
    .map((l) => l.split("|").map((c) => c.trim())).map((c) => c[3]).filter(Boolean);
}

/** What a command that worked found out, in one plain sentence. */
export function plainSuccess(command: string, text: string): string {
  const t = text ?? "";
  if (/\bvercel\b.*\bwhoami\b/i.test(command)) { const who = lines(t).pop(); return who ? `MyManager is signed in to Vercel as ${who}.` : "MyManager is signed in to Vercel."; }
  if (/\bvercel\b.*\bproj(ect)?s?\s+(ls|list)\b/i.test(command)) {
    const names = t.split(/\r?\n/).map((l) => l.trim().split(/\s+/)[0]).filter((n) => n && /^[a-z0-9][\w.-]*$/i.test(n) && !/^(Vercel|Fetching|Project|Projects|npm|>)$/i.test(n));
    return names.length ? `MyManager can see ${names.length} Vercel project${names.length > 1 ? "s" : ""}: ${names.join(", ")}.` : "MyManager can see your Vercel projects.";
  }
  if (/\bsupabase\b.*\bprojects\s+list\b/i.test(command)) {
    const names = supabaseNames(t);
    return `MyManager is signed in to Supabase${names.length ? ` and can see ${names.map((n) => `"${n}"`).join(", ")}` : ""}.${/Cannot find project ref/i.test(t) ? " This folder isn't linked to a Supabase project on the PC, which only matters for changing the database from here." : ""}`;
  }
  if (/\bgh\b.*\bauth\s+status\b/i.test(command)) { const who = t.match(/account (\S+)/i)?.[1] ?? t.match(/as (\S+)/i)?.[1]; return `MyManager is signed in to GitHub${who ? ` as ${who}` : ""}.`; }
  return "Done.";
}

/** What went wrong, in plain words, from a command's own output. */
export function plainFailure(command: string, text: string) {
  const svc = serviceOf(command);
  if (svc && needsSignIn(text)) return `MyManager isn't signed in to ${svc} on this PC (that's separate from your browser).`;
  if (/not recognized|command not found|ENOENT|missing packages/i.test(text)) return `The program this needs isn't installed on this PC (\`${command.split(/\s+/).filter((w) => !/^(npx|--no-install|-y)$/.test(w))[0]}\`).`;
  if (/ENOTFOUND|getaddrinfo|ECONNRESET|ETIMEDOUT|network/i.test(text)) return "It couldn't reach the internet from this PC.";
  if (/EACCES|EPERM|access is denied/i.test(text)) return "Windows didn't allow it (access denied).";
  const last = lines(text).pop();
  return last ? `It stopped with: "${last.slice(0, 200)}"` : "It stopped without saying why.";
}

/** The sentence to show for a step: its note, unless that's raw tool output saved by an older MyManager. */
export function stepNote(s: { status: string; note?: string | null; command?: string | null }) {
  const n = s.note ?? "";
  if (!looksRaw(n)) return n || undefined;
  const text = n.replace(/ \/ /g, "\n");
  return s.status === "failed" ? plainFailure(s.command ?? "", text) : plainSuccess(s.command ?? "", text);
}

/** A hand-over that's really a sign-in, even when it was planned without the command: the command that does it. */
export function signInCommandFor(label: string, text?: string): string | null {
  const t = `${label} ${text ?? ""}`;
  if (!/sign.?in|log.?in|authori[sz]e|connect your account|reconnect/i.test(t)) return null;
  const svc = serviceOf(t);
  return svc === "Vercel" ? "npx vercel login" : svc === "Supabase" ? "npx supabase login" : svc === "GitHub" ? "gh auth login --web" : null;
}
