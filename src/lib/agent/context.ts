import "server-only";
import { db } from "@/lib/db";
import { todayData } from "@/lib/today";

const PAGES: [RegExp, string][] = [
  [/^\/$/, "the Dashboard"], [/^\/agent/, "the chat page"], [/^\/projects\/[^/]+/, "a project page"], [/^\/projects/, "Projects"],
  [/^\/supervise/, "Running (jobs on his PC)"], [/^\/approvals/, "Approvals"], [/^\/money/, "Money"], [/^\/calendar/, "Calendar"],
  [/^\/servers/, "Servers"], [/^\/settings/, "Settings"], [/^\/inbox/, "Ideas"], [/^\/marketing/, "Marketing"],
];

/**
 * What Thomas can see right now and what's going on, so the assistant (the bubble, the Dashboard chat) answers
 * "are they both linked?" about the thing on his screen instead of acting as if the chat just started.
 * Built on the server from MyManager's own data; the page only says which screen he's on.
 */
export async function screenContext(page: string | undefined, runId?: string) {
  const where = PAGES.find(([re]) => re.test(page ?? ""))?.[1] ?? (page ? `the ${page} page` : null);
  const [t, recent] = await Promise.all([
    todayData().catch(() => null),
    db().from("agent_runs").select("id,goal,summary,created_at").eq("kind", "chat").order("created_at", { ascending: false }).limit(4),
  ]);
  const lines: string[] = [];
  if (where) lines.push(`He is looking at ${where}.`);
  if (t) {
    const needs = [
      ...t.asks.map((a) => `question: ${a.question ?? a.goal}`),
      ...t.steps.map((s) => `${s.runbook}: ${s.label}${s.note ? ` (${s.note})` : ""}`),
      ...t.approvals.map((a) => `waiting for his OK: ${a.title}`),
    ];
    lines.push(needs.length ? `On his "Needs you" list:\n${needs.slice(0, 10).map((x) => `- ${x}`).join("\n")}` : `Nothing is on his "Needs you" list.`);
    if (t.work.length) lines.push(`Being worked on now:\n${t.work.slice(0, 8).map((w) => `- ${w.title} (${w.sub})`).join("\n")}`);
  }
  const earlier = ((recent.data ?? []) as { id: string; goal: string; summary: string | null }[]).filter((r) => r.id !== runId && r.summary).slice(0, 3);
  if (earlier.length) lines.push(`His last chats with you (newest first):\n${earlier.map((r) => `- He asked "${r.goal.slice(0, 120)}"; you answered: ${r.summary!.slice(0, 240)}`).join("\n")}`);
  return lines.length ? `\n\nRight now (use this to understand what he means; he may refer to it as "this", "both", "that card"):\n${lines.join("\n\n")}` : "";
}
