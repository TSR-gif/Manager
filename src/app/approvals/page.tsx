import { CheckCircle2, CircleDashed, CircleSlash, Clock, ExternalLink, ScrollText, XCircle } from "lucide-react";
import { decideAction, markActionDone } from "@/app/actions";
import { getActions, getProjects, getSettings, monthSpendCents } from "@/lib/queries";
import { kindOf } from "@/lib/action-registry";
import { Empty, ago, money } from "@/components/ui";
import { SocialPreview, type SocialPayload } from "@/components/social-preview";


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

  return (
    <div className="fade-in mx-auto max-w-[620px] space-y-7 pt-2 md:pt-8">
      <header>
        <h1 className="display text-[26px] md:text-[28px]">Waiting for your OK</h1>
        <p className="mt-1 text-[14px] text-muted">{pending.length ? `${pending.length} thing${pending.length === 1 ? "" : "s"}.` : "Nothing right now."} {money(spent)} spent of {money(settings.monthly_cap_cents)} this month.</p>
      </header>

      {pending.length > 0 && (
        <ul className="card divide-y divide-line !p-0">
          {pending.map((a) => (
            <li key={a.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1 text-[14.5px] leading-snug">
                  {a.title}
                  {pname(a.project_id) && <span className="block text-[12.5px] text-faint">{pname(a.project_id)}</span>}
                </div>
                <form action={decideAction.bind(null, a.id, false)}><button className="btn btn-ghost btn-sm">Not now</button></form>
                <form action={decideAction.bind(null, a.id, true)}><button className="btn btn-good btn-sm">{a.cost_cents > 0 ? `OK, ${money(a.cost_cents)}` : "OK"}</button></form>
              </div>
              {(a.reason || a.kind.startsWith("social.") || a.kind.startsWith("ads.")) && (
                <details className="mt-1">
                  <summary className="cursor-pointer list-none text-[12.5px] text-faint hover:text-muted">{a.kind.startsWith("social.") ? "Show the post" : a.kind.startsWith("ads.") ? "Show the ad" : "Why"}</summary>
                  {a.reason && <div className="mt-2 whitespace-pre-line text-[13px] text-muted">{a.reason}</div>}
                  {a.kind.startsWith("social.") && <div className="mt-2 rounded-xl border border-line bg-bg2/60 p-3"><SocialPreview p={a.payload as SocialPayload} /></div>}
                  {a.kind.startsWith("ads.") && (() => { const q = a.payload as { audience?: string; creative?: string; platform?: string }; return (
                    <div className="mt-2 space-y-1.5 rounded-xl border border-line bg-bg2/60 p-3 text-[13px]">
                      {q.platform && <div><span className="text-faint">Where: </span>{q.platform === "meta" ? "Facebook + Instagram" : q.platform}</div>}
                      {q.audience && <div><span className="text-faint">Who sees it: </span>{q.audience}</div>}
                      {q.creative && <div className="whitespace-pre-wrap"><span className="text-faint">The ad: </span>{q.creative}</div>}
                    </div>); })()}
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      {handoff.length > 0 && (
        <section>
          <h2 className="mb-2 text-[15px] font-semibold px-1">Your turn: tick off when you&apos;ve done it</h2>
          <ul className="card divide-y divide-line !p-0">
            {handoff.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 text-[14.5px] leading-snug">{a.title}</div>
                <form action={markActionDone.bind(null, a.id)}><button className="btn btn-good btn-sm">{a.kind === "social.post" ? "I posted it" : a.kind === "social.reply" ? "I sent it" : a.kind === "ads.launch" ? "I launched it" : "Done"}</button></form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="group">
        <summary className="cursor-pointer list-none px-1 text-[13px] text-faint hover:text-muted">Everything I&apos;ve done</summary>
        {actions.length === 0 && <Empty icon={<ScrollText size={18} />} title="Nothing yet" hint="Everything the assistant does is recorded here." />}
        <ul className="card mt-2 divide-y divide-line !py-1 text-[13.5px]">
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
      </details>
    </div>
  );
}
