// Which commands a runbook step may run, and which ones only read (so they don't need a second OK).
// Plain JS so tests/security.test.mjs can load it with nothing but Node.
// Commands run through cmd.exe (or sh), so anything that joins, pipes or redirects commands is refused:
// otherwise "git status & rd /s /q C:\\" would pass as "git status".
// Read-only is decided on the whole list of words, not a prefix: every flag has to be one we know only reads.
// So "git branch" lists branches, but "git branch new-name" (creates one) and "git branch -D x" (deletes one) ask first.

const SHELL_META = /[&|;<>^`\r\n%]|\$\(|\$\{/;
const PROGRAMS = ["git", "gh", "npm", "npx", "node", "py", "python", "pip", "vercel", "supabase", "claude", "winget"];

const words = (c) => String(c ?? "").trim().split(/\s+/).filter(Boolean);
const prog = (w) => (w ?? "").toLowerCase().replace(/\.(cmd|exe)$/, "");

/** Why this command may not run at all, or null if it's allowed (it may still need his OK). */
export function commandProblem(command) {
  const c = String(command ?? "").trim();
  if (!c) return "the step has no command.";
  if (SHELL_META.test(c)) return "it joins, pipes or redirects commands, or uses a variable (& | ; < > ^ ` % or a new line). Split it into separate steps.";
  if (!PROGRAMS.includes(prog(words(c)[0]))) return `MyManager only runs ${PROGRAMS.join(", ")} commands.`;
  return null;
}

// ---- git: each read-only subcommand with the exact flags it may take ----
const NUM = /^-\d{1,4}$/;
const LOG_FLAGS = /^(--oneline|--graph|--decorate(=(short|full|no))?|--no-decorate|--stat|--shortstat|--name-only|--name-status|--all|--branches|--remotes|--tags|--no-merges|--merges|--first-parent|--reverse|--abbrev-commit|-p|--patch|--no-patch|-s|-n|--max-count=\d+|--since=[\w:.-]+|--until=[\w:.-]+|--after=[\w:.-]+|--before=[\w:.-]+|--author=[\w@.+-]+|--grep=[\w .+-]+|--format=[\w%:<>(),. -]+|--pretty=[\w%:<>(),. -]+|--date=[\w-]+|--left-right|--cherry-pick|--no-color|--color=never)$/;
const DIFF_FLAGS = /^(--stat|--shortstat|--numstat|--name-only|--name-status|--cached|--staged|--no-color|--color=never|--word-diff|-w|--ignore-all-space|-U\d{1,3}|--unified=\d{1,3}|--minimal|--patience|--histogram|--summary|--check|--no-ext-diff|--no-textconv)$/;
const STATUS_FLAGS = /^(-s|--short|-b|--branch|--porcelain(=v[12])?|--long|-u(no|normal|all)?|--untracked-files(=(no|normal|all))?|--ignored|--no-color)$/;
const BRANCH_FLAGS = /^(--list|-l|-a|--all|-r|--remotes|-v|-vv|--verbose|--show-current|--merged|--no-merged|--no-color|--sort=-?[\w:]+)$/;
// A ref, path or pattern: no leading dash, nothing that could be read as an option.
const PLAIN = /^[\w./@{}~^:*+-]+$/;
const plainArg = (w) => !w.startsWith("-") && PLAIN.test(w);

function gitReadOnly(args) {
  const [sub, ...rest] = args;
  // anything after a lone "--" is a path
  const dd = rest.indexOf("--");
  const opts = dd === -1 ? rest : rest.slice(0, dd);
  const paths = dd === -1 ? [] : rest.slice(dd + 1);
  if (!paths.every(plainArg)) return false;
  switch (sub) {
    case "status": return opts.every((w) => STATUS_FLAGS.test(w) || plainArg(w));
    case "log": return opts.every((w, i) => LOG_FLAGS.test(w) || NUM.test(w) || plainArg(w) || (/^\d+$/.test(w) && opts[i - 1] === "-n"));
    case "diff": return opts.every((w) => DIFF_FLAGS.test(w) || plainArg(w));
    case "show": return opts.every((w) => LOG_FLAGS.test(w) || DIFF_FLAGS.test(w) || plainArg(w));
    case "branch": {
      // Listing only. A plain word is a branch name to create unless --list (or -l) makes it a pattern.
      if (paths.length) return false;
      const listing = opts.some((w) => w === "--list" || w === "-l");
      return opts.every((w) => BRANCH_FLAGS.test(w) || (listing && plainArg(w)));
    }
    case "remote": return opts.length === 0 || (opts.length === 1 && (opts[0] === "-v" || opts[0] === "--verbose"));
    default: return false;
  }
}

// ---- other programs: the text after the program name has to match exactly ----
const READ_ONLY = {
  gh: /^(auth status|repo (list|view)|pr (list|view)|run (list|view)|issue list)( (?!.*--web)[\w./:=@#-]+)*$/,
  vercel: /^(whoami|ls|list|project (ls|list)|--version|-v|(\S+ )?--help)$/,
  supabase: /^(projects list|status|--version|-v|(\S+ )?--help)$/,
  npm: /^(--version|-v|ls|list|(\S+ )?--help)$/,
  pip: /^(--version|list)$/,
  py: /^(--version|-V|-m pip (list|--version))$/,
  python: /^(--version|-V|-m pip (list|--version))$/,
  node: /^(--version|-v)$/,
  claude: /^(--version|-v)$/,
  winget: /^(--version|list)$/,
};

/** Strips "npx" / "npx -y" in front of the two CLIs MyManager knows. Returns null for any other npx package. */
function unwrapNpx(w) {
  if (prog(w[0]) !== "npx") return w;
  const rest = w[1] === "-y" || w[1] === "--yes" ? w.slice(2) : w.slice(1);
  return ["vercel", "supabase"].includes(prog(rest[0])) ? rest : null;
}

/** True when the command can only read, so it runs without asking again. */
export function isReadOnlyCommand(command) {
  if (commandProblem(command)) return false;
  const w = unwrapNpx(words(command));
  if (!w) return false; // npx downloads and runs any package
  const p = prog(w[0]);
  if (p === "git") return gitReadOnly(w.slice(1));
  const re = READ_ONLY[p];
  return !!re && re.test(w.slice(1).join(" "));
}

/** Sign-in commands MyManager may open in a window for Thomas to finish himself (runbook hand-over steps). */
const LOGIN = /^(gh auth login( --(web|hostname [\w.-]+|git-protocol (https|ssh)|scopes [\w:,-]+))*|vercel login( --github)?|supabase login|npm login)$/;
export function isLoginCommand(command) {
  if (commandProblem(command)) return false;
  const w = unwrapNpx(words(command));
  if (!w) return false;
  return LOGIN.test([prog(w[0]), ...w.slice(1)].join(" "));
}
