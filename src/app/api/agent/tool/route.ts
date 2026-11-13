import { checkToolToken } from "@/lib/auth";
import { AGENT_TOOLS, runTool } from "@/lib/agent/tools";

export const dynamic = "force-dynamic";

/** Used by the local MCP bridge (scripts/mcp-manager.mjs) so the Claude Code app can call Manager's tools.
 *  Only a run's own tool pass works here (toolToken in lib/auth.ts); the helper key and the login cookie don't. */
async function authed(req: Request) {
  return !!(await checkToolToken(req.headers.get("x-manager-tool")));
}

export async function GET(req: Request) {
  if (!(await authed(req))) return new Response("Unauthorized", { status: 401 });
  return Response.json(AGENT_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })));
}

export async function POST(req: Request) {
  if (!(await authed(req))) return new Response("Unauthorized", { status: 401 });
  const body = (await req.json().catch(() => null)) as { name?: unknown; input?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name : "";
  if (!AGENT_TOOLS.some((t) => t.name === name)) return Response.json({ label: "Unknown tool", result: `Unknown tool ${name}`, isError: true });
  const input = body?.input && typeof body.input === "object" && !Array.isArray(body.input) ? (body.input as Record<string, unknown>) : {};
  return Response.json(await runTool(name, input));
}
