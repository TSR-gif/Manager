import { X } from "lucide-react";
import { deleteTask, setTaskStatus } from "@/app/actions";
import { CheckIcon, dueInfo, projectColor } from "./ui";
import type { Task } from "@/lib/types";

export function TaskItem({ t, projectName, compact }: { t: Task; projectName?: string; compact?: boolean }) {
  const due = dueInfo(t.due);
  const done = t.status === "done";
  return (
    <li className={`group flex items-center gap-3 rounded-xl px-2 ${compact ? "py-2" : "py-2.5"} transition hover:bg-panel2/70`}>
      <form action={setTaskStatus.bind(null, t.id, done ? "todo" : "done")}>
        <button aria-label={done ? "Mark not done" : "Mark done"} className={`check ${done ? "check-done" : ""}`}><CheckIcon /></button>
      </form>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[14.5px] ${done ? "text-faint line-through" : ""}`}>{t.title}</div>
        {(projectName || t.status === "doing" || due) && (
          <div className="mt-0.5 flex items-center gap-2 text-[12px]">
            {projectName && (
              <span className="flex items-center gap-1.5 text-muted">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: projectColor(projectName) }} />{projectName}
              </span>
            )}
            {t.status === "doing" && <span className="font-medium text-accent">In progress</span>}
            {due && <span className={due.tone === "bad" ? "text-bad" : due.tone === "warn" ? "text-warn" : "text-muted"}>{due.text}</span>}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 hidden md:flex md:opacity-0 md:transition md:group-hover:opacity-100">
        <form action={deleteTask.bind(null, t.id)}>
          <button className="btn btn-ghost btn-sm hover:!text-bad" aria-label="Delete"><X size={14} /></button>
        </form>
      </div>
    </li>
  );
}
