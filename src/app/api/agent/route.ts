import { cookies } from "next/headers";
import { COOKIE, sessionToken } from "@/lib/auth";
import { runAgent } from "@/lib/agent/run";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** POST { goal, runId? } -> NDJSON stream of agent events. */
export async function POST(req: Request) {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || token !== (await sessionToken())) return new Response("Unauthorized", { status: 401 });
  const { goal, runId } = (await req.json()) as { goal?: string; runId?: string };
  if (!goal?.trim()) return new Response("Missing goal", { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      await runAgent(goal.trim(), (e) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n")), runId);
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
