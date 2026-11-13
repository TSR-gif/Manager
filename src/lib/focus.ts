import type { Project, Signals, Task } from "./types";

const DAY = 86_400_000;

export interface Scored {
  project: Project;
  score: number;
  reasons: string[];
}

/**
 * Decide what deserves attention. Higher score = work on it now.
 * Inputs: priority, deadline, staleness, broken deploys, open tasks.
 */
export function scoreProject(
  p: Project,
  tasks: Task[],
  signals: Signals | undefined,
  now = Date.now(),
): Scored {
  const reasons: string[] = [];
  let score = (6 - p.priority) * 20; // P1 = 100, P5 = 20
  reasons.push(`P${p.priority}`);

  if (p.deadline) {
    const days = Math.ceil((new Date(p.deadline).getTime() - now) / DAY);
    if (days < 0) {
      score += 60;
      reasons.push(`overdue by ${-days}d`);
    } else if (days <= 7) {
      score += 45 - days * 4;
      reasons.push(`due in ${days}d`);
    } else if (days <= 30) {
      score += 10;
      reasons.push(`due in ${days}d`);
    }
  }

  const lastPush = signals?.github?.lastPushAt ? new Date(signals.github.lastPushAt).getTime() : 0;
  const touched = Math.max(new Date(p.last_touched_at).getTime(), lastPush);
  const idle = Math.floor((now - touched) / DAY);
  if (idle >= 14) {
    score += 15;
    reasons.push(`stale ${idle}d`);
  } else if (idle >= 5) {
    score += 8;
    reasons.push(`idle ${idle}d`);
  } else if (idle <= 1) {
    score += 5; // momentum: keep going on what's hot
    reasons.push("momentum");
  }

  if (signals?.vercel?.state === "ERROR") {
    score += 40;
    reasons.push("deploy failing");
  }

  const open = tasks.filter((t) => t.project_id === p.id && t.status !== "done");
  const overdueTasks = open.filter((t) => t.due && new Date(t.due).getTime() < now).length;
  if (overdueTasks) {
    score += 10 * Math.min(overdueTasks, 3);
    reasons.push(`${overdueTasks} overdue task${overdueTasks > 1 ? "s" : ""}`);
  }
  if (open.length === 0) {
    score -= 10;
    reasons.push("no tasks yet");
  }

  return { project: p, score, reasons };
}

export function rankProjects(
  projects: Project[],
  tasks: Task[],
  signals: Record<string, Signals>,
): Scored[] {
  return projects
    .filter((p) => p.status === "active")
    .map((p) => scoreProject(p, tasks, signals[p.id]))
    .sort((a, b) => b.score - a.score);
}

export function nextTasks(projectId: string, tasks: Task[], n = 3): Task[] {
  const now = Date.now();
  return tasks
    .filter((t) => t.project_id === projectId && t.status !== "done")
    .sort((a, b) => {
      if (a.status === "doing" && b.status !== "doing") return -1;
      if (b.status === "doing" && a.status !== "doing") return 1;
      const ad = a.due ? new Date(a.due).getTime() : Infinity;
      const bd = b.due ? new Date(b.due).getTime() : Infinity;
      const aOver = ad < now, bOver = bd < now;
      if (aOver !== bOver) return aOver ? -1 : 1;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return ad - bd;
    })
    .slice(0, n);
}
