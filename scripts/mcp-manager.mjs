// MCP bridge (stdio): exposes Manager's assistant tools to the Claude Code app on this PC.
// Started automatically by Manager when AGENT_BACKEND=claude-code. Needs MANAGER_URL and MANAGER_KEY.
import readline from "node:readline";

const URL_BASE = process.env.MANAGER_URL ?? "http://localhost:3000";
const KEY = process.env.MANAGER_KEY ?? "";
const headers = { "Content-Type": "application/json", "x-manager-key": KEY };
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;
  const reply = (result) => id !== undefined && send({ jsonrpc: "2.0", id, result });
  const fail = (message) => id !== undefined && send({ jsonrpc: "2.0", id, error: { code: -32000, message } });
  try {
    if (method === "initialize") {
      reply({ protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "manager", version: "1.0.0" } });
    } else if (method === "tools/list") {
      const r = await fetch(`${URL_BASE}/api/agent/tool`, { headers });
      if (!r.ok) return fail(`Manager returned ${r.status}`);
      reply({ tools: await r.json() });
    } else if (method === "tools/call") {
      const r = await fetch(`${URL_BASE}/api/agent/tool`, { method: "POST", headers, body: JSON.stringify({ name: params.name, input: params.arguments ?? {} }) });
      if (!r.ok) return reply({ content: [{ type: "text", text: `Manager returned ${r.status}` }], isError: true });
      const out = await r.json();
      // first line carries the human label for Manager's timeline
      reply({ content: [{ type: "text", text: `${out.label}\n---\n${out.result}` }], isError: !!out.isError });
    } else if (method === "ping") {
      reply({});
    } else if (id !== undefined) {
      fail(`Unknown method ${method}`);
    }
  } catch (e) {
    fail(String(e));
  }
});
