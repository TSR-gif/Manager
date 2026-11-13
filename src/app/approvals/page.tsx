import { Fragment } from "react";
import Link from "next/link";
import { Bot, CheckCircle2, CircleDashed, CircleSlash, Clock, ExternalLink, Gauge, ScrollText, ShieldCheck, User, XCircle } from "lucide-react";
import { decideAction, markActionDone } from "@/app/actions";
import { getActions, getProjects, getSettings, monthSpendCents } from "@/lib/queries";
import { kindOf } from "@/lib/action-registry";
import { Empty, ProjectAvatar, ago, money } from "@/components/ui";
import { SocialPreview, type SocialPayload } from "@/components/social-preview";

const readyLabel = (kind: string) => (kind === "social.post" ? "Ready to post" : kind === "social.reply" ? "Ready to send" : kind === "ads.launch" ? "Ready to launch" : null);

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
  const who = (r: string) => (r === "agent" ? (settings as { assistant_name?: string }).assistant_name || "MyManager" : "You");
  const paired = !!(settings as { telegram_chat_id?: string | null }).telegram_chat_id;

  return (
    <div className="fade-in space-y-7">
      <header>
        <h1 className="text-[28px] font-semibold tracking-tight">Approvals</h1>
        <p className="mt-1 text-[14px] text-muted">Anything that spends money, signs you up or speaks for you waits here for your OK.</p>
      </header>

      <section>
        <div className="mb-3 flex items-baseline gap-2"><h2 className="text-[15px] font-semibold">Waiting for you</h2><span className="text-[13px] text-faint">{pending.length}</span></div>
        {pending.length === 0 && <div className="card"><Empty icon={<ShieldCheck size={18} />} title="Nothing waiting" hint="When the assistant needs your OK, it shows up here (and on your phone if you set that up)." /></div>}
        <ul className="grid gap-3 md:grid-cols-2">
          {pending.map((a) => (
            <li key={a.id} className="card flex flex-col !border-[rgba(255,200,87,.3)]">
              <div className="flex items-center gap-2">
                <span className="chip chip-warn">{kindOf(a.kind).label}</span>
                {a.cost_cents > 0 && <span className="chip chip-bad">{money(a.cost_cents)}</span>}
                <span className="ml-auto flex items-center gap-1 text-[12px] text-muted">
                  {a.requested_by === "agent" ? <Bot size={12} /> : <User size={12} />}{who(a.requested_by)} · {ago(a.created_at)}
                </span>
              </div>
              <div className="mt-3 text-[16px] font-semibold">{a.title}</div>
              {pname(a.project_id) && (
                <div className="mt-1 flex items-center gap-2 text-[13px] text-muted"><ProjectAvatar name={pname(a.project_id)!} size={18} />{pname(a.project_id)}</div>
              )}
              {a.reason && <div className="mt-2 text-[13.5px] text-muted">{a.reason}</div>}
              {a.kind.startsWith("social.") ? (
                <div className="mt-3 rounded-xl border border-line bg-bg2/60 p-3"><SocialPreview p={a.payload as SocialPayload} /></div>
              ) : a.kind.startsWith("ads.") ? (
                <div className="mt-3 space-y-1.5 rounded-xl border border-line bg-bg2/60 p-3 text-[13px]">
                  {(() => { const q = a.payload as { audience?: string; creative?: string; platform?: string }; return (<>
                    {q.platform && <div><span className="text-faint">Where: </span>{q.platform === "meta" ? "Facebook + Instagram" : q.platform}</div>}
                    {q.audience && <div><span className="text-faint">Who sees it: </span>{q.audience}</div>}
                    {q.creative && <div className="whitespace-pre-wrap"><span className="text-faint">The ad: </span>{q.creative}</div>}
                    <div className="text-[12px] text-faint">Approving doesn&apos;t launch it. You launch it in the ads dashboard, then tick it off here.</div>
                  </>); })()}
                </div>
              ) : Object.keys(a.payload).length > 0 && (
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
          <div className="mb-3 flex items-baseline gap-2"><h2 className="text-[15px] font-semibold">Approved: tick off when done</h2><span className="text-[13px] text-faint">{handoff.length}</span></div>
          <ul className="space-y-2">
            {handoff.map((a) => (
              <li key={a.id} className="card flex flex-col gap-3 md:flex-row md:items-center">
                <div className="flex-1">
                  <div className="font-medium">{a.title}</div>
                  <div className="text-[12px] text-muted">{readyLabel(a.kind) ?? kindOf(a.kind).label} · approved {ago(a.decided_at)}</div>
                  {a.kind.startsWith("social.") && <details className="mt-2"><summary className="cursor-pointer text-[13px] text-accent">Show the post</summary><div className="mt-2"><SocialPreview p={a.payload as SocialPayload} /></div></details>}
                </div>
                <form action={markActionDone.bind(null, a.id)} className="flex gap-2 md:w-[380px]">
                  <input name="note" placeholder="Any note? (optional)" />
                  <button className="btn btn-good shrink-0">{a.kind === "social.post" ? "I posted it" : a.kind === "social.reply" ? "I sent it" : a.kind === "ads.launch" ? "I launched it" : "Mark done"}</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link href="/settings" className="card card-hover flex items-center gap-3 !py-3.5">
        <Gauge size={17} className="shrink-0 text-accent2" />
        <div className="min-w-0 flex-1 text-[14px]">
          <div><b>{money(spent)}</b> <span className="text-muted">spent this month, limit {money(settings.monthly_cap_cents)}</span></div>
          <div className="text-[12.5px] text-muted">{paired ? "Approvals also go to your phone." : "Want approvals on your phone? Set it up in Settings."}</div>
        </div>
        <span className="text-[13px] text-accent">Settings</span>
      </Link>

      <section className="card">
        <div className="mb-2 flex items-center gap-2"><ScrollText size={16} className="text-muted" /><span className="font-semibold">History</span></div>
        {actions.length === 0 && <Empty icon={<ScrollText size={18} />} title="Nothing yet" hint="Everything the assistant does is recorded here." />}
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
                    {kindOf(a.kind).label}{pname(a.project_id) ? ` · ${pname(a.project_id)}` : ""} · {who(a.requested_by)}
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
