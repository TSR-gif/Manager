// Which commands a runbook step may run, and which ones only read (so they don't need a second OK).
// Plain JS so tests/security.test.mjs can load it with nothing but Node.
// Commands run through cmd.exe (or sh), so anything that joins, pipes or redirects commands is refused:
// otherwise "git status & rd /s /q C:\\" would pass as "git status".

const SHELL_META = /[&|;<>^`\r\n]|\$\(/;
const PROGRAMS = ["git", "gh", "npm", "npx", "node", "py", "python", "pip", "vercel", "supabase", "claude", "winget"];

const words = (c) => String(c ?? "").trim().split(/\s+/).filter(Boolean);
const prog = (w) => (w ?? "").toLowerCase().replace(/\.(cmd|exe)$/, "");

/** Why this command may not run at all, or null if it's allowed (it may still need his OK). */
export function commandProblem(command) {
  const c = String(command ?? "").trim();
  if (!c) return "the step has no command.";
  if (SHELL_META.test(c)) return "it joins, pipes or redirects commands (& | ; < > ^ ` or a new line). Split it into separate steps.";
  if (!PROGRAMS.includes(prog(words(c)[0]))) return `MyManager only runs ${PROGRAMS.join(", ")} commands.`;
  return null;
}

// What counts as read-only, per program. The text after the program name has to match exactly.
const READ_ONLY = {
  git: /^(status|log|diff|show|remote -v|branch( --list| -a| -v)?)(\s(?!.*--output)(?!.*--ext-diff).*)?$/,
  gh: /^(auth (status|login)|repo (list|view)|pr (list|view)|run (list|view)|issue list)(\s.*)?$/,
  vercel: /^(whoami|ls|list|login|project (ls|list)|--version|-v|(\S+ )?--help)$/,
  supabase: /^(projects list|login|status|--version|-v|(\S+ )?--help)$/,
  npm: /^(--version|-v|ls|list|(\S+ )?--help)$/,
  pip: /^(--version|list)$/,
  py: /^(--version|-V|-m pip (list|--version))$/,
  python: /^(--version|-V|-m pip (list|--version))$/,
  node: /^(--version|-v)$/,
  claude: /^(--version|-v)$/,
  winget: /^(--version|list)$/,
};

/** True when the command can only read or sign in, so it runs without asking again. */
export function isReadOnlyCommand(command) {
  if (commandProblem(command)) return false;
  let w = words(command);
  // npx downloads and runs any package, so only the two CLIs MyManager knows count.
  if (prog(w[0]) === "npx") {
    const rest = w[1] === "-y" || w[1] === "--yes" ? w.slice(2) : w.slice(1);
    if (!["vercel", "supabase"].includes(prog(rest[0]))) return false;
    w = rest;
  }
  const re = READ_ONLY[prog(w[0])];
  return !!re && re.test(w.slice(1).join(" "));
}
