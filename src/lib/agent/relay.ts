import "server-only";
import { db } from "@/lib/db";
import type { AgentEvent } from "./run";

/**
 * MyManager online without a paid Claude key: the PC answers. The online site leaves his question on the
 * conversation's row and passes the answer back as the PC writes it. When the PC is off, it says so and the
 * answer arrives (on the phone and Telegram) once the PC is back on.
 */
export async function askThePc(goal: string, emit: (e: AgentEvent) => void, runId?: string, kind = "chat"): Promise<string> {
  const now = new Date().toISOString();
  let seen = 0;
  if (runId) {
    const { data } = await db().from("agent_runs").select("events").eq("id", runId).single();
    seen = ((data as { events?: unknown[] } | null)?.events ?? []).length;
    await db().from("agent_runs").update({ status: "running", queued_goal: goal, queued_at: now }).eq("id", runId);
  } else {
    const { data } = await db().from("agent_runs").insert({ goal, kind, backend: "pc", status: "running", queued_goal: goal, queued_at: now }).select("id").single();
    runId = (data as { id: string }).id;
  }
  const id = runId!;
  emit({ type: "start", runId: id });
  const started = Date.now();
  let warned = false;
  while (Date.now() - started < 280_000) {
    await new Promise((r) => setTimeout(r, 2000));
    const { data } = await db().from("agent_runs").select("events,status,queued_goal,summary").eq("id", id).single();
    const r = data as { events: AgentEvent[] | null; status: string; queued_goal: string | null; summary: string | null };
    const events = r.events ?? [];
    for (const e of events.slice(seen)) emit(e);
    seen = events.length;
    if (!r.queued_goal && r.status !== "running") return id;
    if (r.queued_goal && !warned && Date.now() - started > 30_000) {
      warned = true;
      emit({ type: "text", text: "Your PC hasn't picked this up yet, so it may be off or asleep. I'll answer as soon as it's back on, here and on Telegram." });
    }
  }
  if (!warned) emit({ type: "text", text: "Still working on it on your PC. The answer will show up here when it's done." });
  return id;
}

/** On the PC: answer what the phone asked. Checks every few seconds while the PC uses the online database. */
export function ensurePhoneChats() {
  if (process.env.VERCEL) return;
  if (/localhost|127\.0\.0\.1/.test(process.env.SUPABASE_URL ?? "")) return; // phone can't reach the PC's own database
  const g = globalThis as unknown as { __mmPhone?: NodeJS.Timeout };
  if (g.__mmPhone) return;
  let busy = false;
  g.__mmPhone = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const { data } = await db().from("agent_runs").select("id,queued_goal,kind").not("queued_goal", "is", null).order("queued_at").limit(1);
      const job = (data ?? [])[0] as { id: string; queued_goal: string; kind: string } | undefined;
      if (!job) return;
      // claim it, so a second PC tab or a restart can't answer it twice
      const { data: got } = await db().from("agent_runs").update({ queued_goal: null }).eq("id", job.id).eq("queued_goal", job.queued_goal).select("id");
      if (!(got ?? []).length) return;
      const { runAgent } = await import("./run");
      let summary = "";
      await runAgent(job.queued_goal, (e) => { if (e.type === "done") summary = e.summary; }, job.id, { kind: (job.kind as "chat") ?? "chat" });
      await db().from("agent_runs").update({ unread: true }).eq("id", job.id);
      if (summary) void import("@/lib/notify").then((m) => m.notify(`📱 ${summary}`)).catch(() => {});
    } catch { /* next time */ } finally { busy = false; }
  }, 3000);
  g.__mmPhone.unref?.();
}
