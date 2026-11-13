export type ProjectStatus = "active" | "paused" | "idea" | "done" | "archived";

export interface Project {
  kind?: "app" | "client" | "personal";
  id: string;
  name: string;
  status: ProjectStatus;
  priority: number; // 1 = highest
  next_action: string | null;
  goal: string | null;
  notes: string | null;
  github_repo: string | null;
  vercel_project: string | null;
  deadline: string | null;
  last_touched_at: string;
  created_at: string;
}

export interface Task {
  id: string;
  project_id: string | null;
  title: string;
  status: "todo" | "doing" | "done";
  priority: number;
  due: string | null;
  created_at: string;
  done_at: string | null;
}

export interface Idea {
  id: string;
  text: string;
  status: "inbox" | "promoted" | "parked" | "killed";
  project_id: string | null;
  created_at: string;
  triaged_at: string | null;
}

export interface FocusSession {
  id: string;
  project_id: string | null;
  task_id: string | null;
  planned_minutes: number;
  started_at: string;
  ended_at: string | null;
  outcome: string | null;
}

export type ActionStatus = "pending" | "approved" | "rejected" | "executed" | "failed";

export interface Action {
  id: string;
  kind: string;
  title: string;
  reason: string | null;
  payload: Record<string, unknown>;
  risk: "auto" | "approval" | "blocked";
  cost_cents: number;
  status: ActionStatus;
  project_id: string | null;
  requested_by: string;
  result: Record<string, unknown> | null;
  created_at: string;
  decided_at: string | null;
  executed_at: string | null;
}

export interface Settings {
  id: number;
  max_active_projects: number;
  per_purchase_cap_cents: number;
  monthly_cap_cents: number;
  focus_minutes: number;
  last_review_at: string | null;
  autonomy?: "ask" | "balanced" | "decide";
  trust_after?: number;
}

export interface Signals {
  github?: {
    lastPushAt: string | null;
    openPRs: number;
    openIssues: number;
    error?: string;
  };
  vercel?: {
    state: string | null; // READY | ERROR | BUILDING | ...
    url: string | null;
    createdAt: string | null;
    error?: string;
  };
}
