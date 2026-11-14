import "server-only";
import { notify } from "@/lib/notify";
import type Anthropic from "@anthropic-ai/sdk";
import { db, unwrap } from "@/lib/db";
import { getMoney } from "@/lib/up";
import { queueAction } from "@/lib/action-queue";
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
    name: "check_project_activity",
    description: "See what a project is doing right now on Thomas's PC, read-only: programs running from its folder (tests, data downloads, bots), Windows scheduled tasks that run it, files changed recently (data, results, logs) and the last lines of its newest logs and data files. Use it whenever Thomas asks how a project is tracking, whether its tests or data gathering are still going, or when it'll be done. Starts nothing, stops nothing.",
    input_schema: { type: "object", properties: { project_name: str }, required: ["project_name"], additionalProperties: false },
    strict: true,
  },
  {
    name: "draft_runbook",
    description: `Plan a list of steps MyManager will carry out on Thomas's PC and watch, e.g. "start the Saturday job, close the queue, commit and push, delete the old venv", or setting up a service (sign-ins handed to him). It goes to Approvals as one list; nothing runs until he approves. Deleting folders and any command that isn't read-only ask him again at that step. Step kinds:
- start_job: file (a .bat/.cmd/.py/.ps1 in the project folder), expect_hours. Runs it in the background, keeps the PC awake, watches its output, tells him when it finishes or stalls. The steps after it wait until it finishes successfully; set independent: true only if they really don't need its result.
- stop_process: match (e.g. "run_queue"): closes that program if it's running from the project.
- git_commit_push: message. Commits everything new in the project folder (skips .env/key files and venv folders, stops if it sees secrets) and pushes the current branch.
- delete_folder: path (inside the project folder).
- open_link: url (https) opens it in his browser.
- handoff: text (what he needs to do), optional url or command (only a sign-in: gh auth login, vercel login, supabase login or npm login, opened in a window for him), blocking (false = "only if needed"). Use this for anything that needs a password, 2FA, payment or a choice only he can make.
- run_command: command (git, gh, npm, npx, node, py, pip, vercel, supabase, claude or winget only).
Steps run in order; if one fails, the ones after it are held until Thomas says retry, skip or stop.
Set optional: true for steps he called optional. Never put passwords or keys in steps.`,
    input_schema: {
      type: "object",
      properties: {
        project_name: { type: ["string", "null"] }, title: str,
        steps: { type: "array", items: { type: "object", properties: {
          kind: { type: "string", enum: ["start_job", "stop_process", "git_commit_push", "delete_folder", "open_link", "handoff", "run_command"] },
          label: str, file: str, expect_hours: { type: "number" }, match: str, message: str, path: str, url: str, text: str, command: str,
          blocking: { type: "boolean" }, optional: { type: "boolean" }, independent: { type: "boolean" },
        }, required: ["kind", "label"] } },
      },
      required: ["project_name", "title", "steps"],
    },
  },
  {
    name: "find_services",
    description: "Look through Thomas's project folders on this PC (Documents, Desktop and the usual places; all already allowed, no need to ask him) and say which use Vercel, Supabase or other online services, plus whether the Vercel, Supabase and GitHub command-line tools on this PC are signed in. Read only; never reads .env or key files. Use it before planning any setup or connection work.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    name: "watch_job",
    description: "Watch a program Thomas already started himself on his PC (e.g. run_saturday_job, a backtest, a data download) until it finishes. MyManager keeps the PC awake meanwhile, follows a log file if you name one (path inside the project folder), and messages him when it finishes, stops with an error, goes quiet for 45 minutes, or runs much longer than expected. Read-only, so it starts straight away. Use check_project_activity first to see what's running and which log it writes.",
    input_schema: { type: "object", properties: { project_name: str, match: { type: "string", description: "Text from the program's command line, e.g. run_saturday_job or pc_saturday.py" }, log: { type: ["string", "null"] }, expect_hours: { type: ["number", "null"] } }, required: ["project_name", "match", "log", "expect_hours"], additionalProperties: false },
    strict: true,
  },
  {
    name: "runbook_status",
    description: "See the runbooks on Thomas's PC: which are waiting for his OK, running (and what the long jobs last printed), waiting on him, or finished. Use it when he asks how a job or runbook is going.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
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
    name: "read_project_file",
    description: "Read one file (or list a folder) of a project's code, read-only: from its folder on Thomas's PC if linked, otherwise from GitHub. Use \"\" for the top folder. Never reads .env or secret files.",
    input_schema: { type: "object", properties: { project_name: str, path: str }, required: ["project_name", "path"], additionalProperties: false },
    strict: true,
  },
  {
    name: "save_project_brief",
    description: "Save the living brief for a project (markdown with the sections: What it is, How it's built, How to run and test it, Where it lives, Where it's at, Known problems, What's next). It's shown on the project page and read before you act on the project. Don't put Thomas's rules in it; they're kept separately.",
    input_schema: { type: "object", properties: { project_name: str, brief: str }, required: ["project_name", "brief"], additionalProperties: false },
    strict: true,
  },
  {
    name: "read_data_file",
    description: "Read a data file on Thomas's PC, read-only: an Excel workbook (.xlsx/.xlsm, including its macros' code), a PDF (its text), or a .csv/.sql/.json/.txt export. Without sheet you get every sheet's first and last rows plus the macros; with sheet you get up to 300 rows of it from from_row. path is a full path inside his user folder. Never opens secret files.",
    input_schema: { type: "object", properties: { path: str, sheet: nstr, from_row: { type: ["integer", "null"] } }, required: ["path", "sheet", "from_row"], additionalProperties: false },
    strict: true,
  },
  {
    name: "read_app_data",
    description: "Read a project's live app data, read-only, from its newest weekly database backup on GitHub (copied to this PC only). table null lists every table with its columns and row count; with table you get up to 200 rows from offset. Sign-in tables and password/key columns are never shown.",
    input_schema: { type: "object", properties: { project_name: str, table: nstr, offset: { type: ["integer", "null"] } }, required: ["project_name", "table", "offset"], additionalProperties: false },
    strict: true,
  },
  {
    name: "save_project_knowledge",
    description: "Save what you've worked out about a project from studying it in depth (business facts with dates, how its data is laid out, where it lives and is hosted, what's broken or unfinished, what only Thomas can do, what to keep an eye on). Private: kept in MyManager's own database for you, not shown on screen and not written to the project's folder. data_paths: folders/files on his PC holding the project's data, one per line, or null if none. code_folder: the project's git folder on his PC if you found one, or null; it's linked only if the project has none yet.",
    input_schema: { type: "object", properties: { project_name: str, knowledge: str, data_paths: nstr, code_folder: nstr }, required: ["project_name", "knowledge", "data_paths", "code_folder"], additionalProperties: false },
    strict: true,
  },
  {
    name: "supervise_project",
    description: "Start supervising work on a project until it's finished. Use when Thomas says something like \"Day trader is doing X, Y and Z, make sure it gets finished\". Breaks it into steps (tasks), then MyManager checks on it regularly on its own, ticks off steps that are really done, and asks Thomas when it needs him (in the app and on his phone). work_dir is the project's folder on his PC if he wants MyManager to do the coding steps itself (that needs his OK once, which this asks for); otherwise null. done_check makes it a loop: a test/type-check/lint/build command (like \"npm test\" or \"py -m pytest\") that must pass. MyManager then codes, runs the check, fixes failures, has a second read-only reviewer look at the change, and repeats until it passes and is approved (max_rounds goes, default 6) before telling Thomas the branch is ready. Use it when Thomas says things like \"keep going until the tests pass\". Otherwise null.",
    input_schema: {
      type: "object",
      properties: {
        project_name: str, goal: str,
        steps: { type: "array", items: str },
        check_every_hours: { type: "number" },
        work_dir: nstr,
        done_check: nstr,
        max_rounds: { type: ["number", "null"] },
      },
      required: ["project_name", "goal", "steps", "check_every_hours", "work_dir", "done_check", "max_rounds"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "add_mission_step",
    description: "Add a step to a supervised mission (only when it's genuinely needed to finish).",
    input_schema: { type: "object", properties: { mission_id: str, title: str }, required: ["mission_id", "title"], additionalProperties: false },
    strict: true,
  },
  {
    name: "mission_update",
    description: "Record where a supervised mission is at, in one plain line Thomas can read. status: \"running\" to keep going, \"done\" only when every step is really finished.",
    input_schema: { type: "object", properties: { mission_id: str, update: str, status: { type: "string", enum: ["running", "done"] } }, required: ["mission_id", "update", "status"], additionalProperties: false },
    strict: true,
  },
  {
    name: "ask_thomas",
    description: "A supervised mission needs Thomas: a decision, a login, a key, money, or something only he knows. Sends him one short question in the app and on his phone, and pauses the mission until he answers. Ask only when you can't move without him.",
    input_schema: { type: "object", properties: { mission_id: str, question: str }, required: ["mission_id", "question"], additionalProperties: false },
    strict: true,
  },
  {
    name: "run_coding_step",
    description: "Start one coding step on a supervised mission: a Claude Code session in the project's folder on Thomas's PC, on its own branch, which never pushes. Only works if he approved coding for that mission. Give one clear, small step. It runs in the background and the mission is checked again when it finishes.",
    input_schema: { type: "object", properties: { mission_id: str, instructions: str }, required: ["mission_id", "instructions"], additionalProperties: false },
    strict: true,
  },
  {
    name: "request_push",
    description: "When a supervised mission's coding is finished and checked, ask Thomas whether to push its work branch to GitHub (he reviews and merges it there). Shows him what changed. Never merges or deploys.",
    input_schema: { type: "object", properties: { mission_id: str }, required: ["mission_id"], additionalProperties: false },
    strict: true,
  },
  {
    name: "answer_mission",
    description: "Pass Thomas's answer to a supervised mission that is waiting on him (when he answers in chat). Use the mission id from get_overview's missions list. The mission carries on straight away.",
    input_schema: { type: "object", properties: { mission_id: str, answer: str }, required: ["mission_id", "answer"], additionalProperties: false },
    strict: true,
  },
  {
    name: "start_helper",
    description: "Start an always-on helper: it owns an ongoing responsibility (not a job with an end), works in the background, and only comes back to Thomas for a decision or a result worth knowing. Use when he hands something over for good, e.g. \"keep an eye on Bargie's launch\", \"make sure my Saturday Day trader run goes OK every week\", \"look after my bills\". project_name null for an everyday helper. It wakes every check_every_hours, and also when any wake_on event happens: approval_decided (he approves or turns something down), runbook_finished, job_finished (a job on his PC ends), mission_finished. It runs while MyManager is running on his PC.",
    input_schema: {
      type: "object",
      properties: {
        project_name: nstr, responsibility: str, check_every_hours: { type: "number" },
        wake_on: { type: "array", items: { type: "string", enum: ["approval_decided", "runbook_finished", "job_finished", "mission_finished"] } },
      },
      required: ["project_name", "responsibility", "check_every_hours", "wake_on"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "tell_thomas",
    description: "An always-on helper tells Thomas a result worth knowing, in one or two plain lines (sent in the app and on his phone). Not for routine progress: most wake-ups should send nothing. For a question, use ask_thomas.",
    input_schema: { type: "object", properties: { mission_id: str, message: str }, required: ["mission_id", "message"], additionalProperties: false },
    strict: true,
  },
  {
    name: "stop_mission",
    description: "Stop a supervised mission or always-on helper. Only when Thomas asks you to stop it.",
    input_schema: { type: "object", properties: { mission_id: str }, required: ["mission_id"], additionalProperties: false },
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

const squash = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** Finds a project by name, loosely: "DayTrader", "day-trader", "the day trader one", "MyManager", the repo or folder name all work. */
async function findProject(name: string | null): Promise<Project | null> {
  if (!name) return null;
  const projects: Project[] = unwrap(await db().from("projects").select("*"));
  const key = squash(name).replace(/^(the|my)/, "").replace(/(project|app|one)$/, "");
  if (!key) return null;
  const names = (p: Project) => {
    const lp = (p as { local_path?: string | null }).local_path;
    return [squash(p.name), squash(p.github_repo?.split("/").pop()), squash(lp?.split(/[\\/]/).filter(Boolean).pop())].filter(Boolean);
  };
  return (
    projects.find((p) => names(p).includes(key)) ??
    projects.find((p) => names(p).some((n) => n.includes(key) || key.includes(n))) ??
    projects.find((p) => squash(p.name).replace(/^my/, "") === key.replace(/^my/, "")) ??
    null
  );
}

async function noProject(name: unknown) {
  const { data } = await db().from("projects").select("name").order("priority");
  return { label: "Couldn't match that project name", result: `No project matches "${name}". The projects are: ${(data ?? []).map((p: { name: string }) => p.name).join(", ")}. Try again with one of these exact names.`, isError: true };
}

/** Whole general folders (Downloads, Documents...) aren't a project's data: watching them would restudy on every download. */
const BROAD = /^[a-z]:[\\/]users[\\/][^\\/]+([\\/](downloads|documents|desktop|onedrive|pictures))?[\\/]?$/i;

/** Claude sometimes sends the word "null" (or nothing) for an optional field: treat it as no value. */
const opt = (v: unknown) => (v === null || v === undefined || /^(null|none|)$/i.test(String(v).trim()) ? null : String(v));

/** Runs one tool call. Returns text for Claude plus a short label for the UI. */
export async function runTool(name: string, input: Record<string, unknown>): Promise<{ result: string; label: string; isError?: boolean }> {
  try {
    switch (name) {
      case "get_overview": {
        const [projects, tasks, ideas, pending] = await Promise.all([
          db().from("projects").select("*").order("priority"),
          db().from("tasks").select("id,title,status,priority,due,project_id").neq("status", "done").limit(200),
          db().from("ideas").select("id,text").eq("status", "inbox").limit(50),
          db().from("actions").select("title,kind,cost_cents").eq("status", "pending"),
        ]);
        const [missionsQ, doneQ] = await Promise.all([
          db().from("missions").select("id,project_id,goal,status,question,last_update,worker,last_check_at,ongoing,done_check,rounds").in("status", ["running", "waiting"]),
          db().from("tasks").select("title,project_id,done_at").eq("status", "done").gte("done_at", new Date(Date.now() - 7 * 86_400_000).toISOString()).limit(200),
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
          result: JSON.stringify({ today: new Date().toISOString().slice(0, 10), projects: projects.error ? `Couldn't read projects: ${projects.error.message}` : (projects.data ?? []).map(({ brief, knowledge, ...p }: Record<string, unknown>) => ({ ...p, brief_commit: undefined, has_brief: !!brief, needs_thomas: String(knowledge ?? "").match(/## Needs Thomas\n([\s\S]*?)(\n## |$)/)?.[1]?.trim() || undefined })), open_tasks: t, ideas_inbox: ideas.data, pending_approvals: pending.data, ...(money.configured ? { money_up_bank: money } : {}), screens_opened_last_7_days: usageSummary,
            supervised_missions: (missionsQ.data ?? []).map((m: { project_id: string | null }) => ({ ...m, project: m.project_id ? names.get(m.project_id) : null })),
            done_last_7_days: (doneQ.data ?? []).map((d: { title: string; project_id: string | null }) => ({ title: d.title, project: d.project_id ? names.get(d.project_id) : "everyday" })) }),
        };
      }
      case "inspect_project": {
        const p = await findProject(input.project_name as string);
        if (!p) return noProject(input.project_name);
        const { inspectProject } = await import("@/lib/inspect");
        return { label: `Looked into ${p.name}`, result: await inspectProject(p) };
      }
      case "draft_runbook": {
        const p = input.project_name ? await findProject(input.project_name as string) : null;
        if (input.project_name && !p) return noProject(input.project_name);
        const dir = (p as { local_path?: string | null } | null)?.local_path ?? null;
        const { draftRunbook } = await import("@/lib/runbooks");
        const res = await draftRunbook({ project_id: p?.id ?? null, work_dir: dir, title: String(input.title), steps: (input.steps as never[]) ?? [] });
        if (!res.ok) return { label: "Couldn't plan that runbook", result: `Not saved. Fix these and try again:\n${res.problems.join("\n")}`, isError: true };
        return { label: `Planned “${input.title}”, waiting for your OK`, result: "Saved. It's in Approvals as one list; nothing runs until Thomas approves. Deleting and setup commands ask again at that step. Progress shows on the Running screen and comes to Telegram." };
      }
      case "find_services": {
        const { findServices } = await import("@/lib/services");
        return { label: "Looked through your project folders and sign-ins", result: await findServices() };
      }
      case "watch_job": {
        const p = await findProject(input.project_name as string);
        if (!p) return noProject(input.project_name);
        const { watchJob } = await import("@/lib/runbooks");
        const st = await watchJob({ project_id: p.id, work_dir: (p as { local_path?: string | null }).local_path ?? null, match: String(input.match), log: (input.log as string) || undefined, expect_hours: (input.expect_hours as number) || undefined, title: `${p.name}: watching ${input.match}` });
        return { label: st.status === "running" ? `Watching ${input.match} on your PC` : `${input.match} isn't running`, result: `${st.note ?? st.status}. It shows on the Running screen; Thomas gets a message when it finishes or stalls.` };
      }
      case "runbook_status": {
        const { data } = await db().from("runbooks").select("*").order("created_at", { ascending: false }).limit(8);
        const { jobTail } = await import("@/lib/runbooks");
        const rows = ((data ?? []) as import("@/lib/runbooks").Runbook[]).map((r) => ({
          title: r.title, status: r.status, update: r.last_update, started: r.started_at, finished: r.finished_at,
          steps: r.steps.list.map((s) => ({ label: s.label, status: s.status, note: s.note, ...(s.kind === "start_job" && s.status === "running" ? { last_output: jobTail(s.log, 4) } : {}) })),
        }));
        return { label: "Checked your runbooks", result: JSON.stringify(rows) };
      }
      case "check_project_activity": {
        let p = await findProject(input.project_name as string);
        if (!p) return noProject(input.project_name);
        let dir = (p as { local_path?: string | null }).local_path;
        if (!dir) {
          const { linkProjectFolders } = await import("@/lib/local-repos");
          await linkProjectFolders().catch(() => null);
          p = (await findProject(p.name)) ?? p;
          dir = (p as { local_path?: string | null }).local_path;
        }
        if (!dir) return { label: `No folder on this PC for ${p.name}`, result: `${p.name} isn't linked to a folder on this PC and none was found automatically. Say you couldn't find its folder, and that he can paste the folder path on the project page (one line). Don't create a task for it.` };
        const { projectActivity } = await import("@/lib/activity");
        return { label: `Checked what ${p.name} is doing on your PC`, result: await projectActivity(dir) };
      }
      case "create_task": {
        const p = await findProject(input.project_name as string | null);
        if (input.project_name && !p) return noProject(input.project_name);
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
        if (!p) return noProject(input.project_name);
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
        if (!p) return noProject(input.project_name);
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
      case "read_project_file": {
        const p = await findProject(input.project_name as string);
        if (!p) return noProject(input.project_name);
        const { readProjectFile } = await import("@/lib/briefs");
        const text = await readProjectFile(p, String(input.path ?? ""));
        return { label: `Read ${String(input.path || "the file list")} in ${p.name}`, result: text };
      }
      case "save_project_brief": {
        const p = await findProject(input.project_name as string);
        if (!p) return noProject(input.project_name);
        const { error } = await db().from("projects").update({ brief: String(input.brief).slice(0, 12000), brief_updated_at: new Date().toISOString(), brief_edited_by_you: false }).eq("id", p.id);
        if (error) return { label: "Couldn't save the brief", result: `Not saved: ${error.message}`, isError: true };
        const { writeNotes } = await import("@/lib/project-notes");
        await writeNotes(p.id).catch(() => "");
        return { label: `Updated the ${p.name} brief`, result: "Saved. It shows on the project page." };
      }
      case "read_data_file": {
        const { readDataFile } = await import("@/lib/briefs");
        const file = String(input.path ?? "");
        return { label: `Read ${file.split(/[\\/]/).pop()}${opt(input.sheet) ? ` (${input.sheet})` : ""}`, result: readDataFile(file, opt(input.sheet), Number(input.from_row) || 1) };
      }
      case "read_app_data": {
        const p = await findProject(input.project_name as string);
        if (!p) return noProject(input.project_name);
        if (!p.github_repo) return { label: "No app data to read", result: `${p.name} has no GitHub repo, so there are no database backups to read.` };
        const { snapshotText } = await import("@/lib/snapshots");
        return { label: `Read ${p.name}'s data${opt(input.table) ? ` (${input.table})` : ""}`, result: await snapshotText(p.github_repo, opt(input.table), Math.max(0, Number(input.offset) || 0)) };
      }
      case "save_project_knowledge": {
        const p = await findProject(input.project_name as string);
        if (!p) return noProject(input.project_name);
        // one path per line; drop notes Claude adds after a path, like "C:\x (old copies)"
        const paths = (opt(input.data_paths) ?? "").split(/\r?\n/).map((s) => s.trim().replace(/\s+\(.*\)$/, ""))
          .filter((s) => s && !BROAD.test(s)).join("\n") || null;
        // Link the code folder it found, but never replace one that's already set (Thomas may have chosen it).
        const folder = opt(input.code_folder);
        const { existsSync } = await import("node:fs");
        const link = folder && !(p as { local_path?: string | null }).local_path && existsSync(`${folder}/.git`) ? { local_path: folder } : {};
        const { error } = await db().from("projects").update({ knowledge: String(input.knowledge).slice(0, 30000), knowledge_updated_at: new Date().toISOString(), data_paths: paths, ...link }).eq("id", p.id);
        if (error) return { label: "Couldn't save what I learned", result: `Not saved: ${error.message}`, isError: true };
        return { label: `Saved what I learned about ${p.name}`, result: `Saved privately. You'll see it in inspect_project.${link.local_path ? ` Linked its folder ${folder}, so don't ask Thomas to.` : ""}` };
      }
      case "supervise_project": {
        const p = await findProject(input.project_name as string);
        if (!p) return noProject(input.project_name);
        const hours = Math.max(0.25, Math.min(24, Number(input.check_every_hours) || 1));
        const workDir = (input.work_dir as string | null) || (p as { local_path?: string | null }).local_path || null;
        const doneCheck = String(input.done_check ?? "").trim() || null;
        if (doneCheck) {
          const { isSafeCheck } = await import("@/lib/loops");
          if (!isSafeCheck(doneCheck)) return { label: "Check not allowed", result: `"${doneCheck}" isn't a check MyManager will run over and over. Use a test, type-check, lint or build command (npm test, npx tsc --noEmit, py -m pytest...).`, isError: true };
          if (!workDir) return { label: "No folder", result: "A loop needs the project's folder on Thomas's PC. Ask him where it is, or save it on the project.", isError: true };
        }
        const [m] = unwrap(await db().from("missions").insert({
          done_check: doneCheck, max_rounds: Math.max(1, Math.min(12, Math.round(Number(input.max_rounds) || 6))),
          project_id: p.id, goal: input.goal, check_every_minutes: Math.round(hours * 60), work_dir: workDir,
          next_check_at: new Date(Date.now() + 60_000).toISOString(),
        }).select());
        const steps = ((input.steps as string[]) ?? []).filter(Boolean).slice(0, 20);
        if (steps.length) await db().from("tasks").insert(steps.map((t) => ({ title: t.slice(0, 200), project_id: p.id, mission_id: m.id, priority: 2 })));
        const { logMission } = await import("@/lib/missions");
        await logMission(m.id, "note", `Started: ${input.goal}`);
        let coding = "";
        if (workDir) {
          if (input.work_dir && !(p as { local_path?: string | null }).local_path) await db().from("projects").update({ local_path: workDir }).eq("id", p.id);
          const a = await queueAction({
            kind: "mission.code", title: `Let MyManager work on the ${p.name} code`, requested_by: "agent", project_id: p.id, cost_cents: 0,
            reason: `For "${String(input.goal).slice(0, 120)}": it edits files in ${workDir} on a separate branch, commits, and never pushes or deploys.`,
            payload: { mission_id: m.id, folder: workDir },
          });
          coding = a.status === "pending" ? " Coding on his PC is waiting for his OK in Approvals." : "";
        }
        await did(`Started supervising ${p.name}: ${String(input.goal).slice(0, 60)}`, { op: "update", table: "missions", id: m.id, values: { status: "stopped" } });
        return { label: `Supervising ${p.name}`, result: `Mission ${m.id} started with ${steps.length} steps. First check in about a minute, then every ${hours} hour(s). It shows on the Running screen.${coding}` };
      }
      case "add_mission_step": {
        const { data: m } = await db().from("missions").select("project_id").eq("id", input.mission_id).maybeSingle();
        if (!m) return { label: "No such mission", result: "Mission not found.", isError: true };
        await db().from("tasks").insert({ title: String(input.title).slice(0, 200), project_id: m.project_id, mission_id: input.mission_id, priority: 2 });
        return { label: `Added step: ${input.title}`, result: "Added." };
      }
      case "start_helper": {
        const p = input.project_name ? await findProject(input.project_name as string) : null;
        if (input.project_name && !p) return noProject(input.project_name);
        const hours = Math.max(0.25, Math.min(24 * 7, Number(input.check_every_hours) || 6));
        const wake = ((input.wake_on as string[]) ?? []).filter((e) => ["approval_decided", "runbook_finished", "job_finished", "mission_finished"].includes(e));
        const [h] = unwrap(await db().from("missions").insert({
          project_id: p?.id ?? null, goal: String(input.responsibility).slice(0, 600), ongoing: true, wake_on: wake,
          check_every_minutes: Math.round(hours * 60), next_check_at: new Date(Date.now() + 60_000).toISOString(),
          work_dir: (p as { local_path?: string | null } | null)?.local_path ?? null,
        }).select());
        const { logMission } = await import("@/lib/missions");
        await logMission(h.id, "note", `Helper started: ${input.responsibility}`);
        await did(`Started a helper${p ? ` for ${p.name}` : ""}: ${String(input.responsibility).slice(0, 60)}`, { op: "update", table: "missions", id: h.id, values: { status: "stopped" } });
        return { label: `Helper started${p ? ` for ${p.name}` : ""}`, result: `Helper ${h.id} is on. First look in about a minute, then every ${hours} hour(s)${wake.length ? `, and when: ${wake.join(", ")}` : ""}. It only messages Thomas for a decision or a result worth knowing.` };
      }
      case "tell_thomas": {
        const { data: m } = await db().from("missions").select("id,project_id").eq("id", input.mission_id).maybeSingle();
        if (!m) return { label: "No such helper", result: "Mission not found.", isError: true };
        const { logMission } = await import("@/lib/missions");
        const msg = String(input.message).slice(0, 600);
        await logMission(m.id, "told", msg);
        const { data: pj } = m.project_id ? await db().from("projects").select("name").eq("id", m.project_id).maybeSingle() : { data: null };
        await notify(`💡 **${pj?.name ?? "MyManager"}**\n${msg}`).catch(() => false);
        return { label: "Told Thomas", result: "Sent." };
      }
      case "stop_mission": {
        const { data: m } = await db().from("missions").select("id,goal").eq("id", input.mission_id).maybeSingle();
        if (!m) return { label: "No such mission", result: "Mission not found.", isError: true };
        const { finishMission } = await import("@/lib/missions");
        await finishMission(m.id, "stopped");
        return { label: `Stopped: ${String(m.goal).slice(0, 60)}`, result: "Stopped." };
      }
      case "mission_update": {
        const { data: m } = await db().from("missions").select("id,ongoing").eq("id", input.mission_id).maybeSingle();
        if (!m) return { label: "No such mission", result: "Mission not found.", isError: true };
        await db().from("missions").update({ last_update: String(input.update).slice(0, 400) }).eq("id", input.mission_id);
        if (input.status === "done" && !m.ongoing) {
          // The server decides whether it's really finished, not the model's say-so.
          const { finishMission, whyNotFinished } = await import("@/lib/missions");
          const why = await whyNotFinished(input.mission_id as string);
          if (why) return { label: "Not finished yet", result: `Saved the update, but the mission stays open: ${why}`, isError: true };
          await finishMission(input.mission_id as string, "done");
        }
        return { label: input.status === "done" && !m.ongoing ? "Mission finished" : "Noted where it's at", result: m.ongoing && input.status === "done" ? "Saved. Helpers keep going until Thomas stops them." : "Saved." };
      }
      case "ask_thomas": {
        const { askThomas } = await import("@/lib/missions");
        const ok = await askThomas(input.mission_id as string, String(input.question));
        return ok ? { label: "Asked you a question", result: "Sent to Thomas. The mission waits for his answer." } : { label: "No such mission", result: "Mission not found.", isError: true };
      }
      case "run_coding_step": {
        const { startCodingStep } = await import("@/lib/missions");
        const r = await startCodingStep(input.mission_id as string, String(input.instructions));
        return { label: r.startsWith("Started") ? "Started a coding step" : "Couldn't start coding", result: r, isError: !r.startsWith("Started") };
      }
      case "request_push": {
        const { data: m } = await db().from("missions").select("id,project_id,goal,work_dir").eq("id", input.mission_id).maybeSingle();
        if (!m?.work_dir) return { label: "Nothing to push", result: "This mission has no folder on the PC.", isError: true };
        const { shortId } = await import("@/lib/missions");
        const { branchSummary } = await import("@/lib/local-repos");
        const branch = `mymanager/${shortId(m.id)}`;
        const sum = await branchSummary(m.work_dir, branch);
        if (!sum.log) return { label: "Nothing to push", result: `The branch ${branch} has no new commits.`, isError: true };
        // The approval is for this exact commit: if the branch moves before Thomas says yes, nothing is pushed.
        const { execFile } = await import("node:child_process");
        const sha = await new Promise<string>((res) => execFile("git", ["-C", m.work_dir, "rev-parse", `refs/heads/${branch}`], { windowsHide: true }, (e, out) => res(e ? "" : out.trim())));
        if (!/^[0-9a-f]{40}$/.test(sha)) return { label: "Nothing to push", result: `Couldn't read the latest commit on ${branch}.`, isError: true };
        const a = await queueAction({
          kind: "code.push", requested_by: "agent", project_id: m.project_id, cost_cents: 0,
          reason: `${m.goal}. ${sum.stat || ""}`.trim(),
          title: `Push ${branch} (commit ${sha.slice(0, 7)}) to GitHub`,
          payload: { mission_id: m.id, dir: m.work_dir, branch, sha, changes: sum.log.slice(0, 1500) },
        });
        return { label: "Asked you to push the work", result: `Waiting in Approvals (${a.status}). Once pushed, Thomas reviews and merges it on GitHub himself.` };
      }
      case "answer_mission": {
        const { answerMission } = await import("@/lib/missions");
        const ok = await answerMission(input.mission_id as string, String(input.answer));
        return ok ? { label: "Passed on your answer", result: "Done. The mission is carrying on." } : { label: "No such mission", result: "Mission not found.", isError: true };
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
