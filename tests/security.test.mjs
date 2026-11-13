// Safety checks for MyManager. Run with: npm test   (needs only Node, no extra packages)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { commandProblem, isReadOnlyCommand } from "../src/lib/command-safety.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("commands that join, pipe or redirect are refused", () => {
  for (const c of [
    "git status & del x", "git status && rd /s /q C:\\", "git status | findstr x", "git log > out.txt",
    "git status ; rm -rf ~", "git status ^& del x", "git status `whoami`", "git status $(whoami)",
    "git status\ndel x", "gh auth status || shutdown /s", "npm ls < in.txt",
  ]) {
    assert.ok(commandProblem(c), `should refuse: ${c}`);
    assert.equal(isReadOnlyCommand(c), false, `not read-only: ${c}`);
  }
});

test("only known programs run", () => {
  for (const c of ["del status", "rd /s /q list", "format c: -v", "powershell -c whoami", "cmd /c dir", "shutdown -v"]) {
    assert.ok(commandProblem(c), `should refuse: ${c}`);
    assert.equal(isReadOnlyCommand(c), false);
  }
  assert.equal(commandProblem("npm install"), null);
  assert.equal(commandProblem("git pull"), null);
});

test("read-only commands run without asking", () => {
  for (const c of [
    "git status", "git log --oneline -5", "git diff", "git remote -v", "gh auth status", "gh pr list",
    "vercel whoami", "npx vercel ls", "npx supabase projects list", "node --version", "py -m pip list", "claude.cmd --version",
  ]) assert.equal(isReadOnlyCommand(c), true, `read-only: ${c}`);
});

test("commands that change things still ask", () => {
  for (const c of [
    "npm install", "git pull", "git push", "git diff --output=src/app.ts", "npx evil-package --version",
    "npx -y create-something status", "vercel --prod", "supabase db push", "pip install requests", "winget install x", "node script.js",
  ]) assert.equal(isReadOnlyCommand(c), false, `needs OK: ${c}`);
});

// guard.mjs is the hook every Claude Code session MyManager starts goes through.
const guard = (tool_name, tool_input, env = {}) => spawnSync(process.execPath, [path.join(ROOT, "scripts", "guard.mjs")], {
  input: JSON.stringify({ tool_name, tool_input, cwd: ROOT }), env: { ...process.env, ...env }, encoding: "utf8",
}).status;

test("guard blocks destructive shell commands", () => {
  for (const c of [
    "git status & del x", "rm -rf build", "rd /s /q C:\\Users", "git reset --hard", "git push --force", "git clean -fd",
    "taskkill /im node.exe", "shutdown /s", "reg add HKCU\\x", "echo hi > package.json", "npm uninstall next",
    "git diff --output=src/app.ts", "Remove-Item x", "python -c \"import shutil; shutil.rmtree('x')\"",
  ]) assert.equal(guard("Bash", { command: c }), 2, `should block: ${c}`);
});

test("guard lets read-only commands through", () => {
  for (const c of ["git status", "git log --oneline -5", "ls", "npm --version", "echo hi > nul"]) assert.equal(guard("Bash", { command: c }), 0, `should allow: ${c}`);
});

test("guard never lets secret files be read", () => {
  assert.equal(guard("Read", { file_path: path.join(ROOT, ".env.local") }), 2);
  assert.equal(guard("Read", { file_path: "C:/Users/x/DayTrader/alpaca_keys.env" }), 2);
  assert.equal(guard("Bash", { command: "type .env.local" }), 2);
  assert.equal(guard("Read", { file_path: path.join(ROOT, "package.json") }), 0);
});

test("guard only lets the coder change files in its own folder", () => {
  assert.equal(guard("Write", { file_path: path.join(ROOT, "x.txt") }), 2); // no work folder: read-only session
  const work = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || "/tmp"), "mm-guard-"));
  assert.equal(guard("Write", { file_path: path.join(work, "new.txt") }, { MANAGER_GUARD_DIR: work }), 0);
  assert.equal(guard("Write", { file_path: path.join(ROOT, "x.txt") }, { MANAGER_GUARD_DIR: work }), 2);
  fs.rmSync(work, { recursive: true, force: true });
});

test("the launcher and the app work out the same helper key, and the login cookie is different", async () => {
  const env = { AUTH_SECRET: "s3cret", APP_PASSWORD: "pw" };
  const launcher = crypto.createHash("sha256").update(`${env.AUTH_SECRET}:${env.APP_PASSWORD}`).digest("hex");
  const src = fs.readFileSync(path.join(ROOT, "scripts", "local.mjs"), "utf8");
  assert.match(src, /createHash\("sha256"\)\.update\(`\$\{env\.AUTH_SECRET \?\? "manager"\}:\$\{env\.APP_PASSWORD \?\? ""\}`\)/);
  const auth = fs.readFileSync(path.join(ROOT, "src", "lib", "auth.ts"), "utf8");
  assert.match(auth, /AUTH_SECRET \?\? "manager"\}:\$\{process\.env\.APP_PASSWORD \?\? ""\}/);
  assert.match(auth, /browser-session/);
  assert.ok(launcher.length === 64);
});

test("the app only listens on this PC", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "local.mjs"), "utf8");
  assert.match(src, /"-H", HOST/);
  assert.match(src, /MANAGER_HOST \|\| "127\.0\.0\.1"/);
  assert.doesNotMatch(src, /APP_PASSWORD=manager/);
});
