import { cookies } from "next/headers";
import { COOKIE, managerKey, sameText, sessionToken } from "@/lib/auth";
import { runAgent } from "@/lib/agent/run";
import { db } from "@/lib/db";
import { notify } from "@/lib/notify";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** POST { goal, runId? } -> NDJSON stream of agent events. */
export async function POST(req: Request) {
  // the browser (login cookie) or the phone bot (helper key). Claude sessions' tool pass doesn't work here.
  const token = (await cookies()).get(COOKIE)?.value;
  if (!sameText(token, await sessionToken()) && !sameText(req.headers.get("x-manager-key"), await managerKey())) return new Response("Unauthorized", { status: 401 });
  const { goal, runId, page } = (await req.json()) as { goal?: string; runId?: string; page?: string };
  if (!goal?.trim()) return new Response("Missing goal", { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let summary = "";
      const id = await runAgent(goal.trim(), (e) => {
        if (e.type === "done") summary = e.summary;
        if (!req.signal.aborted) controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      }, runId, { page: typeof page === "string" ? page.slice(0, 80) : undefined });
      // Background job: if he left before it finished, tell him it's done.
      if (req.signal.aborted) {
        await db().from("agent_runs").update({ unread: true }).eq("id", id);
        if (summary) await notify(`✅ Done: ${goal.trim().slice(0, 80)}\n\n${summary}`);
      }
      try { controller.close(); } catch { /* already closed */ }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
