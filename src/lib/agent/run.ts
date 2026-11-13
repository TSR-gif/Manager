import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { AGENT_TOOLS, runTool } from "./tools";

export const MODEL = "claude-opus-5-5";
const MAX_TURNS = 25;

export type AgentEvent =
  | { type: "start"; runId: string }
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; label: string; input: unknown }
  | { type: "tool_done"; id: string; label: string; isError?: boolean }
  | { type: "search"; query: string }
  | { type: "done"; summary: string }
  | { type: "error"; message: string };

const SYSTEM = `You are Manager, Thomas's personal operator. Thomas is a builder in Melbourne, Australia with many projects (apps, websites, trading tools, a clothing brand idea, etc.) and everyday life admin. You work inside his Manager app, which tracks projects, tasks, ideas and an approval queue.

How to work:
- Start by calling get_overview when the goal involves his projects or tasks.
- Do the work, don't just advise. Break goals into concrete tasks with create_task, update next actions with update_project, research with web search.
- Anything that costs money, signs him up for something, sends a message as him, deletes or redeploys, or needs his PC goes through request_approval. It queues; it does not happen. Carry on with the rest of the work after queueing.
- Never ask for, store or repeat card numbers or passwords.
- Prices in AUD. Dates as YYYY-MM-DD.
- Finish with a short plain-English summary: what you did, what's waiting for his approval, and the single next thing he should do. No headings, under 120 words.`;

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

/** Runs (or continues) an agent conversation, emitting events as it goes and saving them to the DB. */
export async function runAgent(goal: string, emit: (e: AgentEvent) => void, runId?: string) {
  let messages: Anthropic.Beta.BetaMessageParam[] = [];
  let events: AgentEvent[] = [];
  if (runId) {
    const { data } = await db().from("agent_runs").select("*").eq("id", runId).single();
    messages = data.messages;
    events = data.events;
    await db().from("agent_runs").update({ status: "running" }).eq("id", runId);
  } else {
    const { data } = await db().from("agent_runs").insert({ goal }).select().single();
    runId = data.id as string;
  }
  const send = (e: AgentEvent) => { events.push(e); emit(e); };
  emit({ type: "start", runId });
  messages.push({ role: "user", content: goal });
  if (events.length) send({ type: "text", text: `↳ ${goal}` });

  let inTok = 0, outTok = 0, summary = "";
  const save = (status?: string) =>
    db().from("agent_runs").update({
      messages, events, input_tokens: inTok, output_tokens: outTok, summary: summary || null,
      ...(status ? { status, finished_at: new Date().toISOString() } : {}),
    }).eq("id", runId);

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await anthropic().beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "medium" },
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: [...AGENT_TOOLS, { type: "web_search_20260209", name: "web_search", max_uses: 5 }],
        messages,
      });
      inTok += response.usage.input_tokens;
      outTok += response.usage.output_tokens;
      messages.push({ role: "assistant", content: response.content });

      for (const b of response.content) {
        if (b.type === "thinking" && b.thinking) send({ type: "thinking", text: b.thinking });
        if (b.type === "text" && b.text.trim()) send({ type: "text", text: b.text });
        if (b.type === "server_tool_use" && b.name === "web_search") send({ type: "search", query: String((b.input as { query?: string }).query ?? "") });
      }

      if (response.stop_reason === "refusal") {
        summary = "I can't help with that one.";
        send({ type: "done", summary });
        await save("failed");
        return runId;
      }
      if (response.stop_reason === "pause_turn") { await save(); continue; }

      const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        summary = response.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.Beta.BetaTextBlock).text).join("\n").trim();
        send({ type: "done", summary });
        await save("done");
        return runId;
      }

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        send({ type: "tool", id: tu.id, name: tu.name, label: tu.name.replace(/_/g, " "), input: tu.input });
        const r = await runTool(tu.name, (tu.input ?? {}) as Record<string, unknown>);
        send({ type: "tool_done", id: tu.id, label: r.label, isError: r.isError });
        results.push({ type: "tool_result", tool_use_id: tu.id, content: r.result, is_error: r.isError });
      }
      messages.push({ role: "user", content: results });
      await save();
    }
    summary = "Stopped after the step limit. Ask me to continue if there's more.";
    send({ type: "done", summary });
    await save("stopped");
  } catch (e) {
    const message = e instanceof Anthropic.AuthenticationError ? "ANTHROPIC_API_KEY is missing or invalid."
      : e instanceof Anthropic.RateLimitError ? "Claude is rate limited right now, try again in a minute."
      : e instanceof Anthropic.APIError ? `Claude API error ${e.status}: ${e.message}`
      : String(e);
    send({ type: "error", message });
    await save("failed");
  }
  return runId;
}
