import { Bell, Bot, CheckCircle2, Code2, ExternalLink, Landmark, Send, ShieldCheck, Sparkles, Timer } from "lucide-react";
import { setMessageMode, connectGithub, connectTelegram, connectUp, disconnectGithub, disconnectTelegram, disconnectUp, saveAssistant, saveSettings, setAutonomy, unpairPhone } from "@/app/actions";
import { sessionToken } from "@/lib/auth";
import { isLocal } from "@/lib/local-env";
import { githubAccess } from "@/lib/inspect";
import { getSettings, monthSpendCents } from "@/lib/queries";
import { money } from "@/components/ui";

export const dynamic = "force-dynamic";

const MSG: Record<string, [string, "good" | "bad"]> = {
  "telegram": ["Telegram connected. Now tap the button below to link your phone.", "good"],
  "telegram-off": ["Telegram disconnected.", "good"],
  "telegram-format": ["That doesn't look like a bot token. It looks like 123456789:AAH… (numbers, a colon, then letters).", "bad"],
  "telegram-rejected": ["Telegram didn't accept that token. Copy it again from BotFather and paste the whole thing.", "bad"],
  "up": ["Up connected. Your balance and spending now show on Today and Money.", "good"],
  "up-off": ["Up disconnected and the token removed from this PC.", "good"],
  "up-format": ["Paste the whole token from the Up app.", "bad"],
  "github": ["GitHub connected. Ask \"how is my Day trader going?\" to try it.", "good"],
  "github-off": ["GitHub disconnected and the token removed from this PC.", "good"],
  "github-format": ["Paste the whole token from GitHub (it starts with github_pat_).", "bad"],
  "github-rejected": ["GitHub didn't accept that token. Make a new one and try again.", "bad"],
  "up-rejected": ["Up didn't accept that token. Make a new one in the Up app and try again.", "bad"],
};

function Section({ id, icon, title, sub, children, status }: { id?: string; icon: React.ReactNode; title: string; sub: string; children: React.ReactNode; status?: React.ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-6">
      <div className="mb-4 flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-accent">{icon}</div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold">{title}</h2>
          <p className="text-[13.5px] text-muted">{sub}</p>
        </div>
        {status}
      </div>
      {children}
    </section>
  );
}

const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <li className="flex gap-3">
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-panel3 text-[12px] font-semibold text-muted">{n}</span>
    <div className="pt-0.5">{children}</div>
  </li>
);

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { ok, err } = await searchParams;
  const [settings, spent] = await Promise.all([getSettings(), monthSpendCents()]);
  const s = settings as typeof settings & { assistant_name?: string; autonomy?: string; proactive?: boolean; brief_time?: string; checkin_hours?: number; quiet_start?: string; telegram_chat_id?: string | null; telegram_bot_name?: string | null; trust_after?: number };
  const name = s.assistant_name || "MyManager";
  const autonomy = s.autonomy ?? "balanced";
  const mode = (s as { message_mode?: string }).message_mode ?? "daily";
  const local = isLocal();
  const botOn = !!process.env.TELEGRAM_BOT_TOKEN;
  const paired = !!s.telegram_chat_id;
  const pairCode = (await sessionToken()).slice(0, 8).toUpperCase();
  const upOn = !!process.env.UP_TOKEN;
  const gh = await githubAccess();
  const flash = MSG[ok ?? err ?? ""];
  const pct = Math.min(100, (spent / Math.max(1, s.monthly_cap_cents)) * 100);

  return (
    <div className="fade-in mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="display text-[26px] md:text-[30px]">Settings</h1>
        <p className="mt-1 text-[14px] text-muted">Everything here is optional. {name} works without any of it.</p>
      </header>

      {flash && (
        <div className={`card !py-3 text-[14px] ${flash[1] === "good" ? "!border-[rgba(52,211,153,.4)] text-good" : "!border-[rgba(248,113,113,.4)] text-bad"}`}>{flash[0]}</div>
      )}

      <Section icon={<Sparkles size={19} />} title="Your assistant" sub="How much it decides on its own, and how often it messages you.">
        <form action={setAutonomy} className="mb-5">
          <div className="mb-2 text-[13.5px] font-medium">How much can {name} decide on its own?</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {([
              ["ask", "Ask me first", "Checks with you before doing anything that changes things."],
              ["balanced", "Balanced", "Does small, safe things itself. Asks about anything bigger."],
              ["decide", "Decide for me", "Makes the calls and tells you after. Money still needs your OK."],
            ] as const).map(([v, l, d]) => (
              <button key={v} name="autonomy" value={v}
                className={`rounded-xl border p-3 text-left transition ${autonomy === v ? "border-[rgba(56,189,248,.6)] bg-[rgba(56,189,248,.12)]" : "border-line bg-panel hover:border-line2"}`}>
                <div className="flex items-center gap-1.5 text-[14px] font-medium">{autonomy === v && <CheckCircle2 size={15} className="text-accent" />}{l}</div>
                <div className="mt-1 text-[12.5px] text-muted">{d}</div>
              </button>
            ))}
          </div>
        </form>
        <form action={setMessageMode} className="mb-5">
          <div className="mb-2 text-[13.5px] font-medium">How often can {name} message you?</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {([
              ["needed", "Only when needed", "Stays quiet unless something needs you."],
              ["daily", "Once a day", "A short morning catch-up. Recommended."],
              ["more", "More often", "Morning catch-up plus check-ins during the day."],
            ] as const).map(([v, l, d]) => (
              <button key={v} name="mode" value={v}
                className={`rounded-xl border p-3 text-left transition ${mode === v ? "border-[rgba(56,189,248,.6)] bg-[rgba(56,189,248,.12)]" : "border-line bg-panel hover:border-line2"}`}>
                <div className="flex items-center gap-1.5 text-[14px] font-medium">{mode === v && <CheckCircle2 size={15} className="text-accent" />}{l}</div>
                <div className="mt-1 text-[12.5px] text-muted">{d}</div>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-faint">Approvals and answers you asked for always come through.</p>
        </form>
        <form action={saveAssistant} className="grid gap-4 sm:grid-cols-3">
          <label className="space-y-1.5"><span className="text-[13.5px] font-medium">Name</span><input name="assistant_name" defaultValue={name} maxLength={24} /></label>
          <label className="space-y-1.5"><span className="text-[13.5px] font-medium">Morning catch-up at</span><input name="brief_time" type="time" defaultValue={s.brief_time ?? "07:30"} /></label>
          <label className="space-y-1.5"><span className="text-[13.5px] font-medium">Quiet from</span><input name="quiet_start" type="time" defaultValue={s.quiet_start ?? "21:00"} /></label>
          <div className="sm:col-span-3"><button className="btn btn-primary w-full !py-2.5">Save</button></div>
        </form>
      </Section>

      <Section id="phone" icon={<Bell size={19} />} title="Alerts on your phone" sub={`Get approvals and messages from ${name} in Telegram, and reply to it from anywhere.`}
        status={<span className={`chip shrink-0 ${paired ? "chip-good" : botOn ? "chip-warn" : ""}`}>{paired ? "On" : botOn ? "1 step left" : "Off"}</span>}>
        {paired ? (
          <div className="space-y-3 text-[14px]">
            <p className="text-muted">You&apos;re set. Approvals arrive with Approve and Deny buttons. Message the bot to ask {name} anything, or start a message with <b className="text-text">+</b> to add a task.</p>
            <div className="flex flex-wrap gap-2">
              {s.telegram_bot_name && <a href={`https://t.me/${s.telegram_bot_name}`} target="_blank" className="btn"><Send size={14} /> Open @{s.telegram_bot_name}</a>}
              <form action={unpairPhone}><button className="btn btn-ghost">Unlink this phone</button></form>
            </div>
          </div>
        ) : botOn ? (
          <div className="space-y-3 text-[14px]">
            <p className="text-muted">Last step: open the bot on your phone and tap <b className="text-text">Start</b>. That links it to you and nobody else.</p>
            {s.telegram_bot_name ? (
              <a href={`https://t.me/${s.telegram_bot_name}?start=${pairCode}`} target="_blank" className="btn btn-primary !py-3"><Send size={15} /> Open @{s.telegram_bot_name} and tap Start</a>
            ) : (
              <p>Send <code className="rounded bg-panel3 px-1.5 py-0.5 text-text">/start {pairCode}</code> to your bot.</p>
            )}
            <p className="text-[12.5px] text-faint">Button didn&apos;t open Telegram? Send <code>/start {pairCode}</code> to the bot yourself.</p>
            {local && <form action={disconnectTelegram}><button className="btn btn-ghost btn-sm">Use a different bot</button></form>}
          </div>
        ) : local ? (
          <ol className="space-y-3 text-[14px]">
            <Step n={1}>Install <b>Telegram</b> on your phone if you don&apos;t have it.</Step>
            <Step n={2}>
              Open <a href="https://t.me/BotFather" target="_blank" className="text-accent underline-offset-2 hover:underline">BotFather <ExternalLink size={12} className="inline" /></a>, tap Start, send <code className="rounded bg-panel3 px-1.5 py-0.5">/newbot</code>, then call it MyManager (any name works). It replies with a long code called a token.
            </Step>
            <Step n={3}>
              <div className="mb-2">Copy that token and paste it here:</div>
              <form action={connectTelegram} className="flex flex-wrap gap-2">
                <input name="token" placeholder="123456789:AAH…" autoComplete="off" required className="!w-auto min-w-0 flex-[1_1_14rem]" />
                <button className="btn btn-primary">Connect</button>
              </form>
            </Step>
          </ol>
        ) : (
          <p className="text-[14px] text-muted">Set this up from MyManager on your PC.</p>
        )}
        <p className="mt-4 flex items-center gap-1.5 text-[12px] text-faint"><ShieldCheck size={12} /> Only your linked chat is obeyed. Payments and signups still need your tap.</p>
      </Section>

      <Section id="code" icon={<Code2 size={19} />} title="Your code (GitHub)" sub={`Lets ${name} look at your projects' code, recent changes and open issues when you ask how something is going. Read only.`}
        status={<span className={`chip shrink-0 ${gh !== "none" ? "chip-good" : ""}`}>{gh !== "none" ? "Connected" : "Off"}</span>}>
        {gh === "cli" ? (
          <p className="text-[14px] text-muted">Using the GitHub app you&apos;re already signed in to on this PC. Nothing else to do.</p>
        ) : gh === "token" ? (
          <div className="flex flex-wrap items-center gap-3 text-[14px] text-muted">
            <span>Connected. The key stays on this PC.</span>
            {local && <form action={disconnectGithub}><button className="btn btn-ghost btn-sm">Disconnect</button></form>}
          </div>
        ) : local ? (
          <ol className="space-y-3 text-[14px]">
            <Step n={1}>
              Open <a href="https://github.com/settings/personal-access-tokens/new?name=Manager&description=Read+only+access+for+Manager&contents=read&issues=read&pull_requests=read&actions=read" target="_blank" className="text-accent hover:underline">GitHub&apos;s new key page <ExternalLink size={12} className="inline" /></a> (sign in if asked).
            </Step>
            <Step n={2}>Under <b>Repository access</b> pick <b>All repositories</b>. Under <b>Permissions</b> make sure Contents, Issues, Pull requests and Actions say <b>Read-only</b>. Then press <b>Generate token</b>.</Step>
            <Step n={3}>
              <div className="mb-2">Copy it and paste it here:</div>
              <form action={connectGithub} className="flex flex-wrap gap-2">
                <input name="token" placeholder="github_pat_…" autoComplete="off" required className="!w-auto min-w-0 flex-[1_1_14rem]" />
                <button className="btn btn-primary">Connect</button>
              </form>
            </Step>
          </ol>
        ) : (
          <p className="text-[14px] text-muted">Set this up from MyManager on your PC.</p>
        )}
      </Section>

      <Section id="bank" icon={<Landmark size={19} />} title="Your bank (Up)" sub="Shows your balance and what you spent this week. Read only: nothing can move money."
        status={<span className={`chip shrink-0 ${upOn ? "chip-good" : ""}`}>{upOn ? "Connected" : "Off"}</span>}>
        {upOn ? (
          <div className="flex flex-wrap items-center gap-3 text-[14px] text-muted">
            <span>Connected. The token stays on this PC.</span>
            {local && <form action={disconnectUp}><button className="btn btn-ghost btn-sm">Disconnect</button></form>}
          </div>
        ) : local ? (
          <ol className="space-y-3 text-[14px]">
            <Step n={1}>Open the <b>Up</b> app on your phone.</Step>
            <Step n={2}>Go to <b>Profile → Data sharing → Personal Access Token</b> (or visit <a href="https://api.up.com.au/getting_started" target="_blank" className="text-accent hover:underline">api.up.com.au</a>) and create a token.</Step>
            <Step n={3}>
              <div className="mb-2">Paste it here:</div>
              <form action={connectUp} className="flex flex-wrap gap-2">
                <input name="token" placeholder="up:yeah:…" autoComplete="off" required className="!w-auto min-w-0 flex-[1_1_14rem]" />
                <button className="btn btn-primary">Connect</button>
              </form>
            </Step>
          </ol>
        ) : (
          <p className="text-[14px] text-muted">Set this up from MyManager on your PC.</p>
        )}
        <p className="mt-4 text-[12px] text-faint">Not with Up? Other banks don&apos;t offer a personal key like this yet, so this one is Up only for now.</p>
      </Section>

      <Section icon={<ShieldCheck size={19} />} title="Spending limits and trust" sub={`${name} can never spend more than these. Card numbers and passwords are never stored.`}>
        <div className="mb-5">
          <div className="mb-1.5 flex justify-between text-[13.5px]"><span className="text-muted">Spent this month</span><span><b>{money(spent)}</b> <span className="text-muted">of {money(s.monthly_cap_cents)}</span></span></div>
          <div className="h-2 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct > 85 ? "var(--bad)" : pct > 60 ? "var(--warn)" : "var(--good)" }} />
          </div>
        </div>
        <form action={saveSettings} className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5"><span className="text-[13.5px] font-medium">Most it can spend on one thing ($)</span><input name="per_purchase_cap" type="number" inputMode="numeric" step="1" min="0" defaultValue={s.per_purchase_cap_cents / 100} /></label>
          <label className="space-y-1.5"><span className="text-[13.5px] font-medium">Most it can spend in a month ($)</span><input name="monthly_cap" type="number" inputMode="numeric" step="1" min="0" defaultValue={s.monthly_cap_cents / 100} /></label>
          <label className="space-y-1.5 sm:col-span-2">
            <span className="text-[13.5px] font-medium">Stop asking about a safe, free action after I&apos;ve said yes</span>
            <select name="trust_after" defaultValue={String(s.trust_after ?? 3)}>
              <option value="0">Always ask me</option><option value="2">2 times in a row</option><option value="3">3 times in a row</option><option value="5">5 times in a row</option>
            </select>
            <span className="block text-[12px] text-faint">Payments, signups, emails sent as you and using your PC always ask, whatever this says.</span>
          </label>
          <input type="hidden" name="max_active_projects" value={s.max_active_projects} />
          <input type="hidden" name="focus_minutes" value={s.focus_minutes} />
          <div className="sm:col-span-2"><button className="btn btn-primary w-full !py-2.5">Save limits</button></div>
        </form>
      </Section>

      <Section icon={<Timer size={19} />} title="Focus" sub="How long a focus session runs, and how many projects you juggle at once.">
        <form action={saveSettings} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="per_purchase_cap" value={s.per_purchase_cap_cents / 100} />
          <input type="hidden" name="monthly_cap" value={s.monthly_cap_cents / 100} />
          <input type="hidden" name="trust_after" value={s.trust_after ?? 3} />
          <label className="space-y-1.5"><span className="text-[13.5px] font-medium">Focus session length</span>
            <select name="focus_minutes" defaultValue={String(s.focus_minutes)}>
              {[25, 30, 45, 50, 60, 90].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          </label>
          <label className="space-y-1.5"><span className="text-[13.5px] font-medium">Projects on the go at once</span>
            <select name="max_active_projects" defaultValue={String(s.max_active_projects)}>
              {[1, 2, 3, 4, 5, 6, 8, 10].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <div className="sm:col-span-2"><button className="btn w-full !py-2.5">Save</button></div>
        </form>
      </Section>

      <p className="flex items-center justify-center gap-1.5 pb-4 text-[12px] text-faint"><Bot size={12} /> {name} runs on this PC. Your keys stay in a private file here and never go online.</p>
    </div>
  );
}
