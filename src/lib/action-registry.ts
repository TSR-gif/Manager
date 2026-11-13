import "server-only";
import type { Action } from "./types";
import { vercelAuth } from "@/lib/vercel-auth";

/**
 * Every capability the Manager (or its Claude agent) can use is declared here.
 * risk:
 *   auto     - runs immediately, still written to the audit log
 *   approval - waits in the approval queue until Thomas taps Approve
 * Anything with a cost, a signup, a delete or an outbound message is "approval".
 */
export interface ActionKind {
  kind: string;
  label: string;
  risk: "auto" | "approval";
  /** Can graduate to running on its own after enough straight approvals. Never true for money, signups, messages as Thomas or PC use. */
  trustable?: boolean;
  execute?: (a: Action) => Promise<Record<string, unknown>>;
}

async function ghCreateIssue(a: Action) {
  const { repo, title, body } = a.payload as { repo: string; title: string; body?: string };
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({ title, body }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.message ?? `GitHub ${res.status}`);
  return { url: j.html_url, number: j.number };
}

async function vercelRedeploy(a: Action) {
  const { project } = a.payload as { project: string };
  const auth = vercelAuth();
  if (!auth.token) throw new Error("MyManager isn't signed in to Vercel on this PC yet");
  const team = auth.teamId ? `teamId=${encodeURIComponent(auth.teamId)}` : "";
  const headers = { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" };
  const list = await fetch(
    `https://api.vercel.com/v6/deployments?app=${encodeURIComponent(project)}&target=production&limit=1&${team}`,
    { headers },
  ).then((r) => r.json());
  const last = list.deployments?.[0];
  if (!last) throw new Error("No previous production deployment to redeploy");
  const res = await fetch(`https://api.vercel.com/v13/deployments?forceNew=1&${team}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: project, deploymentId: last.uid, target: "production" }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error?.message ?? `Vercel ${res.status}`);
  return { url: `https://${j.url}`, id: j.id };
}

export const ACTION_KINDS: Record<string, ActionKind> = {
  "github.create_issue": { kind: "github.create_issue", label: "Create GitHub issue", risk: "auto", execute: ghCreateIssue },
  "vercel.redeploy": { kind: "vercel.redeploy", label: "Redeploy on Vercel", risk: "approval", trustable: true, execute: vercelRedeploy },
  // Carried out by a person, the Claude agent, or the PC helper once approved.
  "signup": { kind: "signup", label: "Sign up for a service", risk: "approval" },
  "purchase": { kind: "purchase", label: "Pay for something", risk: "approval" },
  "email.send": { kind: "email.send", label: "Send an email", risk: "approval" },
  "pc.session": { kind: "pc.session", label: "Use your PC", risk: "approval" },
  // Drafts from recurring jobs. Approving marks it ready: Thomas (or his scheduler) posts it, and he sends replies himself.
  "social.post": { kind: "social.post", label: "Social media post", risk: "approval" },
  "social.reply": { kind: "social.reply", label: "Reply to a comment", risk: "approval" },
  // Supervise: letting MyManager edit a project's code on this PC, once per mission. Never trustable.
  "mission.code": {
    kind: "mission.code", label: "Work on your code", risk: "approval",
    execute: async (a) => {
      const { db } = await import("@/lib/db");
      const id = (a.payload as { mission_id?: string }).mission_id;
      if (!id) throw new Error("No mission");
      await db().from("missions").update({ can_code: true, next_check_at: new Date().toISOString() }).eq("id", id);
      return { note: "Coding allowed for this mission" };
    },
  },
  // Pushing a MyManager work branch to GitHub so Thomas can review/merge it there. Never trustable.
  "code.push": {
    kind: "code.push", label: "Push code to GitHub", risk: "approval",
    execute: async (a) => {
      const { dir, branch, sha } = a.payload as { dir: string; branch: string; sha?: string };
      const { pushBranch } = await import("@/lib/local-repos");
      return pushBranch(dir, branch, sha);
    },
  },
  // Runbooks: Thomas approves the whole list of PC steps; risky steps (deleting, setup commands) ask again. Never trustable.
  "runbook.run": {
    kind: "runbook.run", label: "Run steps on your PC", risk: "approval",
    execute: async (a) => {
      const { startRunbook } = await import("@/lib/runbooks");
      return startRunbook((a.payload as { runbook_id: string }).runbook_id);
    },
  },
  "runbook.step": {
    kind: "runbook.step", label: "One risky step on your PC", risk: "approval",
    execute: async (a) => {
      const { runbook_id, step_id } = a.payload as { runbook_id: string; step_id: string };
      const { resolveStep } = await import("@/lib/runbooks");
      await resolveStep(runbook_id, step_id, "approved");
      return { note: "Approved, carrying on" };
    },
  },
  // Ads are money: launching or raising a budget always asks and counts against the spend limits.
  "ads.launch": { kind: "ads.launch", label: "Launch an ad", risk: "approval" },
  "ads.budget": { kind: "ads.budget", label: "Change an ad budget", risk: "approval" },
  "ads.pause": { kind: "ads.pause", label: "Pause an ad", risk: "approval" },
  "other": { kind: "other", label: "Other", risk: "approval" },
};

/** Hard rule: these always ask, whatever the trust ladder or autonomy setting says. */
export const ALWAYS_ASK = ["signup", "purchase", "email.send", "pc.session", "social.post", "social.reply", "ads.launch", "ads.budget", "mission.code", "code.push", "runbook.run", "runbook.step"];

export function kindOf(kind: string): ActionKind {
  return ACTION_KINDS[kind] ?? ACTION_KINDS.other;
}
