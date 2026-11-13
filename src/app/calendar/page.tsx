import { Plus, Timer } from "lucide-react";
import { addTask, endFocus, startFocus } from "@/app/actions";
import { getActiveFocus, getProjects, getSettings, getTasks } from "@/lib/queries";
import { db } from "@/lib/db";
import { todayISO } from "@/components/ui";
import { TaskItem } from "@/components/task-item";
import { Head } from "@/components/nav";
import { AskBar } from "@/components/ask-bar";
import { dayList, type Job } from "@/lib/jobs";

export const dynamic = "force-dynamic";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const time12 = (t: string) => { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`; };

/** Calendar: reminders and dated to-dos, weekly jobs, and focus blocks, for the next two weeks. No notes on people. */
export default async function CalendarPage() {
  const [tasks, projects, focus, settings, jq] = await Promise.all([
    getTasks(), getProjects(), getActiveFocus(), getSettings(), db().from("jobs").select("*").eq("enabled", true),
  ]);
  const jobs = (jq.data ?? []) as Job[];
  const pname = (id: string | null) => projects.find((p) => p.id === id)?.name;
  const today = todayISO();
  const days = Array.from({ length: 14 }, (_, i) => todayISO(i));
  const dated = tasks.filter((t) => t.due);
  const earlier = dated.filter((t) => t.due!.slice(0, 10) < today);
  const undated = tasks.filter((t) => !t.due && !t.project_id);
  const label = (d: string, i: number) => i === 0 ? "Today" : i === 1 ? "Tomorrow" : new Date(`${d}T12:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short" });
  const weekday = (d: string) => DAY_KEYS[new Date(`${d}T12:00:00`).getDay()];
  const nowTask = tasks.find((t) => t.status === "doing") ?? dated.find((t) => t.due!.slice(0, 10) <= today) ?? undated[0];

  return (
    <>
      <Head title="Calendar" />
      <div className="pagewrap fade-in">
        <h1 className="ttl">Calendar</h1>

        <form action={addTask} className="mt-3 flex flex-wrap gap-2 rounded-[10px] border border-line p-2">
          <input name="title" required autoComplete="off" placeholder="Remind me to…" className="!h-10 min-w-0 flex-[1_1_14rem] !border-0 !shadow-none" />
          <input name="due" type="date" required defaultValue={today} className="!h-10 !w-auto" />
          <button className="btn btn-primary !h-10"><Plus size={16} /> Add</button>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13.5px] text-muted">
          {focus ? (
            <>
              <Timer size={16} /> Focusing since {new Date(focus.started_at).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" })} ({focus.planned_minutes} min)
              <form action={endFocus}><input type="hidden" name="outcome" value="done" /><button className="btn btn-sm">Finished</button></form>
              <form action={endFocus}><input type="hidden" name="outcome" value="abandoned" /><button className="btn btn-ghost btn-sm">Stop</button></form>
            </>
          ) : (
            <form action={startFocus} className="flex items-center gap-2">
              <input type="hidden" name="project_id" value={nowTask?.project_id ?? ""} />
              <input type="hidden" name="task_id" value={nowTask?.id ?? ""} />
              <input type="hidden" name="minutes" value={settings.focus_minutes} />
              <button className="btn btn-sm max-w-[calc(100vw-32px)]"><Timer size={14} className="shrink-0" /><span className="truncate">Block {settings.focus_minutes} min to focus{nowTask ? ` on "${nowTask.title}"` : ""}</span></button>
            </form>
          )}
        </div>

        {earlier.length > 0 && (
          <>
            <div className="sec">From earlier</div>
            <ul className="-mx-2">{earlier.map((t) => <TaskItem key={t.id} t={t} projectName={pname(t.project_id)} compact />)}</ul>
          </>
        )}

        {days.map((d, i) => {
          const items = dated.filter((t) => t.due!.slice(0, 10) === d);
          const dayJobs = jobs.filter((j) => dayList(j.days).includes(weekday(d)));
          if (!items.length && !dayJobs.length && i > 0) return null;
          return (
            <section key={d}>
              <div className="sec">{label(d, i)}</div>
              {!items.length && !dayJobs.length && <div className="text-[14px] text-muted">Nothing on today.</div>}
              {dayJobs.map((j) => (
                <div key={j.id} className="wk">
                  <div className="tile sm" style={{ background: "#fdeee6" }}>🔁</div>
                  <div className="dt"><b className="truncate">{j.name}</b><span>{time12(j.at_time)}{pname(j.project_id) ? ` · ${pname(j.project_id)}` : ""} · I do this one</span></div>
                </div>
              ))}
              <ul className="-mx-2">{items.map((t) => <TaskItem key={t.id} t={t} projectName={pname(t.project_id)} compact />)}</ul>
            </section>
          );
        })}

        <div className="sec">No date</div>
        <div className="rounded-[10px] border border-line px-2 py-1.5">
          {undated.length === 0 && <div className="px-2 py-2.5 text-[14px] text-muted">Nothing waiting. Helpers keep their own to-dos.</div>}
          <ul>{undated.slice(0, 15).map((t) => <TaskItem key={t.id} t={t} compact />)}</ul>
          <form action={addTask} className="flex items-center gap-2 border-t border-line px-2 pb-1 pt-2">
            <Plus size={16} className="ml-1 text-faint" />
            <input name="title" placeholder="Add something to do" autoComplete="off" required className="!h-9 flex-1 !border-0 !bg-transparent !px-1 !shadow-none text-[14px]" />
          </form>
        </div>

        <AskBar placeholder="Add or move something: &quot;dentist Tuesday 3 pm&quot;" />
      </div>
    </>
  );
}
