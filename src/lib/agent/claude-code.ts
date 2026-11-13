import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { db } from "@/lib/db";
import { sessionToken } from "@/lib/auth";
import { AGENT_TOOLS } from "./tools";
import type { AgentEvent } from "./run";

/**
 * Runs the assistant through the Claude Code app already signed in on this PC (`claude -p`),
 * with Manager's own tools exposed over a local MCP bridge (scripts/mcp-manager.mjs).
 */
export async function runClaudeCode(
  goal: string,
  system: string,
  emit: (e: AgentEvent) => void,
  runId?: string,
): Promise<string> {
  let events: AgentEvent[] = [];
  let ccSession: string | null = null;
  if (runId) {
    const { data } = await db().from("agent_runs").select("*").eq("id", runId).single();
    events = data.events ?? [];
    ccSession = data.cc_session_id ?? null;
    await db().from("agent_runs").update({ status: "running" }).eq("id", runId);
  } else {
    const { data } = await db().from("agent_runs").insert({ goal, backend: "claude-code" }).select().single();
    runId = data.id as string;
  }
  const id = runId!;
  const send = (e: AgentEvent) => { events.push(e); emit(e); };
  emit({ type: "start", runId: id });
  if (events.length > 1) send({ type: "text", text: `↳ ${goal}` });

  let summary = "", inTok = 0, outTok = 0;
  const save = (status?: string) =>
    db().from("agent_runs").update({
      events, summary: summary || null, cc_session_id: ccSession, input_tokens: inTok, output_tokens: outTok,
      ...(status ? { status, finished_at: new Date().toISOString() } : {}),
    }).eq("id", id);

  // MCP config pointing Claude Code at Manager's tools
  const root = process.cwd();
  const port = process.env.PORT ?? "3000";
  const cfgPath = path.join(os.tmpdir(), `manager-mcp-${process.pid}.json`);
  fs.writeFileSync(cfgPath, JSON.stringify({
    mcpServers: {
      manager: {
        command: process.execPath,
        args: [path.join(root, "scripts", "mcp-manager.mjs")],
        env: { MANAGER_URL: process.env.MANAGER_URL ?? `http://localhost:${port}`, MANAGER_KEY: await sessionToken() },
      },
    },
  }));

  const allowed = [...AGENT_TOOLS.map((t) => `mcp__manager__${t.name}`), "WebSearch", "WebFetch"];
  const args = [
    "-p", "--output-format", "stream-json", "--verbose",
    "--mcp-config", cfgPath, "--strict-mcp-config",
    "--allowedTools", allowed.join(","),
    "--disallowedTools", "Bash,Edit,Write,NotebookEdit,Task",
    "--append-system-prompt-file", writeTemp("manager-system.txt", system),
  ];
  if (ccSession) args.push("--resume", ccSession);

  const isWin = process.platform === "win32";
  const bin = process.env.CLAUDE_BIN ?? "claude";
  const labels = new Map<string, string>();

  return new Promise<string>((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { shell: isWin, cwd: os.tmpdir(), env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      send({ type: "error", message: `Couldn't start Claude Code: ${String(e)}` });
      void save("failed").then(() => resolve(id));
      return;
    }
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.stdin.write(goal);
    child.stdin.end();

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let m: Record<string, any>;
      try { m = JSON.parse(line); } catch { return; }
      if (m.session_id && !ccSession) ccSession = m.session_id;
      if (m.type === "assistant") {
        for (const b of m.message?.content ?? []) {
          if (b.type === "thinking" && b.thinking) send({ type: "thinking", text: b.thinking });
          else if (b.type === "text" && b.text?.trim()) send({ type: "text", text: b.text });
          else if (b.type === "tool_use") {
            const name = String(b.name);
            if (name === "WebSearch") send({ type: "search", query: String(b.input?.query ?? "") });
            else if (name === "WebFetch") send({ type: "search", query: String(b.input?.url ?? "") });
            else if (name.startsWith("mcp__manager__")) {
              const short = name.replace(/^mcp__manager__/, "");
              labels.set(b.id, short);
              send({ type: "tool", id: b.id, name: short, label: short.replace(/_/g, " "), input: b.input });
            }
          }
        }
        const u = m.message?.usage;
        if (u) { inTok += (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0); outTok += u.output_tokens ?? 0; }
      } else if (m.type === "user") {
        for (const b of m.message?.content ?? []) {
          if (b.type !== "tool_result" || !labels.has(b.tool_use_id)) continue;
          const text = Array.isArray(b.content) ? b.content.map((c: { text?: string }) => c.text ?? "").join("") : String(b.content ?? "");
          const label = text.includes("\n---\n") ? text.split("\n---\n")[0] : labels.get(b.tool_use_id)!;
          send({ type: "tool_done", id: b.tool_use_id, label, isError: !!b.is_error });
        }
        void save();
      } else if (m.type === "result") {
        summary = String(m.result ?? "").trim();
      }
    });

    child.on("error", (e) => {
      send({ type: "error", message: isWin || (e as NodeJS.ErrnoException).code !== "ENOENT"
        ? `Couldn't start Claude Code: ${e.message}`
        : "Claude Code isn't installed on this PC. Install it, sign in, or set AGENT_BACKEND=api with an API key." });
    });
    child.on("close", async (code) => {
      fs.rm(cfgPath, () => {});
      if (code === 0 || summary) {
        if (!summary) summary = [...events].reverse().find((e) => e.type === "text")?.["text" as never] ?? "Done.";
        send({ type: "done", summary });
        await save("done");
      } else {
        const tail = stderr.trim().split(/\r?\n/).slice(-3).join(" ");
        send({ type: "error", message: `Claude Code stopped (${code}). ${tail || "Is it signed in? Run `claude` once in a terminal."}` });
        await save("failed");
      }
      resolve(id);
    });
  });
}

function writeTemp(name: string, content: string) {
  const p = path.join(os.tmpdir(), name);
  fs.writeFileSync(p, content);
  return p;
}
