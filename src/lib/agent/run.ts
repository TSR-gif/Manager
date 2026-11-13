import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { AGENT_TOOLS, runTool } from "./tools";
import { runClaudeCode } from "./claude-code";

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

const BASE_SYSTEM = `You are MyManager, Thomas's personal operator. Thomas is a builder in Melbourne, Australia with many projects (apps, websites, trading tools, a clothing brand idea, etc.) and everyday life admin. You work inside his MyManager app, which tracks projects, tasks, ideas and an approval queue.

How to work:
- Start by calling get_overview when the goal involves his projects or tasks.
- Do the work, don't just advise. Break goals into concrete tasks with create_task, update next actions with update_project, research with web search.
- Anything that costs money, signs him up for something, sends a message as him, deletes or redeploys, or needs his PC goes through request_approval. It queues; it does not happen. Carry on with the rest of the work after queueing.
- When he asks how a project is going or what needs doing ("go see how X is going"), call inspect_project and actually read what comes back. Then answer like a sharp colleague who just looked: how it's going in one or two sentences, then a short numbered list of what needs doing, most important first, each one concrete. Point out which items are already tasks. Then ask: "Want me to add these as tasks?" and when adding, never add a task that duplicates an existing one (with DECIDE autonomy, just add them). If you couldn't see the code, say so plainly and say what you could see.
- Never ask for, store or repeat card numbers or passwords.
- Prices in AUD. Use YYYY-MM-DD in tool calls, but write dates for Thomas in words ("Saturday 14 Nov", "tomorrow").
- Talk like a helpful friend, not a developer: no file names, code, IDs, tool names or jargon in what you write to him. Say "automatic checks" not CI, "changes waiting to go in" not PRs, "the live site" not Vercel or deploys. If something isn't connected, just say "connect it in Settings", never name tokens or keys.
- Answer first. Your final reply starts with one or two sentences that give the answer and the single next thing to do, as its own paragraph (he often reads on his phone for 15 seconds). Then a blank line and any details: what you did, what's waiting for his OK. No headings, under 150 words. If you're offering to do something, end with a yes/no question.`;

const AUTONOMY: Record<string, string> = {
  ask: "Autonomy: ASK. Before changing anything (tasks, projects, ideas), describe the plan and stop so Thomas can confirm. Research and reading are fine.",
  balanced: "Autonomy: BALANCED. Make low-stakes, reversible changes yourself (tasks, next actions, ideas, GitHub issues) and decide small things for him. Money, accounts, messages sent as him and anything irreversible go to request_approval.",
  decide: "Autonomy: DECIDE. Act like a trusted chief of staff: make the calls yourself, pick between options, reprioritise projects, and keep moving without checking in. The only hard stop: money, signups, messages sent as him, deletes, redeploys and PC sessions still go through request_approval.",
};

export async function systemPrompt() {
  const { data } = await db().from("settings").select("autonomy,assistant_name").eq("id", 1).maybeSingle();
  const name = (data?.assistant_name as string) || "MyManager";
  const level = (data?.autonomy as string) ?? "balanced";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });
  const { data: mem } = await db().from("memories").select("fact,category").order("created_at").limit(200);
  const known = (mem ?? []).length
    ? `\n\nWhat you know about Thomas (he can see and edit this list; use the remember tool when he tells you something lasting):\n${(mem ?? []).map((m: { fact: string; category: string }) => `- [${m.category}] ${m.fact}`).join("\n")}`
    : "";
  return `${BASE_SYSTEM.replace("You are MyManager,", `You are ${name},`)}\n\nToday is ${today} (Melbourne).\n${AUTONOMY[level] ?? AUTONOMY.balanced}${known}`;
}

/** claude-code = the Claude Code app on this PC (local mode); api = Claude API (needs ANTHROPIC_API_KEY; always on Vercel). */
export const agentBackend = (): "claude-code" | "api" => {
  if (process.env.AGENT_BACKEND === "api" || process.env.VERCEL) return "api";
  if (process.env.AGENT_BACKEND === "claude-code") return "claude-code";
  return process.env.ANTHROPIC_API_KEY ? "api" : "claude-code";
};

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

/** Runs (or continues) an agent conversation, emitting events as it goes and saving them to the DB. */
export interface RunOpts { kind?: "chat" | "brief" | "checkin" | "job" }

export async function runAgent(goal: string, rawEmit: (e: AgentEvent) => void, runId?: string, opts: RunOpts = {}) {
  // keep working if the browser goes away mid-run (background jobs)
  const emit = (e: AgentEvent) => { try { rawEmit(e); } catch { /* client gone */ } };
  const SYSTEM = await systemPrompt();
  if (agentBackend() === "claude-code") return runClaudeCode(goal, SYSTEM, emit, runId, opts.kind ?? "chat");
  let messages: Anthropic.Beta.BetaMessageParam[] = [];
  let events: AgentEvent[] = [];
  if (runId) {
    const { data } = await db().from("agent_runs").select("*").eq("id", runId).single();
    messages = data.messages;
    events = data.events;
    await db().from("agent_runs").update({ status: "running" }).eq("id", runId);
  } else {
    const { data } = await db().from("agent_runs").insert({ goal, kind: opts.kind ?? "chat" }).select().single();
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
