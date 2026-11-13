import { sessionToken } from "@/lib/auth";
import { AGENT_TOOLS, runTool } from "@/lib/agent/tools";

export const dynamic = "force-dynamic";

/** Used by the local MCP bridge (scripts/mcp-manager.mjs) so the Claude Code app can call Manager's tools. */
async function authed(req: Request) {
  return req.headers.get("x-manager-key") === (await sessionToken());
}

export async function GET(req: Request) {
  if (!(await authed(req))) return new Response("Unauthorized", { status: 401 });
  return Response.json(AGENT_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })));
}

export async function POST(req: Request) {
  if (!(await authed(req))) return new Response("Unauthorized", { status: 401 });
  const { name, input } = (await req.json()) as { name: string; input: Record<string, unknown> };
  return Response.json(await runTool(name, input ?? {}));
}
