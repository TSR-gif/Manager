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
    name: "inspect_project",
    description: "Go and look at how one project is really going: its tasks in Manager, plus (when it has a GitHub repo) recent commits, open issues and pull requests, automated check results, TODO/FIXME notes in the code, whether it has tests, and the README; plus the live website's deploy status. Use this whenever Thomas asks how a project is going, what needs doing, or to check on something. Read only.",
    input_schema: { type: "object", properties: { project_name: str }, required: ["project_name"], additionalProperties: false },
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
    name: "remember",
    description: "Save a lasting fact about Thomas (a preference, routine, person, work or money detail) so you know it next time. Only for things he told you or clearly confirmed. Never passwords, card numbers or secrets.",
    input_schema: {
      type: "object",
      properties: { fact: str, category: { type: "string", enum: ["general", "preference", "person", "routine", "work", "money"] } },
      required: ["fact", "category"], additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "log_time",
    description: "Log hours Thomas worked on a client job (e.g. Altona Sports Centre). Date as YYYY-MM-DD or null for today.",
    input_schema: {
      type: "object",
      properties: { project_name: str, hours: { type: "number" }, date: nstr, note: nstr },
      required: ["project_name", "hours", "date", "note"], additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "track_subscription",
    description: "Record something Thomas pays for regularly (hosting, domain, app, tool) so Money shows what everything costs. Amount in AUD. Doesn't buy anything.",
    input_schema: {
      type: "object",
      properties: {
        name: str, amount_dollars: { type: "number" }, cycle: { type: "string", enum: ["monthly", "yearly", "weekly"] },
        project_name: nstr, next_renewal: nstr,
      },
      required: ["name", "amount_dollars", "cycle", "project_name", "next_renewal"], additionalProperties: false,
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
    name: "draft_social_post",
    description: "Draft a social media post (or a reply to a comment) for Thomas to approve. It is NOT posted: it lands in Approvals with a preview. Use whenever Thomas asks for posts, captions, slideshows or comment replies, and for scheduled content jobs like Bargie's weekly posts. Use only real numbers and facts. For a picture slideshow, give 3 to 10 slides, each with a short heading, the body text (the real price or fact) and which photo to use.",
    input_schema: {
      type: "object",
      properties: {
        project_name: str,
        channel: { type: "string", enum: ["tiktok", "instagram", "facebook", "tiktok+instagram", "reply"] },
        title: { ...str, description: "Short name for this draft, e.g. 'Same 15 items: Coles vs Woolies vs Aldi'" },
        caption: str,
        hashtags: { type: "array", items: str },
        slides: { type: "array", items: { type: "object", properties: { heading: str, body: str, photo: nstr }, required: ["heading", "body", "photo"], additionalProperties: false } },
        reply_to: { ...nstr, description: "For channel reply: the comment being answered" },
        post_at: { ...nstr, description: "Suggested time, e.g. 'Wed 6 pm', or null" },
        sources: { ...nstr, description: "Where the numbers came from" },
      },
      required: ["project_name", "channel", "title", "caption", "hashtags", "slides", "reply_to", "post_at", "sources"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "draft_ad_campaign",
    description: "Draft an ad campaign for one of Thomas's apps (e.g. Bargie on Facebook + Instagram or TikTok). Saves it on the project's Marketing screen and asks Thomas to approve the launch: the total budget (daily x days) is money, so it goes through Approvals and his spend limits. Nothing is launched by you: once approved, Thomas launches it in the ads dashboard. Write the creative (what the ad shows and says) from real facts only.",
    input_schema: {
      type: "object",
      properties: {
        project_name: str, name: str,
        platform: { type: "string", enum: ["meta", "tiktok", "google", "apple"] },
        goal: str, audience: str, creative: str,
        daily_budget_dollars: { type: "number" }, days: { type: "integer" },
      },
      required: ["project_name", "name", "platform", "goal", "audience", "creative", "daily_budget_dollars", "days"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "log_ad_results",
    description: "Record an ad campaign's spend and results (from what Thomas tells you or a report you can read). Use the campaign name.",
    input_schema: {
      type: "object",
      properties: { campaign_name: str, spend_dollars: { type: "number" }, installs: { type: "integer" }, clicks: { type: "integer" }, impressions: { type: "integer" } },
      required: ["campaign_name", "spend_dollars", "installs", "clicks", "impressions"],
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

/** Records what the assistant did, with how to undo it, for "What MyManager did today". */
async function did(title: string, undo: Record<string, unknown> | null) {
  try { await db().from("activity").insert({ title, undo }); } catch {}
}

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
          db().from("projects").select("id,name,kind,watch,status,priority,next_action,goal,deadline,github_repo,vercel_project,last_touched_at").order("priority"),
          db().from("tasks").select("id,title,status,priority,due,project_id").neq("status", "done").limit(200),
          db().from("ideas").select("id,text").eq("status", "inbox").limit(50),
          db().from("actions").select("title,kind,cost_cents").eq("status", "pending"),
        ]);
        const money = await getMoney();
        const { data: usage } = await db().from("usage_events").select("path,device,seconds").gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString()).limit(2000);
        const usageSummary: Record<string, { phone: number; desktop: number }> = {};
        for (const u of (usage ?? []) as { path: string; device: string }[]) {
          const k = "/" + (u.path.split("/")[1] ?? "");
          usageSummary[k] ??= { phone: 0, desktop: 0 };
          usageSummary[k][u.device === "phone" ? "phone" : "desktop"]++;
        }
        const names = new Map((projects.data ?? []).map((p: { id: string; name: string }) => [p.id, p.name] as const));
        const t = (tasks.data ?? []).map((x: Pick<Task, "id" | "title" | "status" | "priority" | "due" | "project_id">) => ({ ...x, project: x.project_id ? names.get(x.project_id) : "everyday", project_id: undefined }));
        return {
          label: "Read your projects and tasks",
          result: JSON.stringify({ today: new Date().toISOString().slice(0, 10), projects: projects.data, open_tasks: t, ideas_inbox: ideas.data, pending_approvals: pending.data, ...(money.configured ? { money_up_bank: money } : {}), screens_opened_last_7_days: usageSummary }),
        };
      }
      case "inspect_project": {
        const p = await findProject(input.project_name as string);
        if (!p) return { label: "Couldn't find project", result: `No project matches "${input.project_name}".`, isError: true };
        const { inspectProject } = await import("@/lib/inspect");
        return { label: `Looked into ${p.name}`, result: await inspectProject(p) };
      }
      case "create_task": {
        const p = await findProject(input.project_name as string | null);
        if (input.project_name && !p) return { label: "Couldn't find project", result: `No project matches "${input.project_name}".`, isError: true };
        const [row] = unwrap(await db().from("tasks").insert({
          title: input.title, project_id: p?.id ?? null, due: input.due ?? null, priority: input.priority ?? 3,
        }).select());
        if (p) await db().from("projects").update({ last_touched_at: new Date().toISOString() }).eq("id", p.id);
        await did(`Added task “${input.title}”${p ? ` to ${p.name}` : ""}`, { op: "delete", table: "tasks", id: row.id });
        return { label: `Added task “${input.title}”${p ? ` to ${p.name}` : ""}`, result: `Created task ${row.id}` };
      }
      case "complete_task": {
        const { data: before } = await db().from("tasks").select("status").eq("id", input.task_id).maybeSingle();
        const [row] = unwrap(await db().from("tasks").update({ status: "done", done_at: new Date().toISOString() }).eq("id", input.task_id).select());
        if (row) await did(`Ticked off “${row.title}”`, { op: "update", table: "tasks", id: row.id, values: { status: before?.status ?? "todo", done_at: null } });
        return { label: `Completed “${row?.title ?? "task"}”`, result: row ? "Done" : "Task not found" };
      }
      case "update_project": {
        const p = await findProject(input.project_name as string);
        if (!p) return { label: "Couldn't find project", result: `No project matches "${input.project_name}".`, isError: true };
        const patch: Record<string, unknown> = {};
        for (const k of ["next_action", "goal", "priority", "status", "deadline"]) if (input[k] !== null && input[k] !== undefined) patch[k] = input[k];
        const prev: Record<string, unknown> = {};
        for (const k of Object.keys(patch)) prev[k] = (p as unknown as Record<string, unknown>)[k] ?? null;
        patch.last_touched_at = new Date().toISOString();
        await db().from("projects").update(patch).eq("id", p.id);
        if (Object.keys(prev).length) await did(`Changed ${p.name}: ${Object.keys(prev).map((k) => k.replace("_", " ")).join(", ")}`, { op: "update", table: "projects", id: p.id, values: prev });
        return { label: `Updated ${p.name}`, result: `Updated ${Object.keys(patch).filter((k) => k !== "last_touched_at").join(", ") || "nothing"}` };
      }
      case "remember": {
        const fact = String(input.fact ?? "").slice(0, 500);
        if (/\b\d{13,19}\b|password|passcode|cvv/i.test(fact)) return { label: "Didn't save that", result: "Refused: looks like a secret. Never store passwords or card numbers.", isError: true };
        const [m] = unwrap(await db().from("memories").insert({ fact, category: input.category ?? "general", source: "assistant" }).select());
        await did(`Remembered: ${fact.slice(0, 80)}`, m ? { op: "delete", table: "memories", id: m.id } : null);
        return { label: `Remembered: ${fact.slice(0, 60)}`, result: "Saved. Thomas can see it on the About you page." };
      }
      case "log_time": {
        const p = await findProject(input.project_name as string);
        if (!p) return { label: "Couldn't find project", result: `No project matches "${input.project_name}".`, isError: true };
        const minutes = Math.round(Number(input.hours) * 60);
        if (!(minutes > 0)) return { label: "No hours given", result: "Hours must be more than 0.", isError: true };
        const [te] = unwrap(await db().from("time_entries").insert({ project_id: p.id, minutes, note: input.note ?? null, ...(input.date ? { worked_on: input.date } : {}) }).select());
        await did(`Logged ${Number(input.hours)}h on ${p.name}`, te ? { op: "delete", table: "time_entries", id: te.id } : null);
        return { label: `Logged ${Number(input.hours)}h on ${p.name}`, result: "Logged. It shows on the Money page and goes on the next invoice." };
      }
      case "track_subscription": {
        const p = input.project_name ? await findProject(input.project_name as string) : null;
        const [sub] = unwrap(await db().from("subscriptions").insert({
          name: input.name, amount_cents: Math.round(Number(input.amount_dollars) * 100), cycle: input.cycle,
          project_id: p?.id ?? null, next_renewal: input.next_renewal ?? null,
        }).select());
        await did(`Started tracking ${input.name}`, sub ? { op: "delete", table: "subscriptions", id: sub.id } : null);
        return { label: `Tracking ${input.name}`, result: "Added to Money → Subscriptions." };
      }
      case "add_idea": {
        const [idea] = unwrap(await db().from("ideas").insert({ text: input.text }).select());
        await did(`Saved idea: ${String(input.text).slice(0, 80)}`, idea ? { op: "delete", table: "ideas", id: idea.id } : null);
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
      case "draft_social_post": {
        const p = await findProject(input.project_name as string);
        const reply = input.channel === "reply";
        const a = await queueAction({
          kind: reply ? "social.reply" : "social.post", title: String(input.title), requested_by: "agent", project_id: p?.id ?? null,
          reason: reply ? `Reply to: ${String(input.reply_to ?? "").slice(0, 200)}` : `${String(input.channel)}${input.post_at ? ` · suggested ${input.post_at}` : ""}`,
          payload: { channel: input.channel, caption: input.caption, hashtags: input.hashtags, slides: input.slides, reply_to: input.reply_to, post_at: input.post_at, sources: input.sources },
        });
        return { label: `Drafted for your OK: ${input.title}`, result: `Draft is waiting in Approvals (${a.status}). Nothing was posted.` };
      }
      case "draft_ad_campaign": {
        const p = await findProject(input.project_name as string);
        const daily = Math.round(Number(input.daily_budget_dollars) * 100);
        const days = Math.max(1, Math.min(90, Number(input.days) || 7));
        const [c] = unwrap(await db().from("campaigns").insert({
          project_id: p?.id ?? null, name: input.name, platform: input.platform, goal: input.goal, audience: input.audience,
          creative: input.creative, daily_budget_cents: daily, days, status: "waiting",
        }).select());
        const a = await queueAction({
          kind: "ads.launch", title: `Launch ad: ${input.name}`, requested_by: "agent", project_id: p?.id ?? null, cost_cents: daily * days,
          reason: `$${(daily / 100).toFixed(0)}/day for ${days} days · goal: ${input.goal}`,
          payload: { campaign_id: c.id, platform: input.platform, audience: input.audience, creative: input.creative, daily_budget_cents: daily, days },
        });
        if (a.status === "rejected") await db().from("campaigns").update({ status: "draft", notes: `Blocked: ${(a.result as { blocked?: string })?.blocked ?? "over a spend limit"}` }).eq("id", c.id);
        await did(`Drafted ad campaign “${input.name}”`, { op: "delete", table: "campaigns", id: c.id });
        return { label: a.status === "rejected" ? `Ad drafted, but over your spend limit` : `Ad drafted, launch waiting for your OK`, result: a.status === "rejected" ? `Saved as a draft. The launch was blocked: ${JSON.stringify(a.result)}. Tell Thomas he can lower the budget or raise his limit in Settings.` : "Saved. The launch is waiting in Approvals. Nothing is live." };
      }
      case "log_ad_results": {
        const { data: list } = await db().from("campaigns").select("id,name");
        const key = String(input.campaign_name).toLowerCase();
        const c = ((list ?? []) as { id: string; name: string }[]).find((x) => x.name.toLowerCase() === key) ?? ((list ?? []) as { id: string; name: string }[]).find((x) => x.name.toLowerCase().includes(key));
        if (!c) return { label: "Couldn't find that ad", result: `No campaign matches "${input.campaign_name}".`, isError: true };
        await db().from("campaigns").update({ spend_cents: Math.round(Number(input.spend_dollars) * 100), installs: input.installs, clicks: input.clicks, impressions: input.impressions }).eq("id", c.id);
        return { label: `Updated results for ${c.name}`, result: "Saved." };
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
