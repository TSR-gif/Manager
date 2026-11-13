import { decideAction, markActionDone, saveSettings } from "@/app/actions";
import { getActions, getProjects, getSettings, monthSpendCents } from "@/lib/queries";
import { kindOf } from "@/lib/action-registry";
import { ago, money } from "@/components/ui";

export const dynamic = "force-dynamic";

const statusStyle: Record<string, string> = {
  executed: "#4ade80", approved: "#7c9cff", pending: "#facc15", rejected: "#94a3b8", failed: "#f87171",
};

export default async function Approvals() {
  const [actions, projects, settings, spent] = await Promise.all([getActions(), getProjects(), getSettings(), monthSpendCents()]);
  const pname = (id: string | null) => projects.find((p) => p.id === id)?.name;
  const pending = actions.filter((a) => a.status === "pending");
  const handoff = actions.filter((a) => a.status === "approved");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Approvals</h1>

      <section>
        <div className="label mb-2">Waiting for you · {pending.length}</div>
        {pending.length === 0 && <div className="text-sm text-muted">Nothing needs approval.</div>}
        <ul className="space-y-3">
          {pending.map((a) => (
            <li key={a.id} className="card">
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip">{kindOf(a.kind).label}</span>
                {pname(a.project_id) && <span className="chip">{pname(a.project_id)}</span>}
                {a.cost_cents > 0 && <span className="chip" style={{ color: "#facc15" }}>{money(a.cost_cents)}</span>}
                <span className="ml-auto text-xs text-muted">by {a.requested_by} · {ago(a.created_at)}</span>
              </div>
              <div className="mt-2 font-semibold">{a.title}</div>
              {a.reason && <div className="text-sm text-muted">{a.reason}</div>}
              {Object.keys(a.payload).length > 0 && (
                <pre className="mt-2 overflow-x-auto rounded-lg bg-panel2 p-2 text-xs text-muted">{JSON.stringify(a.payload, null, 2)}</pre>
              )}
              <div className="mt-3 flex gap-2">
                <form action={decideAction.bind(null, a.id, true)} className="flex-1"><button className="btn btn-good w-full">Approve</button></form>
                <form action={decideAction.bind(null, a.id, false)} className="flex-1"><button className="btn btn-bad w-full">Reject</button></form>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {handoff.length > 0 && (
        <section>
          <div className="label mb-2">Approved, waiting to be carried out · {handoff.length}</div>
          <ul className="space-y-2">
            {handoff.map((a) => (
              <li key={a.id} className="card">
                <div className="font-semibold">{a.title}</div>
                <form action={markActionDone.bind(null, a.id)} className="mt-2 flex gap-2">
                  <input name="note" placeholder="What happened? (optional)" />
                  <button className="btn">Mark done</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="label mb-2">Guardrails</div>
        <div className="mb-3 text-sm">Spent this month: <b>{money(spent)}</b> of {money(settings.monthly_cap_cents)}</div>
        <form action={saveSettings} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <label><span className="label">Per purchase cap $</span><input name="per_purchase_cap" type="number" step="1" defaultValue={settings.per_purchase_cap_cents / 100} /></label>
          <label><span className="label">Monthly cap $</span><input name="monthly_cap" type="number" step="1" defaultValue={settings.monthly_cap_cents / 100} /></label>
          <label><span className="label">Max active projects</span><input name="max_active_projects" type="number" min="1" defaultValue={settings.max_active_projects} /></label>
          <label><span className="label">Focus block (min)</span><input name="focus_minutes" type="number" min="5" defaultValue={settings.focus_minutes} /></label>
          <button className="btn col-span-2 md:col-span-4">Save guardrails</button>
        </form>
        <p className="mt-2 text-xs text-muted">Anything over a cap is blocked automatically. Card details and passwords are never stored here.</p>
      </section>

      <section>
        <div className="label mb-2">Audit log</div>
        <ul className="divide-y divide-line text-sm">
          {actions.map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: statusStyle[a.status] }} />
              <span className="min-w-0 flex-1 truncate">{a.title}</span>
              {a.cost_cents > 0 && <span className="text-muted">{money(a.cost_cents)}</span>}
              {a.result && "url" in a.result && <a href={String(a.result.url)} className="text-accent" target="_blank">open ↗</a>}
              {a.result && "blocked" in a.result && <span className="text-xs text-red-400">{String(a.result.blocked)}</span>}
              {a.result && "error" in a.result && <span className="max-w-40 truncate text-xs text-red-400">{String(a.result.error)}</span>}
              <span className="w-20 shrink-0 text-right text-xs text-muted">{a.status} · {ago(a.created_at)}</span>
            </li>
          ))}
          {actions.length === 0 && <li className="py-2 text-muted">No actions yet.</li>}
        </ul>
      </section>
    </div>
  );
}
