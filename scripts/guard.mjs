// Safety guard for every Claude Code session MyManager starts (PreToolUse hook).
// Thomas: "make sure it doesn't do anything destructive without permission".
// The app enforces this here, whatever the model decides: deleting, overwriting files that git can't bring back,
// wiping or resetting, force pushes and history rewrites, uninstalling, killing programs, and changing system
// settings are blocked. Those only happen through a runbook step he approves in MyManager.
// Exit code 2 blocks the tool call and tells Claude why.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const WORK = process.env.MANAGER_GUARD_DIR ? path.resolve(process.env.MANAGER_GUARD_DIR) : null; // where the coder may write
const STATE = process.env.MANAGER_GUARD_STATE || null; // files this session created itself (safe to edit again)

const block = (why) => {
  process.stderr.write(`Blocked by MyManager's safety guard: ${why} Thomas has to approve this in MyManager (plan it as a runbook step with draft_runbook, or ask him).`);
  process.exit(2);
};

const SECRET = /(^|[\\/])\.env($|\.)|\.env$|\.pem$|\.key$|secret|credential|_keys?\b|[\\/]\.ssh[\\/]|[\\/]\.aws[\\/]|access-token|login data|cookies$/i;

const DESTRUCTIVE = [
  [/\b(rm|rmdir|del|erase|rd|unlink|shred|truncate)\b/, "deleting files"],
  [/\bremove-item\b|\bri\s|\bclear-content\b/, "deleting files"],
  [/\bmove-item\b|\bmv\b|\bmove\b|\bren(ame)?\b/, "moving or renaming files"],
  [/\bgit\s+(reset|clean|restore|rebase|filter-branch|filter-repo|gc|prune|reflog\s+expire|update-ref|stash\s+(drop|clear))\b/, "rewriting or throwing away git history or changes"],
  [/\bgit\s+checkout\s+(--\s|\.|-f\b|--force)|\bgit\s+checkout\s+\S+\s+--\s/, "throwing away changes with git checkout"],
  [/\bgit\s+switch\s+.*(--discard-changes|-f\b|--force)/, "throwing away changes"],
  [/\bgit\s+branch\s+.*-(d|D)\b|\bgit\s+branch\s+--delete\b/, "deleting a git branch"],
  [/\bgit\s+push\b/, "pushing to GitHub (MyManager asks Thomas for each push)"],
  [/\bgit\s+tag\s+-d\b/, "deleting a tag"],
  [/\bgh\s+(repo\s+(delete|archive|rename|edit)|release\s+delete|secret|variable|api\s+.*-X\s*(delete|put|patch|post))/, "changing or deleting things on GitHub"],
  [/\b(pip|pip3|npm|pnpm|yarn|winget|choco|scoop)\s+(uninstall|remove|rm|un)\b/, "uninstalling software"],
  [/\b(winget|choco|scoop)\s+install\b|\bmsiexec\b/, "installing software"],
  [/\b(taskkill|kill|pkill|killall|stop-process|tskill)\b/, "closing running programs"],
  [/\b(shutdown|restart-computer|stop-computer|logoff)\b/, "shutting down or restarting the PC"],
  [/(^|[;&|(]\s*)(reg|regedit|bcdedit|powercfg|netsh|sc|schtasks|diskpart|cipher|takeown|icacls|attrib|set-executionpolicy|set-itemproperty|new-itemproperty|set-mppreference|set-netfirewallrule|(disable|enable)-[a-z]+)\b|\bformat\s+[a-z]:/, "changing system settings"],
  [/\b(drop\s+(table|database|schema)|truncate\s+table|delete\s+from)\b/, "wiping database data"],
  [/\bsupabase\s+(db\s+reset|projects\s+delete|db\s+push)|\bvercel\s+(rm|remove|domains\s+rm|env\s+rm|--prod)\b/, "changing or deleting things online"],
  [/shutil\.rmtree|os\.remove|os\.unlink|\.unlink\(|rmsync|rmdirsync|unlinksync|fs\.rm\(|remove-item/, "deleting files from a script"],
  [/(^|[^>2&=\-])>(?!>)\s*(?!(nul|\/dev\/null|&))[\w.\\/"'$%~]/, "overwriting a file with >"],
];

function tracked(file) {
  try {
    execFileSync("git", ["-C", path.dirname(file), "ls-files", "--error-unmatch", path.basename(file)], { stdio: "ignore", windowsHide: true });
    return true;
  } catch { return false; }
}
const created = () => { try { return new Set(JSON.parse(fs.readFileSync(STATE, "utf8"))); } catch { return new Set(); } };
const remember = (f) => { if (!STATE) return; const s = created(); s.add(f.toLowerCase()); try { fs.writeFileSync(STATE, JSON.stringify([...s])); } catch { /* ignore */ } };
const inside = (f) => !!WORK && (f.toLowerCase() === WORK.toLowerCase() || f.toLowerCase().startsWith(WORK.toLowerCase() + path.sep));

let input = "";
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", () => {
  let ev;
  try { ev = JSON.parse(input); } catch { process.exit(0); }
  const tool = ev.tool_name ?? "";
  const ti = ev.tool_input ?? {};
  const cwd = ev.cwd ?? process.cwd();

  if (tool === "Bash" || tool === "PowerShell") {
    const cmd = String(ti.command ?? "").toLowerCase();
    for (const [re, what] of DESTRUCTIVE) if (re.test(cmd)) block(`this command looks like ${what}.`);
    if (/\b(type|cat|get-content|gc|more|less|head|tail|findstr|grep|select-string)\b/.test(cmd) && SECRET.test(cmd)) block("secret files (.env, keys, passwords) are never read.");
    process.exit(0);
  }
  if (tool === "Grep") {
    const target = path.resolve(cwd, String(ti.path ?? "."));
    let isDir = true;
    try { isDir = fs.statSync(target).isDirectory(); } catch { /* treat as folder */ }
    if (isDir && !ti.glob && !ti.type) block("searching a whole folder could show what's inside .env and key files. Add a glob (like *.py or *.md) or a type.");
  }
  if (["Read", "Grep", "Glob"].includes(tool)) {
    const p = String(ti.file_path ?? ti.path ?? "") + " " + String(ti.pattern ?? "") + " " + String(ti.glob ?? "");
    if (SECRET.test(p)) block("secret files (.env, keys, passwords) are never read.");
    process.exit(0);
  }
  if (["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(tool)) {
    const f = path.resolve(cwd, String(ti.file_path ?? ti.notebook_path ?? ""));
    if (!WORK) block("this session isn't allowed to change files.");
    if (!inside(f)) block(`it can only change files inside ${WORK}.`);
    if (SECRET.test(f)) block("secret files are never changed.");
    if (/[\\/]\.git[\\/]/i.test(f)) block("git's own files are never changed.");
    const exists = fs.existsSync(f);
    if (exists && !tracked(f) && !created().has(f.toLowerCase())) block(`${path.basename(f)} isn't saved in git, so changing it couldn't be undone.`);
    if (!exists && tool === "Write") remember(f);
    process.exit(0);
  }
  process.exit(0);
});
