import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { db, unwrap } from "@/lib/db";
import { getMoney } from "@/lib/up";
import { queueAction } from "@/app/actions";
import type { Project, Task } from "@/lib/types";

type Tool = Anthropic.Beta.BetaTool;

const str = { type: "string" } as const;
const nstr = { type: ["string", "null"] } as const;

/** Custom tools the agent can call. Anything risky goes through request_approval. */
export const AGENT_TOOLS: Tool[] = [
  {
    name: "get_overview",
    description: "Get Thomas's current state: every project (kind: app he builds / client = paid job for someone / personal, status, priority, next action, repo), open tasks, ideas inbox and pending approvals. Call this first for any goal that touches his projects or tasks.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "create_task",
    description: "Add a task. Use project_name for project work; null for an everyday/personal task (errands, calls, reminders). Keep titles short and action-first.",
    input_schema: {
      type: "object",
      properties: {
        title: str,
        project_name: { ...nstr, description: "Exact or partial project name, or null for everyday" },
        due: { ...nstr, description: "YYYY-MM-DD or null" },
        priority: { type: "integer", enum: [1, 2, 3, 4, 5], description: "1 = highest" },
      },
      required: ["title", "project_name", "due", "priority"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "complete_task",
    description: "Mark a task done by its id (from get_overview).",
    input_schema: { type: "object", properties: { task_id: str }, required: ["task_id"], additionalProperties: false },
    strict: true,
  },
  {
    name: "update_project",
    description: "Update a project's next action, goal, priority, status or deadline. Pass null for fields to leave unchanged.",
    input_schema: {
      type: "object",
      properties: {
        project_name: str,
        next_action: nstr,
        goal: nstr,
        priority: { type: ["integer", "null"], enum: [1, 2, 3, 4, 5, null] },
        status: { type: ["string", "null"], enum: ["active", "paused", "idea", "done", "archived", null] },
        deadline: { ...nstr, description: "YYYY-MM-DD or null" },
      },
      required: ["project_name", "next_action", "goal", "priority", "status", "deadline"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "add_idea",
    description: "Save an idea to the ideas inbox for Thomas to triage later.",
    input_schema: { type: "object", properties: { text: str }, required: ["text"], additionalProperties: false },
    strict: true,
  },
  {
    name: "create_github_issue",
    description: "Open a GitHub issue on a project's linked repo. Runs immediately (low risk).",
    input_schema: {
      type: "object",
      properties: { project_name: str, title: str, body: str },
      required: ["project_name", "title", "body"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "request_approval",
    description:
      "Queue an action that needs Thomas's approval before it happens: signing up for a service, paying for anything, sending an email, redeploying, deleting things, or using his PC. It does NOT run now: it lands in his Approvals screen. Always include the cost in dollars (0 if free) and a clear reason. Never ask for or include card numbers or passwords. To control his PC (desktop apps or websites, e.g. to fill a signup form), request kind pc.session with the exact purpose; once he approves, your next turn gets desktop and browser tools for 2 hours. For purchases, prepare everything up to the payment step; Thomas pays himself.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["signup", "purchase", "email.send", "vercel.redeploy", "pc.session", "other"] },
        title: { ...str, description: "What will happen, in one line" },
        reason: { ...str, description: "Why this helps the goal" },
        cost_dollars: { type: "number", description: "Expected cost in AUD, 0 if free" },
        project_name: nstr,
        url: { ...nstr, description: "Relevant link (signup page, product, etc.)" },
        details: { ...nstr, description: "Anything else he needs to decide" },
      },
      required: ["kind", "title", "reason", "cost_dollars", "project_name", "url", "details"],
      additionalProperties: false,
    },
    strict: true,
  },
];

async function findProject(name: string | null): Promise<Project | null> {
  if (!name) return null;
  const projects: Project[] = unwrap(await db().from("projects").select("*"));
  const key = name.toLowerCase().replace(/\s+/g, "");
  return (
    projects.find((p) => p.name.toLowerCase().replace(/\s+/g, "") === key) ??
    projects.find((p) => p.name.toLowerCase().replace(/\s+/g, "").includes(key)) ??
    null
  );
}

/** Runs one tool call. Returns text for Claude plus a short label for the UI. */
export async function runTool(name: string, input: Record<string, unknown>): Promise<{ result: string; label: string; isError?: boolean }> {
  try {
    switch (name) {
      case "get_overview": {
        const [projects, tasks, ideas, pending] = await Promise.all([
          db().from("projects").select("id,name,kind,status,priority,next_action,goal,deadline,github_repo,vercel_project,last_touched_at").order("priority"),
          db().from("tasks").select("id,title,status,priority,due,project_id").neq("status", "done").limit(200),
          db().from("ideas").select("id,text").eq("status", "inbox").limit(50),
          db().from("actions").select("title,kind,cost_cents").eq("status", "pending"),
        ]);
        const money = await getMoney();
        const names = new Map((projects.data ?? []).map((p: { id: string; name: string }) => [p.id, p.name] as const));
        const t = (tasks.data ?? []).map((x: Pick<Task, "id" | "title" | "status" | "priority" | "due" | "project_id">) => ({ ...x, project: x.project_id ? names.get(x.project_id) : "everyday", project_id: undefined }));
        return {
          label: "Read your projects and tasks",
          result: JSON.stringify({ today: new Date().toISOString().slice(0, 10), projects: projects.data, open_tasks: t, ideas_inbox: ideas.data, pending_approvals: pending.data, ...(money.configured ? { money_up_bank: money } : {}) }),
        };
      }
      case "create_task": {
        const p = await findProject(input.project_name as string | null);
        if (input.project_name && !p) return { label: "Couldn't find project", result: `No project matches "${input.project_name}".`, isError: true };
        const [row] = unwrap(await db().from("tasks").insert({
          title: input.title, project_id: p?.id ?? null, due: input.due ?? null, priority: input.priority ?? 3,
        }).select());
        if (p) await db().from("projects").update({ last_touched_at: new Date().toISOString() }).eq("id", p.id);
        return { label: `Added task “${input.title}”${p ? ` to ${p.name}` : ""}`, result: `Created task ${row.id}` };
      }
      case "complete_task": {
        const [row] = unwrap(await db().from("tasks").update({ status: "done", done_at: new Date().toISOString() }).eq("id", input.task_id).select());
        return { label: `Completed “${row?.title ?? "task"}”`, result: row ? "Done" : "Task not found" };
      }
      case "update_project": {
        const p = await findProject(input.project_name as string);
        if (!p) return { label: "Couldn't find project", result: `No project matches "${input.project_name}".`, isError: true };
        const patch: Record<string, unknown> = {};
        for (const k of ["next_action", "goal", "priority", "status", "deadline"]) if (input[k] !== null && input[k] !== undefined) patch[k] = input[k];
        patch.last_touched_at = new Date().toISOString();
        await db().from("projects").update(patch).eq("id", p.id);
        return { label: `Updated ${p.name}`, result: `Updated ${Object.keys(patch).filter((k) => k !== "last_touched_at").join(", ") || "nothing"}` };
      }
      case "add_idea": {
        await db().from("ideas").insert({ text: input.text });
        return { label: "Saved an idea to your inbox", result: "Saved" };
      }
      case "create_github_issue": {
        const p = await findProject(input.project_name as string);
        if (!p?.github_repo) return { label: "No repo linked", result: `Project "${input.project_name}" has no GitHub repo linked.`, isError: true };
        const a = await queueAction({
          kind: "github.create_issue", title: `Issue: ${input.title}`, requested_by: "agent", project_id: p.id,
          payload: { repo: p.github_repo, title: input.title, body: input.body },
        });
        return { label: `GitHub issue on ${p.name}: ${a.status}`, result: JSON.stringify({ status: a.status, result: a.result }) };
      }
      case "request_approval": {
        const p = await findProject(input.project_name as string | null);
        const payload: Record<string, unknown> = {};
        if (input.url) payload.url = input.url;
        if (input.details) payload.details = input.details;
        if (input.kind === "vercel.redeploy" && p?.vercel_project) payload.project = p.vercel_project;
        const a = await queueAction({
          kind: input.kind as string, title: input.title as string, reason: input.reason as string,
          cost_cents: Math.round(Number(input.cost_dollars ?? 0) * 100), project_id: p?.id ?? null,
          requested_by: "agent", payload,
        });
        const blocked = a.status === "rejected" ? ` (blocked: ${(a.result as { blocked?: string })?.blocked})` : "";
        return {
          label: a.status === "rejected" ? `Blocked by spend cap: ${input.title}`
            : a.status === "pending" ? `Sent for your approval: ${input.title}` : `Done on trust: ${input.title}`,
          result: a.status !== "rejected" && a.status !== "pending"
            ? `Ran without asking because Thomas has approved this kind of action enough times (trust ladder). Status: ${a.status}. ${JSON.stringify(a.result ?? {})}`
            : a.status === "rejected"
            ? `Blocked automatically${blocked}. Tell Thomas and suggest a cheaper option or raising the cap.`
            : "Queued in Thomas's Approvals screen. It will not happen until he approves. Do not wait for it; carry on with the rest.",
        };
      }
      default:
        return { label: `Unknown tool ${name}`, result: `Unknown tool ${name}`, isError: true };
    }
  } catch (e) {
    return { label: `${name} failed`, result: `Error: ${String(e)}`, isError: true };
  }
}
