import { Fragment } from "react";
import { Bot, Send, Smartphone, CheckCircle2, CircleDashed, CircleSlash, Clock, ExternalLink, Gauge, ScrollText, ShieldCheck, User, XCircle } from "lucide-react";
import { decideAction, markActionDone, saveSettings, unpairPhone } from "@/app/actions";
import { sessionToken } from "@/lib/auth";
import { getActions, getProjects, getSettings, monthSpendCents } from "@/lib/queries";
import { ACTION_KINDS, ALWAYS_ASK, kindOf } from "@/lib/action-registry";
import { trustLevel } from "@/lib/trust";
import { Empty, ProjectAvatar, ago, money } from "@/components/ui";

export const dynamic = "force-dynamic";

const statusMeta: Record<string, { icon: React.ReactNode; cls: string }> = {
  executed: { icon: <CheckCircle2 size={15} />, cls: "text-good" },
  approved: { icon: <CircleDashed size={15} />, cls: "text-accent" },
  pending: { icon: <Clock size={15} />, cls: "text-warn" },
  rejected: { icon: <CircleSlash size={15} />, cls: "text-faint" },
  failed: { icon: <XCircle size={15} />, cls: "text-bad" },
};

export default async function Approvals() {
  const [actions, projects, settings, spent] = await Promise.all([getActions(), getProjects(), getSettings(), monthSpendCents()]);
  const pname = (id: string | null) => projects.find((p) => p.id === id)?.name;
  const pending = actions.filter((a) => a.status === "pending");
  const handoff = actions.filter((a) => a.status === "approved");
  const ladder = await Promise.all(Object.values(ACTION_KINDS).filter((k) => k.trustable).map(async (k) => ({ k, t: await trustLevel(k.kind) })));
  const pairCode = (await sessionToken()).slice(0, 8).toUpperCase();
  const botOn = !!process.env.TELEGRAM_BOT_TOKEN;
  const paired = !!(settings as { telegram_chat_id?: string | null }).telegram_chat_id;
  const pct = Math.min(100, (spent / Math.max(1, settings.monthly_cap_cents)) * 100);

  return (
    <div className="fade-in space-y-7">
      <header>
        <h1 className="text-[28px] font-semibold tracking-tight">Approvals</h1>
        <p className="mt-1 text-[14px] text-muted">Nothing risky happens until you say so. Everything Manager does is logged here.</p>
      </header>

      <section>
        <div className="mb-3 flex items-baseline gap-2"><h2 className="text-[15px] font-semibold">Waiting for you</h2><span className="text-[13px] text-faint">{pending.length}</span></div>
        {pending.length === 0 && <div className="card"><Empty icon={<ShieldCheck size={18} />} title="All clear" hint="Requests from you or the agent show up here." /></div>}
        <ul className="grid gap-3 md:grid-cols-2">
          {pending.map((a) => (
            <li key={a.id} className="card flex flex-col !border-[rgba(255,200,87,.3)]">
              <div className="flex items-center gap-2">
                <span className="chip chip-warn">{kindOf(a.kind).label}</span>
                {a.cost_cents > 0 && <span className="chip chip-bad">{money(a.cost_cents)}</span>}
                <span className="ml-auto flex items-center gap-1 text-[12px] text-muted">
                  {a.requested_by === "agent" ? <Bot size={12} /> : <User size={12} />}{a.requested_by} · {ago(a.created_at)}
                </span>
              </div>
              <div className="mt-3 text-[16px] font-semibold">{a.title}</div>
              {pname(a.project_id) && (
                <div className="mt-1 flex items-center gap-2 text-[13px] text-muted"><ProjectAvatar name={pname(a.project_id)!} size={18} />{pname(a.project_id)}</div>
              )}
              {a.reason && <div className="mt-2 text-[13.5px] text-muted">{a.reason}</div>}
              {Object.keys(a.payload).length > 0 && (
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl border border-line bg-bg2/60 p-3 text-[12.5px]">
                  {Object.entries(a.payload).map(([k, v]) => (
                    <Fragment key={k}><dt className="text-faint">{k}</dt><dd className="truncate">{String(v)}</dd></Fragment>
                  ))}
                </dl>
              )}
              <div className="mt-4 flex gap-2">
                <form action={decideAction.bind(null, a.id, true)} className="flex-1"><button className="btn btn-good w-full !py-2.5">Approve</button></form>
                <form action={decideAction.bind(null, a.id, false)} className="flex-1"><button className="btn btn-bad w-full !py-2.5">Reject</button></form>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {handoff.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline gap-2"><h2 className="text-[15px] font-semibold">Approved, being carried out</h2><span className="text-[13px] text-faint">{handoff.length}</span></div>
          <ul className="space-y-2">
            {handoff.map((a) => (
              <li key={a.id} className="card flex flex-col gap-3 md:flex-row md:items-center">
                <div className="flex-1"><div className="font-medium">{a.title}</div><div className="text-[12px] text-muted">{kindOf(a.kind).label} · approved {ago(a.decided_at)}</div></div>
                <form action={markActionDone.bind(null, a.id)} className="flex gap-2 md:w-[380px]">
                  <input name="note" placeholder="What happened? (optional)" />
                  <button className="btn">Done</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="mb-2 flex items-center gap-2"><Smartphone size={16} className="text-accent" /><span className="font-semibold">Approve from your phone</span>
          <span className={`chip ml-auto ${paired ? "chip-good" : botOn ? "chip-warn" : ""}`}>{paired ? "Telegram paired" : botOn ? "Waiting to pair" : "Off"}</span>
        </div>
        {paired ? (
          <div className="flex flex-wrap items-center gap-3 text-[13.5px] text-muted">
            <span>Approvals arrive in Telegram with Approve / Deny buttons. Text the bot to ask the assistant, or start with <b className="text-text">+</b> to quick-add.</span>
            <form action={unpairPhone}><button className="btn !h-8 text-[12.5px]">Unpair</button></form>
          </div>
        ) : botOn ? (
          <p className="text-[13.5px] text-muted">Open your bot in Telegram and send <code className="rounded bg-panel3 px-1.5 py-0.5 text-text">/start {pairCode}</code></p>
        ) : (
          <ol className="list-decimal space-y-1 pl-5 text-[13.5px] text-muted">
            <li>In Telegram, message <b className="text-text">@BotFather</b>, send <code>/newbot</code> and pick a name.</li>
            <li>Paste the token it gives you into <code>.env.local</code> as <code>TELEGRAM_BOT_TOKEN=</code>, then restart Manager.</li>
            <li>Come back here for your pair code.</li>
          </ol>
        )}
        <div className="mt-2 flex items-center gap-1.5 text-[12px] text-faint"><Send size={12} /> Only your paired chat can approve. Money and signups still need your tap.</div>
      </section>

      <section className="card">
        <div className="mb-4 flex items-center gap-2"><Gauge size={16} className="text-accent2" /><span className="font-semibold">Guardrails</span></div>
        <div className="mb-5">
          <div className="mb-1.5 flex justify-between text-[13px]"><span className="text-muted">Spent this month</span><span><b>{money(spent)}</b> <span className="text-muted">of {money(settings.monthly_cap_cents)}</span></span></div>
          <div className="h-2 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct > 85 ? "var(--bad)" : pct > 60 ? "var(--warn)" : "var(--good)" }} />
          </div>
        </div>
        <form action={saveSettings} className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <label className="space-y-1.5"><span className="label">Max per purchase $</span><input name="per_purchase_cap" type="number" step="1" min="0" defaultValue={settings.per_purchase_cap_cents / 100} /></label>
          <label className="space-y-1.5"><span className="label">Monthly cap $</span><input name="monthly_cap" type="number" step="1" min="0" defaultValue={settings.monthly_cap_cents / 100} /></label>
          <label className="space-y-1.5"><span className="label">Active projects</span><input name="max_active_projects" type="number" min="1" defaultValue={settings.max_active_projects} /></label>
          <label className="space-y-1.5"><span className="label">Focus block min</span><input name="focus_minutes" type="number" min="5" defaultValue={settings.focus_minutes} /></label>
          <label className="space-y-1.5"><span className="label">Trust after N OKs</span><input name="trust_after" type="number" min="0" defaultValue={settings.trust_after ?? 3} /></label>
          <button className="btn col-span-2 md:col-span-5">Save guardrails</button>
        </form>
        <p className="mt-3 text-[12px] text-faint">Anything over a cap is blocked automatically. Card numbers and passwords are never stored in Manager.</p>
        <div className="mt-4 border-t border-line pt-4">
          <div className="mb-2 text-[13px] font-semibold">Trust ladder</div>
          <p className="mb-3 text-[12.5px] text-muted">Free, low-risk actions you approve {settings.trust_after ?? 3} times in a row start running on their own. One rejection resets it. Signups, payments, emails sent as you and PC use always ask ({ALWAYS_ASK.length} hard rules).</p>
          <ul className="space-y-2">
            {ladder.map(({ k, t }) => (
              <li key={k.kind} className="flex items-center gap-3 text-[13px]">
                <span className="w-40 truncate">{k.label}</span>
                <div className="flex flex-1 gap-1">
                  {Array.from({ length: Math.max(1, t.needed) }).map((_, i) => (
                    <span key={i} className={`h-1.5 flex-1 rounded-full ${i < t.streak ? "bg-good" : "bg-line"}`} />
                  ))}
                </div>
                <span className={`chip ${t.trusted ? "chip-good" : ""}`}>{t.needed === 0 ? "off" : t.trusted ? "runs on its own" : `${Math.min(t.streak, t.needed)}/${t.needed}`}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card">
        <div className="mb-2 flex items-center gap-2"><ScrollText size={16} className="text-muted" /><span className="font-semibold">Audit log</span></div>
        {actions.length === 0 && <Empty icon={<ScrollText size={18} />} title="No actions yet" />}
        <ul className="divide-y divide-line text-[13.5px]">
          {actions.map((a) => {
            const m = statusMeta[a.status];
            const r = a.result ?? {};
            return (
              <li key={a.id} className="flex items-center gap-3 py-2.5">
                <span className={m.cls}>{m.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate">{a.title}</div>
                  <div className="truncate text-[12px] text-faint">
                    {kindOf(a.kind).label}{pname(a.project_id) ? ` · ${pname(a.project_id)}` : ""} · {a.requested_by}
                    {"blocked" in r && <span className="text-bad"> · blocked: {String(r.blocked)}</span>}
                    {"error" in r && <span className="text-bad"> · {String(r.error)}</span>}
                    {"note" in r && r.note ? <span> · {String(r.note)}</span> : null}
                  </div>
                </div>
                {a.cost_cents > 0 && <span className="text-muted">{money(a.cost_cents)}</span>}
                {"url" in r && <a href={String(r.url)} className="text-accent" target="_blank"><ExternalLink size={14} /></a>}
                <span className="w-16 shrink-0 text-right text-[12px] text-muted">{ago(a.created_at)}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
