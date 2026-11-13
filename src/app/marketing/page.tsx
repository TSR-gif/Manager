import Link from "next/link";
import { CalendarDays, CircleDollarSign, Clock, Megaphone, MessageCircle, Pause, Play, Plus, Repeat, Rocket, Sparkles, Trash2 } from "lucide-react";
import {
  decideAction, deleteJob, logCampaignResults, markActionDone, requestLaunch, runJobNow, saveCampaign, saveJob, setCampaignStatus, toggleJob,
} from "@/app/actions";
import { db } from "@/lib/db";
import { getActions, getProjects, getSettings } from "@/lib/queries";
import { DAYS, scheduleText, dayList, type Job } from "@/lib/jobs";
import { Empty, ProjectAvatar, ago, money } from "@/components/ui";
import { SocialPreview, type SocialPayload } from "@/components/social-preview";
import type { Action } from "@/lib/types";

export const dynamic = "force-dynamic";

interface Campaign {
  id: string; project_id: string | null; name: string; platform: string; goal: string | null; audience: string | null; creative: string | null;
  daily_budget_cents: number; days: number; status: string; spend_cents: number; installs: number; clicks: number; impressions: number;
  started_on: string | null; notes: string | null; created_at: string;
}

const PLATFORM: Record<string, string> = { meta: "Facebook + Instagram", tiktok: "TikTok", google: "Google", apple: "App Store search" };
const CAMPAIGN_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "" },
  waiting: { label: "Waiting for your OK", cls: "chip-warn" },
  ready: { label: "Approved: ready to launch", cls: "chip-accent" },
  live: { label: "Live", cls: "chip-good" },
  paused: { label: "Paused", cls: "" },
  ended: { label: "Ended", cls: "" },
};
const DAY_SHORT: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

const TEMPLATES = [
  { name: "Weekly social posts", days: "wed", at: "14:00", text: "Make this week's posts for TikTok and Instagram from real numbers only. Make 3 posts, each a picture slideshow (5 to 8 slides), a friendly caption and 5 to 10 hashtags. Never invent numbers: if you can't read real data, draft nothing and tell me what you need." },
  { name: "Reply to comments", days: "mon,wed,fri", at: "18:00", text: "Draft friendly, honest replies to any new comments or questions I've given you. One reply draft each. Never promise anything the app doesn't do." },
  { name: "Weekly post report", days: "mon", at: "09:00", text: "Write a short report: which posts went out last week and which brought downloads, using any real numbers you can read. Finish with the one change to make next week." },
];

/** Which weekday a suggested time like "Wed 6 pm" falls on, if any. */
const dayOf = (s?: string | null) => {
  const k = (s ?? "").trim().slice(0, 3).toLowerCase();
  return (DAYS as readonly string[]).includes(k) ? k : null;
};

function Section({ icon, title, count, hint, children, action }: { icon: React.ReactNode; title: string; count?: number; hint?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-accent2">{icon}</span>
        <h2 className="kicker !text-muted">{title}</h2>
        {count != null && <span className="text-[13px] text-faint">{count}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {hint && <p className="-mt-1.5 mb-3 text-[13px] text-muted">{hint}</p>}
      {children}
    </section>
  );
}

function JobForm({ j, projectId }: { j?: Partial<Job>; projectId: string }) {
  const days = dayList(j?.days ?? "wed");
  return (
    <form action={saveJob} className="space-y-3">
      {j?.id && <input type="hidden" name="id" value={j.id} />}
      <input type="hidden" name="project_id" value={projectId} />
      <label className="block space-y-1.5"><span className="label">Name</span><input name="name" defaultValue={j?.name ?? ""} placeholder="e.g. Weekly social posts" required /></label>
      <label className="block space-y-1.5"><span className="label">What should MyManager do?</span><textarea name="instructions" rows={4} defaultValue={j?.instructions ?? ""} placeholder="Say it like you'd say it to a person." required /></label>
      <div className="space-y-1.5">
        <span className="label">Which days</span>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d) => (
            <label key={d} className="cursor-pointer">
              <input type="checkbox" name="days" value={d} defaultChecked={days.includes(d)} className="peer sr-only" />
              <span className="chip !px-3 !py-1.5 text-[13px] peer-checked:border-[rgba(56,189,248,.5)] peer-checked:bg-[rgba(56,189,248,.18)] peer-checked:text-[#c7d2fe] peer-focus-visible:ring-2 peer-focus-visible:ring-accent">{DAY_SHORT[d]}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
        <label className="block space-y-1.5"><span className="label">Time</span><input type="time" name="at_time" defaultValue={j?.at_time ?? "14:00"} /></label>
        <label className="block space-y-1.5"><span className="label">Where to read real numbers (optional)</span><input name="source_url" type="url" defaultValue={j?.source_url ?? ""} placeholder="A link to a price export or report" /></label>
      </div>
      <button className="btn btn-primary">{j?.id ? "Save changes" : "Add job"}</button>
    </form>
  );
}

export default async function Marketing({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  const [projects, actions, settings, jobsQ, campaignsQ] = await Promise.all([
    getProjects(), getActions(), getSettings(),
    db().from("jobs").select("*").order("created_at"),
    db().from("campaigns").select("*").order("created_at", { ascending: false }),
  ]);
  const jobs = (jobsQ.data ?? []) as Job[];
  const campaigns = (campaignsQ.data ?? []) as Campaign[];
  const name = (settings as { assistant_name?: string }).assistant_name || "MyManager";
  const marketingIds = new Set([
    ...jobs.map((j) => j.project_id), ...campaigns.map((c) => c.project_id),
    ...actions.filter((a) => a.kind.startsWith("social.") || a.kind.startsWith("ads.")).map((a) => a.project_id),
  ]);
  const choices = projects.filter((p) => p.status !== "done" && (marketingIds.has(p.id) || p.status === "active"))
    .sort((a, b) => Number(marketingIds.has(b.id)) - Number(marketingIds.has(a.id)));
  const p = projects.find((x) => x.id === project) ?? choices[0];

  if (!p) {
    return <div className="card"><Empty icon={<Megaphone size={18} />} title="No projects yet" hint="Add a project first, then plan its posts and ads here." /></div>;
  }

  const mine = actions.filter((a) => a.project_id === p.id);
  const posts = mine.filter((a) => a.kind === "social.post");
  const upcoming = posts.filter((a) => a.status === "pending" || a.status === "approved");
  const posted = posts.filter((a) => a.status === "executed").slice(0, 6);
  const replies = mine.filter((a) => a.kind === "social.reply" && (a.status === "pending" || a.status === "approved"));
  const pJobs = jobs.filter((j) => j.project_id === p.id);
  const pAds = campaigns.filter((c) => c.project_id === p.id);
  const launchFor = (cid: string) => mine.find((a) => a.kind === "ads.launch" && a.status === "approved" && (a.payload as { campaign_id?: string }).campaign_id === cid);
  const byDay = new Map<string, Action[]>();
  for (const a of upcoming) {
    const d = dayOf((a.payload as SocialPayload).post_at) ?? "any";
    byDay.set(d, [...(byDay.get(d) ?? []), a]);
  }
  const ask = (q: string) => `/agent?ask=${encodeURIComponent(q)}`;
  const adTotals = pAds.reduce((t, c) => ({ spend: t.spend + c.spend_cents, installs: t.installs + c.installs }), { spend: 0, installs: 0 });

  return (
    <div className="pagewrap wide fade-in space-y-8">
      <header className="space-y-3">
        <div>
          <h1 className="display text-[26px] md:text-[30px]">Marketing</h1>
          <p className="mt-1 text-[14px] text-muted">Posts, replies and ads for your apps. {name} drafts them; nothing goes out and no money is spent until you say yes.</p>
        </div>
        {choices.length > 1 && (
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {choices.map((x) => (
              <Link key={x.id} href={`/marketing?project=${x.id}`} className={`chip shrink-0 !gap-2 !px-3 !py-1.5 text-[13px] ${x.id === p.id ? "chip-accent" : ""}`}>
                <ProjectAvatar name={x.name} size={18} />{x.name}
              </Link>
            ))}
          </div>
        )}
      </header>

      <section className="card space-y-3">
        <div className="flex items-center gap-2"><Sparkles size={16} className="text-accent" /><span className="font-semibold">Ask {name}</span></div>
        <p className="text-[13.5px] text-muted">Say it in plain words. Drafts land in Approvals with a preview.</p>
        <div className="flex flex-wrap gap-2">
          <Link className="btn btn-sm" href={ask(`Make 3 social posts for ${p.name} this week, from real numbers only. Ask me if you can't find the numbers.`)}>Make this week&apos;s posts</Link>
          <Link className="btn btn-sm" href={ask(`Draft an ad campaign for ${p.name}. Suggest the platform, audience, a small daily budget and the creative, from real facts about the app.`)}>Draft an ad</Link>
          <Link className="btn btn-sm" href={ask(`Help me reply to comments on ${p.name}'s posts. I'll paste them in.`)}>Reply to comments</Link>
          <Link className="btn btn-sm" href={ask(`How are ${p.name}'s posts and ads going? What should I change next week?`)}>How is it going?</Link>
        </div>
      </section>

      <Section icon={<CalendarDays size={16} />} title="Coming up" count={upcoming.length} hint="Drafts waiting for your OK, and approved posts ready for you to post.">
        {upcoming.length === 0 ? (
          <div className="card"><Empty icon={<CalendarDays size={18} />} title="No posts planned" hint={`Ask ${name} to make this week's posts, or switch on the weekly job below.`} /></div>
        ) : (
          <div className="space-y-4">
            {[...DAYS, "any"].filter((d) => byDay.has(d)).map((d) => (
              <div key={d}>
                <div className="label mb-2">{d === "any" ? "Any day" : { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" }[d]}</div>
                <ul className="grid gap-3 md:grid-cols-2">
                  {byDay.get(d)!.map((a) => (
                    <li key={a.id} className={`card space-y-3 ${a.status === "pending" ? " card-alert" : ""}`}>
                      <div className="flex items-center gap-2">
                        <span className={`chip ${a.status === "pending" ? "chip-warn" : "chip-good"}`}>{a.status === "pending" ? "Waiting for your OK" : "Approved: ready to post"}</span>
                        <span className="ml-auto text-[12px] text-faint">{ago(a.created_at)}</span>
                      </div>
                      <div className="font-semibold">{a.title}</div>
                      <SocialPreview p={a.payload as SocialPayload} />
                      {a.status === "pending" ? (
                        <div className="flex gap-2">
                          <form action={decideAction.bind(null, a.id, true)} className="flex-1"><button className="btn btn-good w-full">Approve</button></form>
                          <form action={decideAction.bind(null, a.id, false)} className="flex-1"><button className="btn btn-bad w-full">Not this one</button></form>
                        </div>
                      ) : (
                        <form action={markActionDone.bind(null, a.id)} className="flex gap-2">
                          <input name="note" placeholder="Link to the post (optional)" />
                          <button className="btn btn-good shrink-0">I posted it</button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {posted.length > 0 && (
          <details className="card mt-3">
            <summary className="cursor-pointer text-[14px] font-medium">Posted recently <span className="text-faint">{posted.length}</span></summary>
            <ul className="mt-3 divide-y divide-line text-[13.5px]">
              {posted.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 truncate">{a.title}</span>
                  <span className="text-[12px] text-faint">{ago(a.executed_at ?? a.decided_at ?? a.created_at)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      {replies.length > 0 && (
        <Section icon={<MessageCircle size={16} />} title="Reply drafts" count={replies.length} hint="Copy a reply and send it yourself from the app.">
          <ul className="grid gap-3 md:grid-cols-2">
            {replies.map((a) => (
              <li key={a.id} className="card space-y-3">
                <SocialPreview p={a.payload as SocialPayload} />
                <div className="flex gap-2">
                  {a.status === "pending" ? (
                    <>
                      <form action={decideAction.bind(null, a.id, true)} className="flex-1"><button className="btn btn-good w-full">Looks good</button></form>
                      <form action={decideAction.bind(null, a.id, false)} className="flex-1"><button className="btn btn-bad w-full">Skip</button></form>
                    </>
                  ) : (
                    <form action={markActionDone.bind(null, a.id)} className="flex-1"><input type="hidden" name="note" value="" /><button className="btn btn-good w-full">I sent it</button></form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        icon={<CircleDollarSign size={16} />} title="Ads" count={pAds.length}
        hint={`Launching an ad or changing its budget always asks you first and counts towards your spending limits (${money(settings.per_purchase_cap_cents)} per item, ${money(settings.monthly_cap_cents)} a month).`}
      >
        {pAds.length > 0 && (adTotals.spend > 0 || adTotals.installs > 0) && (
          <div className="card mb-3 flex flex-wrap gap-x-6 gap-y-1 !py-3 text-[14px]">
            <span><b>{money(adTotals.spend)}</b> <span className="text-muted">spent on ads</span></span>
            <span><b>{adTotals.installs}</b> <span className="text-muted">downloads from ads</span></span>
            {adTotals.installs > 0 && <span><b>{money(Math.round(adTotals.spend / adTotals.installs))}</b> <span className="text-muted">per download</span></span>}
          </div>
        )}
        {pAds.length === 0 && <div className="card mb-3"><Empty icon={<Megaphone size={18} />} title="No ads yet" hint={`Ask ${name} to draft one, or start one yourself below. Small daily budgets are a good way to test.`} /></div>}
        <ul className="grid gap-3 md:grid-cols-2">
          {pAds.map((c) => {
            const st = CAMPAIGN_STATUS[c.status] ?? { label: c.status, cls: "" };
            const launch = launchFor(c.id);
            return (
              <li key={c.id} className="card space-y-3">
                <div className="flex items-center gap-2">
                  <span className={`chip ${st.cls}`}>{st.label}</span>
                  <span className="ml-auto text-[12px] text-faint">{PLATFORM[c.platform] ?? c.platform}</span>
                </div>
                <div>
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-[13px] text-muted">{money(c.daily_budget_cents)} a day for {c.days} days · {money(c.daily_budget_cents * c.days)} in total</div>
                </div>
                {c.goal && <div className="text-[13.5px]"><span className="text-faint">Goal: </span>{c.goal}</div>}
                {c.audience && <div className="text-[13.5px]"><span className="text-faint">Who sees it: </span>{c.audience}</div>}
                {c.creative && <div className="whitespace-pre-wrap rounded-xl border border-line bg-bg2/60 p-3 text-[13px]">{c.creative}</div>}
                {c.notes && <div className="text-[13px] text-warn">{c.notes}</div>}
                {(c.status === "live" || c.status === "paused" || c.status === "ended") && (
                  <div className="grid grid-cols-3 gap-2 text-center text-[12px] text-muted">
                    <div className="rounded-lg bg-panel2 py-2"><div className="text-[15px] font-semibold text-text">{money(c.spend_cents)}</div>spent</div>
                    <div className="rounded-lg bg-panel2 py-2"><div className="text-[15px] font-semibold text-text">{c.installs}</div>downloads</div>
                    <div className="rounded-lg bg-panel2 py-2"><div className="text-[15px] font-semibold text-text">{c.installs ? money(Math.round(c.spend_cents / c.installs)) : "–"}</div>per download</div>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {c.status === "draft" && (
                    <form action={requestLaunch}><input type="hidden" name="id" value={c.id} /><button className="btn btn-primary btn-sm"><Rocket size={13} /> Ask to launch</button></form>
                  )}
                  {c.status === "waiting" && <Link href="/approvals" className="btn btn-sm">Open Approvals</Link>}
                  {c.status === "ready" && (launch ? (
                    <form action={markActionDone.bind(null, launch.id)}><input type="hidden" name="note" value="Launched in the ads dashboard" /><button className="btn btn-good btn-sm"><Rocket size={13} /> I&apos;ve launched it</button></form>
                  ) : (
                    <form action={setCampaignStatus}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="live" /><button className="btn btn-good btn-sm"><Rocket size={13} /> I&apos;ve launched it</button></form>
                  ))}
                  {c.status === "live" && (
                    <form action={setCampaignStatus}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="paused" /><button className="btn btn-sm"><Pause size={13} /> I paused it</button></form>
                  )}
                  {c.status === "paused" && (
                    <form action={setCampaignStatus}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="live" /><button className="btn btn-sm"><Play size={13} /> It&apos;s back on</button></form>
                  )}
                  {(c.status === "live" || c.status === "paused") && (
                    <form action={setCampaignStatus}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="ended" /><button className="btn btn-ghost btn-sm">It&apos;s finished</button></form>
                  )}
                </div>
                {(c.status === "live" || c.status === "paused") && (
                  <details>
                    <summary className="cursor-pointer text-[13px] text-accent">Update results from the ads dashboard</summary>
                    <form action={logCampaignResults} className="mt-2 grid grid-cols-2 gap-2">
                      <input type="hidden" name="id" value={c.id} />
                      <label className="space-y-1"><span className="label">Spent ($)</span><input name="spend" inputMode="decimal" defaultValue={(c.spend_cents / 100).toFixed(2)} /></label>
                      <label className="space-y-1"><span className="label">Downloads</span><input name="installs" inputMode="numeric" defaultValue={c.installs} /></label>
                      <label className="space-y-1"><span className="label">Clicks</span><input name="clicks" inputMode="numeric" defaultValue={c.clicks} /></label>
                      <label className="space-y-1"><span className="label">Views</span><input name="impressions" inputMode="numeric" defaultValue={c.impressions} /></label>
                      <button className="btn btn-good col-span-2">Save results</button>
                    </form>
                  </details>
                )}
                {c.status === "draft" && (
                  <details>
                    <summary className="cursor-pointer text-[13px] text-accent">Edit</summary>
                    <CampaignForm c={c} projectId={p.id} />
                  </details>
                )}
              </li>
            );
          })}
        </ul>
        <details className="card mt-3">
          <summary className="flex cursor-pointer items-center gap-2 text-[14px] font-medium"><Plus size={15} /> Start an ad yourself</summary>
          <CampaignForm projectId={p.id} />
        </details>
      </Section>

      <Section
        icon={<Repeat size={16} />} title="Things it does every week" count={pJobs.length}
        hint="Standing jobs run on their own at the time you pick. They only make drafts; you approve anything that goes out."
      >
        <ul className="space-y-3">
          {pJobs.map((j) => (
            <li key={j.id} className="card space-y-2">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{j.name}</div>
                  <div className="flex items-center gap-1.5 text-[13px] text-muted"><Clock size={12} />{scheduleText(j)}{j.last_run_at ? ` · last ran ${ago(j.last_run_at)}` : ""}</div>
                </div>
                <form action={toggleJob}>
                  <input type="hidden" name="id" value={j.id} />
                  <button className={`chip !px-3 !py-1.5 text-[12.5px] ${j.enabled ? "chip-good" : ""}`} aria-label={j.enabled ? "Switch off" : "Switch on"}>{j.enabled ? "On" : "Off"}</button>
                </form>
              </div>
              <p className="line-clamp-2 text-[13.5px] text-muted">{j.instructions}</p>
              <div className="flex flex-wrap items-center gap-2">
                <form action={runJobNow}><input type="hidden" name="id" value={j.id} /><button className="btn btn-sm"><Play size={13} /> Run now</button></form>
                {j.last_run_id && <Link href={`/agent?run=${j.last_run_id}`} className="btn btn-ghost btn-sm">See last run</Link>}
                <details className="w-full">
                  <summary className="cursor-pointer text-[13px] text-accent">Edit</summary>
                  <div className="mt-3"><JobForm j={j} projectId={p.id} /></div>
                  <form action={deleteJob} className="mt-3"><input type="hidden" name="id" value={j.id} /><button className="btn btn-ghost btn-sm text-bad"><Trash2 size={13} /> Delete this job</button></form>
                </details>
              </div>
            </li>
          ))}
          {pJobs.length === 0 && <li className="card"><Empty icon={<Repeat size={18} />} title="No weekly jobs" hint="Pick a starting point below." /></li>}
        </ul>
        <details className="card mt-3">
          <summary className="flex cursor-pointer items-center gap-2 text-[14px] font-medium"><Plus size={15} /> Add a weekly job</summary>
          <div className="mt-3 space-y-4">
            <div className="flex flex-wrap gap-2">
              {TEMPLATES.filter((t) => !pJobs.some((j) => j.name === t.name)).map((t) => (
                <form key={t.name} action={saveJob}>
                  <input type="hidden" name="project_id" value={p.id} />
                  <input type="hidden" name="name" value={t.name} />
                  <input type="hidden" name="instructions" value={t.text} />
                  {t.days.split(",").map((d) => <input key={d} type="hidden" name="days" value={d} />)}
                  <input type="hidden" name="at_time" value={t.at} />
                  <button className="btn btn-sm"><Plus size={13} /> {t.name}</button>
                </form>
              ))}
            </div>
            <JobForm projectId={p.id} />
          </div>
        </details>
      </Section>
    </div>
  );
}

function CampaignForm({ c, projectId }: { c?: Campaign; projectId: string }) {
  return (
    <form action={saveCampaign} className="mt-3 space-y-3">
      {c && <input type="hidden" name="id" value={c.id} />}
      <input type="hidden" name="project_id" value={projectId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5"><span className="label">Name</span><input name="name" defaultValue={c?.name ?? ""} placeholder="e.g. Grocery savers, Melbourne" required /></label>
        <label className="block space-y-1.5"><span className="label">Where</span>
          <select name="platform" defaultValue={c?.platform ?? "meta"}>
            {Object.entries(PLATFORM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      <label className="block space-y-1.5"><span className="label">Goal</span><input name="goal" defaultValue={c?.goal ?? ""} placeholder="e.g. 100 new downloads" /></label>
      <label className="block space-y-1.5"><span className="label">Who should see it</span><input name="audience" defaultValue={c?.audience ?? ""} placeholder="e.g. 25 to 45, Melbourne, interested in groceries and saving money" /></label>
      <label className="block space-y-1.5"><span className="label">What the ad shows and says</span><textarea name="creative" rows={3} defaultValue={c?.creative ?? ""} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1.5"><span className="label">Per day ($)</span><input name="daily" inputMode="decimal" defaultValue={c ? (c.daily_budget_cents / 100).toFixed(0) : "5"} /></label>
        <label className="block space-y-1.5"><span className="label">For how many days</span><input name="days" inputMode="numeric" defaultValue={c?.days ?? 7} /></label>
      </div>
      <button className="btn btn-primary">{c ? "Save" : "Save as draft"}</button>
      <p className="text-[12.5px] text-faint">Saving doesn&apos;t spend anything. You ask to launch it as a separate step.</p>
    </form>
  );
}
