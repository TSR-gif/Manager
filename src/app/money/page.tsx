import Link from "next/link";
import { BadgeDollarSign, Briefcase, Clock, CreditCard, Plus, Receipt, Repeat, Trash2, Wallet } from "lucide-react";
import { createInvoice, deleteTimeEntry, logTime, saveClientSettings, saveSubscription, setInvoiceStatus, setSubscriptionStatus } from "@/app/actions";
import { getClientJobs, getSubscriptions, hours, monthlyCents } from "@/lib/money";
import { getProjects } from "@/lib/queries";
import { getMoney } from "@/lib/up";
import { Empty, ProjectAvatar, todayISO } from "@/components/ui";

export const dynamic = "force-dynamic";

const $ = (c: number) => `$${(c / 100).toLocaleString("en-AU", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const nice = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "");

const INV_TONE: Record<string, string> = { draft: "", sent: "chip-warn", paid: "chip-good", void: "" };

function Tile({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: string; hint?: string; tone: string }) {
  return (
    <div className="card flex items-center gap-3 !p-4">
      <div className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${tone} 15%, transparent)`, color: tone }}>{icon}</div>
      <div className="min-w-0">
        <div className="text-[21px] font-semibold leading-none tabular-nums">{value}</div>
        <div className="mt-1 truncate text-[12px] text-muted">{label}{hint ? <span className="text-faint"> · {hint}</span> : null}</div>
      </div>
    </div>
  );
}

export default async function MoneyPage() {
  const [jobs, subs, projects, up] = await Promise.all([getClientJobs(), getSubscriptions(), getProjects(), getMoney()]);
  const owed = jobs.reduce((s, j) => s + j.owedCents, 0);
  const overdue = jobs.reduce((s, j) => s + j.overdueCents, 0);
  const unbilled = jobs.reduce((s, j) => s + j.unbilledCents, 0);
  const live = subs.filter((s) => s.status !== "cancelled");
  const perMonth = live.reduce((s, x) => s + monthlyCents(x), 0);
  const pname = (id: string | null) => projects.find((p) => p.id === id)?.name;
  const byProject = new Map<string, number>();
  for (const s of live) byProject.set(pname(s.project_id) ?? "Personal / general", (byProject.get(pname(s.project_id) ?? "Personal / general") ?? 0) + monthlyCents(s));
  const soon = live.filter((s) => s.next_renewal && s.next_renewal <= todayISO(7));

  return (
    <div className="fade-in space-y-7">
      <header>
        <h1 className="text-[28px] font-semibold tracking-tight">Money</h1>
        <p className="mt-1 text-[14px] text-muted">What you&apos;re owed, what you&apos;ve earned, and what everything costs you each month.</p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile icon={<BadgeDollarSign size={19} />} label="Owed to you" value={$(owed)} hint={overdue ? `${$(overdue)} overdue` : undefined} tone={overdue ? "var(--bad)" : "var(--good)"} />
        <Tile icon={<Clock size={19} />} label="Not invoiced" value={$(unbilled)} tone="var(--warn)" />
        <Tile icon={<Repeat size={19} />} label="Subs / month" value={$(perMonth)} hint={`${live.length} active`} tone="var(--accent)" />
        {up.configured && !up.error
          ? <Tile icon={<Wallet size={19} />} label="Up balance" value={$(up.balanceCents ?? 0)} hint={`${$(up.spent30dCents ?? 0)} spent 30d`} tone="var(--accent-2)" />
          : <Tile icon={<Wallet size={19} />} label="Bank" value="—" hint={up.configured ? up.error : "not connected"} tone="var(--muted)" />}
      </div>

      {/* ---------- client jobs ---------- */}
      <section>
        <div className="mb-3 flex items-baseline gap-2"><h2 className="text-[15px] font-semibold">Client jobs</h2><span className="text-[13px] text-faint">{jobs.length}</span></div>
        {jobs.length === 0 && (
          <div className="card"><Empty icon={<Briefcase size={18} />} title="No client jobs" hint="Mark a project as a client job to track hours and invoices here." /></div>
        )}
        <div className="space-y-4">
          {jobs.map((j) => {
            const p = j.project;
            const rate = p.hourly_rate_cents ?? 0;
            return (
              <div key={p.id} className="card space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <ProjectAvatar name={p.name} size={38} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/projects/${p.id}`} className="text-[16px] font-semibold hover:text-accent">{p.name}</Link>
                    <div className="text-[12.5px] text-muted">{p.client_name ? `Client: ${p.client_name}` : "Client job"}{rate ? ` · ${$(rate)}/h` : " · no hourly rate set"}</div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="chip">{hours(j.minutesTotal)} logged</span>
                    {j.owedCents > 0 && <span className={`chip ${j.overdueCents ? "chip-bad" : "chip-warn"}`}>{$(j.owedCents)} owed</span>}
                    {j.paidCents > 0 && <span className="chip chip-good">{$(j.paidCents)} paid</span>}
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-3">
                    <form action={logTime} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="project_id" value={p.id} />
                      <label className="w-20 space-y-1"><span className="label">Hours</span><input name="hours" type="number" step="0.25" min="0.25" placeholder="2.5" required /></label>
                      <label className="w-36 space-y-1"><span className="label">Day</span><input name="worked_on" type="date" defaultValue={todayISO()} /></label>
                      <label className="min-w-[8rem] flex-1 space-y-1"><span className="label">What you did</span><input name="note" placeholder="Site visit, quote…" /></label>
                      <button className="btn btn-primary"><Plus size={15} /> Log</button>
                    </form>
                    <ul className="divide-y divide-line text-[13.5px]">
                      {j.entries.slice(0, 6).map((e) => (
                        <li key={e.id} className="flex items-center gap-3 py-2">
                          <span className="w-14 text-muted">{nice(e.worked_on)}</span>
                          <span className="w-14 font-medium tabular-nums">{hours(e.minutes)}</span>
                          <span className="min-w-0 flex-1 truncate text-muted">{e.note}</span>
                          {e.invoice_id ? <span className="chip">invoiced</span> : (
                            <form action={deleteTimeEntry}><input type="hidden" name="id" value={e.id} /><button className="text-faint hover:text-bad" aria-label="Delete"><Trash2 size={14} /></button></form>
                          )}
                        </li>
                      ))}
                      {j.entries.length === 0 && <li className="py-2 text-[13px] text-faint">No hours logged yet. You can also tell the assistant &quot;log 3 hours on Altona&quot;.</li>}
                    </ul>
                  </div>

                  <div className="space-y-3">
                    <form action={createInvoice} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="project_id" value={p.id} />
                      <label className="min-w-[9rem] flex-1 space-y-1">
                        <span className="label">{j.minutesUnbilled && rate ? `Invoice ${hours(j.minutesUnbilled)} = ${$(j.unbilledCents)}` : "Fixed amount $"}</span>
                        <input name="amount" placeholder={j.unbilledCents ? "or type a fixed amount" : "e.g. 1500"} />
                      </label>
                      <button className="btn"><Receipt size={15} /> Create invoice</button>
                    </form>
                    <ul className="divide-y divide-line text-[13.5px]">
                      {j.invoices.slice(0, 6).map((i) => (
                        <li key={i.id} className="flex flex-wrap items-center gap-2 py-2">
                          <span className="w-16 font-medium">{i.number}</span>
                          <span className="tabular-nums">{$(i.amount_cents)}</span>
                          <span className={`chip ${INV_TONE[i.status]}`}>{i.status}{i.status === "sent" && i.due_on ? ` · due ${nice(i.due_on)}` : ""}{i.status === "paid" && i.paid_on ? ` ${nice(i.paid_on)}` : ""}</span>
                          <span className="ml-auto flex gap-1">
                            {(i.status === "draft" ? ["sent", "void"] : i.status === "sent" ? ["paid", "void"] : []).map((st) => (
                              <form key={st} action={setInvoiceStatus}>
                                <input type="hidden" name="id" value={i.id} /><input type="hidden" name="status" value={st} />
                                <button className={`btn !h-7 !px-2.5 text-[12px] ${st === "paid" ? "btn-primary" : ""}`}>{st === "sent" ? "Mark sent" : st === "paid" ? "Mark paid" : "Void"}</button>
                              </form>
                            ))}
                          </span>
                        </li>
                      ))}
                      {j.invoices.length === 0 && <li className="py-2 text-[13px] text-faint">No invoices yet.</li>}
                    </ul>
                  </div>
                </div>

                <details className="text-[13px]">
                  <summary className="cursor-pointer text-muted hover:text-text">Client name and hourly rate</summary>
                  <form action={saveClientSettings} className="mt-2 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="project_id" value={p.id} />
                    <label className="min-w-[10rem] flex-1 space-y-1"><span className="label">Client</span><input name="client_name" defaultValue={p.client_name ?? ""} placeholder="Who pays you" /></label>
                    <label className="w-28 space-y-1"><span className="label">Rate $/h</span><input name="rate" defaultValue={rate ? rate / 100 : ""} placeholder="80" /></label>
                    <button className="btn">Save</button>
                  </form>
                </details>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------- subscriptions ---------- */}
      <section>
        <div className="mb-3 flex items-baseline gap-2"><h2 className="text-[15px] font-semibold">Subscriptions</h2><span className="text-[13px] text-faint">{$(perMonth)}/month · {$(perMonth * 12)}/year</span></div>
        {soon.length > 0 && (
          <div className="card mb-3 !border-[rgba(255,200,87,.35)] text-[13.5px]">
            <b>Renewing this week:</b> {soon.map((s) => `${s.name} (${$(s.amount_cents)} on ${nice(s.next_renewal)})`).join(", ")}
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="card !p-0">
            <ul className="divide-y divide-line text-[13.5px]">
              {subs.map((s) => (
                <li key={s.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${s.status === "cancelled" ? "opacity-45" : ""}`}>
                  <CreditCard size={15} className="text-faint" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-accent">{s.name}</a> : s.name}</div>
                    <div className="text-[12px] text-faint">{pname(s.project_id) ?? "Personal / general"}{s.next_renewal ? ` · renews ${nice(s.next_renewal)}` : ""}{s.status === "trial" ? " · trial" : ""}</div>
                  </div>
                  <div className="text-right tabular-nums">
                    <div>{$(s.amount_cents)}<span className="text-faint">/{s.cycle === "monthly" ? "mo" : s.cycle === "yearly" ? "yr" : "wk"}</span></div>
                    {s.cycle !== "monthly" && <div className="text-[11.5px] text-faint">{$(monthlyCents(s))}/mo</div>}
                  </div>
                  <form action={setSubscriptionStatus}>
                    <input type="hidden" name="id" value={s.id} /><input type="hidden" name="status" value={s.status === "cancelled" ? "active" : "cancelled"} />
                    <button className="btn !h-7 !px-2.5 text-[12px]">{s.status === "cancelled" ? "Restore" : "Cancelled it"}</button>
                  </form>
                </li>
              ))}
              {subs.length === 0 && <li className="p-4"><Empty icon={<Repeat size={18} />} title="Nothing tracked yet" hint="Add what you pay for: hosting, domains, apps, tools." /></li>}
            </ul>
          </div>
          <div className="space-y-4">
            <form action={saveSubscription} className="card space-y-2.5">
              <div className="text-[13px] font-semibold">Add a subscription</div>
              <input name="name" placeholder="Vercel Pro, domain, Canva…" required />
              <div className="flex gap-2">
                <input name="amount" placeholder="$ amount" required className="!w-auto min-w-0 flex-1" />
                <select name="cycle" defaultValue="monthly" className="w-28"><option value="monthly">monthly</option><option value="yearly">yearly</option><option value="weekly">weekly</option></select>
              </div>
              <select name="project_id" defaultValue=""><option value="">Personal / general</option>{projects.filter((p) => p.status !== "archived").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <label className="block space-y-1"><span className="label">Next renewal</span><input name="next_renewal" type="date" /></label>
              <button className="btn btn-primary w-full"><Plus size={15} /> Add</button>
            </form>
            {byProject.size > 0 && (
              <div className="card text-[13px]">
                <div className="mb-2 font-semibold">Per project / month</div>
                <ul className="space-y-1.5">
                  {[...byProject.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => (
                    <li key={n} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-muted">{n}</span>
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((c / Math.max(1, perMonth)) * 100)}%` }} /></div>
                      <span className="w-14 text-right tabular-nums">{$(c)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
