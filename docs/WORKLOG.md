# Manager — work log

Running log of everything built, decided and waiting on Thomas. Newest entries at the bottom of each day.

## Waiting on Thomas
- [x] Supabase project "Manager" created by Thomas (ref `ilfdeyizixidblqqrhzu`, in a different Supabase org than the connector can see).
- [ ] **Run `setup.sql`** (now includes the agent table) in Supabase SQL Editor (tables + seed). Copy in project files `manager/setup.sql`.
- [ ] **Vercel env vars** on project `manager`: `SUPABASE_SERVICE_ROLE_KEY`, `APP_PASSWORD`. `ANTHROPIC_API_KEY` (turns the Agent on). Optional: `GITHUB_TOKEN` (fine-grained PAT, issues + PR read/write), `VERCEL_TOKEN` (live deploy status, redeploys).
- [ ] Supabase org shows "Grace period is over" banner: check Billing → Usage, risk of all projects in that org stopping.
- [ ] Optional: turn on his browser on the PC so research isn't limited.

## 2026-11-13

**05:04 UTC — kickoff.** Thomas wants a custom central manager that "controls what I'm doing".
- Inventoried: GitHub (TSR-gif) RewardsApp, DayTrader, TradingProgram, TSRailWebsite, PunterIQ, AmericaHolidayWebsite, long-reign. Vercel team `tscida`: rewardsapp, ts-rail-website, punteriq, long-reign, americaholidaywebsite. Supabase: "Points Rewards App".
- Proposed MVP: Today/Focus screen, projects board with live GitHub/Vercel signals, idea inbox with forced triage, weekly review.

**05:05–05:09 — requirements from Thomas**
- It should *do* things: sign up for services, pay for things → design: agent + **approval queue**, per-purchase and monthly **spend caps**, **audit log**, no card numbers/passwords stored (use a capped virtual card at checkout).
- Must be his central manager, also for **everyday tasks**.
- **Claude API is the brain** (agent chat, latest Opus model).
- **Controls his PC** when needed → small local helper using Claude computer use, user-started, every session approved.
- **Phone app** → installable PWA first.
- Project list (from his screenshot): Manager, Day trader, Altona Sports Centre, Web Scrapers, Rewards App, Clothing Brand, NDIS Scanner, TSRail Website, America Holiday, Idle Game, + PunterIQ.
- Repo TSR-gif/Manager created by Thomas.

**Decisions / assumptions**
- Stack: Next.js 15 (App Router, server actions) + Tailwind 4 + Supabase Postgres, hosted on Vercel team `tscida`.
- Single-user login: password in `APP_PASSWORD`, hashed session cookie. DB only reachable server-side with the service-role key; RLS on with no public policies.
- Project ↔ repo mapping (assumed, editable in app): Day trader → DayTrader; Rewards App → RewardsApp + Vercel rewardsapp; TSRail Website → TSRailWebsite + ts-rail-website; America Holiday → AmericaHolidayWebsite + americaholidaywebsite; **Idle Game → long-reign** (guess); PunterIQ → PunterIQ + punteriq; TradingProgram archived (likely part of Day trader). Altona Sports Centre, Web Scrapers, NDIS Scanner, Clothing Brand have no repo yet (an NDISScanner folder exists on his PC).
- Timezone assumed Australia/Melbourne.
- Phases: 1) focus/projects/everyday/ideas/approvals; 2) Claude agent + PWA; 3) PC helper, signups, payments.

**Built (phase 1, in progress)**
- Schema `supabase/migrations/0001_init.sql`: projects, tasks (project_id null = everyday), ideas, focus_sessions, actions (approval queue + audit log), settings (caps).
- Seed `supabase/seed.sql`: his 11 projects + archived TradingProgram.
- Focus engine `src/lib/focus.ts`: scores active projects by priority, deadline, staleness, failing deploy, overdue tasks; picks the one to work on + next 3 tasks.
- Live signals `src/lib/signals.ts`: GitHub last push / open PRs, Vercel latest prod deploy state (5-min cache).
- Action registry `src/lib/action-registry.ts`: github.create_issue (auto), vercel.redeploy, signup, purchase, email.send, pc.session (all need approval). Caps enforced when queued; over-cap is auto-blocked.
- Pages: Today, Projects, Project detail, Ideas, Approvals (queue + guardrails + audit log), Weekly review, Login.
- Local test DB: Postgres 16 + PostgREST in the dev container, since the Supabase project isn't created yet.

**Research (in progress)** — ideas to borrow:
- Sunsama: guided daily planning + end-of-day shutdown ritual, workload warning when the day is over-committed.
- Akiflow: universal inbox and a command bar (Ctrl/Cmd+K) for capture from anywhere.
- Motion: auto-scheduling tasks into the calendar.
- Linear: keyboard-first command palette, dense but calm UI.
- Things 3: "Today" vs "This Evening" split for personal tasks.

**05:16–05:30 — UI pass 1 + deploy setup**
- Redesigned all screens: dark theme with violet/cyan accents, Geist font, lucide icons, project avatars (colour from name), stat tiles, hero "Work on this now" card with circular focus timer, ranked "Up next" with score bars, Everyday split into Today/Later.
- Command bar: Ctrl/Cmd+K anywhere, + button on phone. `idea: …` → inbox, `#proj …` → project task, else everyday.
- Phone: bottom tab bar with approval badge, floating capture button, safe-area padding.
- Fixed: editing an already-active project no longer trips the active-project cap; cap default raised to 5 (he has 10 active — the app nudges him to pause some).
- Tested end to end locally: capture idea via Ctrl+K, queue $20 purchase → pending → approved (spend meter shows $20/$200), $80 purchase auto-blocked by $50 per-purchase cap.
- Created Vercel project `manager` (prj_RiqbNg45bas28cUSSi1YZZol4DYh) linked to TSR-gif/manager; pushes to main deploy. Set SUPABASE_URL, VERCEL_TEAM_ID, AUTH_SECRET.
- Supabase MCP `create_project` prompt never reached Thomas's phone (timed out/cancelled 3×) → he created it manually.

**05:30–05:45 — Phase 2: Agent screen (Claude as the brain)**
- Thomas: "like Claude Cowork but better, the AI is just one feature". So: an Agent tab where he hands over a goal; the rest of the app works without it.
- `src/lib/agent/run.ts`: manual tool loop on `claude-opus-5-5`, adaptive thinking (summaries shown as "Thinking"), effort medium, prompt-cached system prompt, server-side refusal fallback enabled (`fallbacks: "default"`), Anthropic web search (max 5/turn), 25-turn cap. Every step saved to `agent_runs` so runs can be reopened and followed up.
- Tools (`src/lib/agent/tools.ts`): get_overview, create_task, complete_task, update_project, add_idea, create_github_issue (runs now), request_approval (signup / purchase / email / redeploy / PC session → Approvals queue, spend caps enforced, never runs on its own).
- `/api/agent` streams NDJSON events; UI shows a live timeline (thinking, web searches, tool calls, approvals with a review link, final summary card). Recent runs listed on the right.
- Nav: Agent added (desktop + phone). Review stays on desktop sidebar and the Today card.
- Not yet tested against the real API (no key in the dev box); UI tested with a sample run.

**05:50 — Learned his projects from the repos** (read-only shallow clones)
- Rewards App = **Bargie** (bargie.app): weekly points + grocery savings; very active (540+ PRs).
- TSRail Website = **TS Rail Operations Portal** (tsrail.com.au), his business ops portal on Supabase.
- PunterIQ = betting analytics/tracking for AU punters; odds cache paused 28 Oct; AFL team-list data work next.
- Day trader = Python backtester + paper trader; findings (12 Nov): buy-and-hold beats every day-trading rule. Pretend money only.
- Idle Game = **The Long Reign** (repo long-reign), save point 3.
- America Holiday = USA trip planner, trip was 8–23 Oct 2026 → set to *paused*, next action "export and archive".
- TradingProgram = empty repo → archived.
- Seed now carries a goal, next action and notes for every project (`supabase/seed.sql`). Altona Sports Centre, Web Scrapers, NDIS Scanner have no repo: goals are placeholders to fill in.

**05:55–06:15 — Local mode + Claude Code as the brain + assistant front door**
- Thomas: "build it locally for now", "we can use this ai for testing", "should be able to do anything… maybe even make decisions", "like a personal assistant, a smart one".
- **One-click local run:** `Start-Manager.bat` (Windows) / `npm run local`. First run writes `.env.local` and creates a built-in database (PGlite in `.localdb/`, PostgREST-compatible shim in `scripts/dev-rest.mjs`) with migrations + seed applied. No Supabase/Vercel needed. Tested from a clean copy.
- **Brain = Claude Code app on his PC** (`AGENT_BACKEND=claude-code`, default when there's no API key). `src/lib/agent/claude-code.ts` runs `claude -p --output-format stream-json`, gives it Manager's tools through a local MCP bridge (`scripts/mcp-manager.mjs` → `/api/agent/tool`, authed by header), allows web search/fetch, blocks Bash/Edit/Write. Follow-ups resume the same Claude Code session. API backend kept as a swap-in.
- Tested for real in the dev box: "top 3 projects + add Book car service due tomorrow" → read overview, added the task, correct answer; follow-up remembered context.
- **Autonomy setting** (migration 0003, `settings.autonomy`): Ask first / Balanced / Decide for me, on the Assistant screen. Injected into the system prompt. Money, signups, messages as him, deletes, redeploys, PC sessions always go to Approvals regardless.
- **Assistant is the front door:** "Ask me anything" bar on Today, voice input (browser speech recognition, en-AU) there and in the chat box, Agent renamed Assistant, replies render markdown.
- Fixed: browser opener crash on machines without xdg-open; duplicate summary card.
- setup.sql regenerated with 0003 (project files copy).

**Research** — Thomas asked if external research is happening. Honest answer: only two searches early on. A dedicated research pass was done in a separate thread: `/mnt/project-files/manager/research/manager-ideas-apps-tools.md` (~30 apps, tools, 16 ranked ideas). Top picks: morning brief on the phone, one-tap phone approvals with a trust ladder, accessibility-tree PC control (agent-desktop / windows-computer-use-mcp) before screenshot clicking, Playwright MCP for web signups, payments stop at the pay step for Thomas to use a disposable card (US agent-card products don't work in AU).
- **Morning brief / Plan my day / Shutdown** one-tap buttons under the ask bar (research top pick #1, Sunsama-style ritual). Tested for real on phone size: brief read his data, added 5 concrete tasks, picked Manager as the focus with a reason, gave a 5-item plan.
- Next up from research: phone push for approvals + trust ladder, accessibility-tree PC helper, payments stop at the pay step.
- Research round 2 (same file, NEW section): 6 tools actually installed and run. Revised picks: Telegram bot for one-tap phone approvals (plus web push), **agent-desktop** (Vercel Labs) for PC control, Up Bank personal API for spending if he banks with Up; tool ideas for Day trader, Web Scrapers, NDIS Scanner, Clothing Brand. Suggestions only, Thomas hasn't picked yet.

**06:25–06:50 — Thomas: "We will do all this" (research picks approved)**
- Altona Sports Centre is a **client job** (paid work, not an app): new `projects.kind` (app / client / personal), Client job chip, goal "deliver on time and get paid". Agent sees the kind.
- **Trust ladder** (`src/lib/trust.ts`, migration 0004 `settings.trust_after`, default 3): a free, trustable action type approved N times in a row runs on its own next time; one rejection resets it. Hard rule in code (`ALWAYS_ASK`): signups, payments, emails as him, PC sessions always ask. Shown on Approvals with progress bars.
- **Telegram bot** (`scripts/telegram.mjs`, no extra deps, long polling so no public URL): approvals arrive with ✅ Approve / ✋ Deny buttons (message edits to show the result), text it to ask the assistant (keeps the conversation, /new resets), `+ text` quick-adds, /pending. Pairing with `/start <code>` from the Approvals screen; only the paired chat is obeyed, a second chat can't take over. Started by `npm run local` when `TELEGRAM_BOT_TOKEN` is set. Tested against a mock Telegram server: wrong code refused, pairing, other chat ignored, capture, real assistant run queued a $20 Canva approval, notification sent with buttons, Approve tapped → action approved and message updated.
- Windows fixes: launcher no longer goes through the shell for node (paths with spaces), Claude Code args quoted.
- Backlog from coordinator (Thomas: "these ideas could be useful"): client-jobs view (hours, invoices, owed), subscriptions tracker, Manager MCP for the Claude app, Gmail triage, calendar blocks, "what Manager knows about me", project health lights, streaks/task roulette.

**06:50–07:15 — PC control, money, per-project starters**
- **PC control** (claude-code backend): only while there's an approved "Use your PC" request from the last 2 hours. Then the assistant gets **agent-desktop** (Vercel Labs, Apache-2.0: drives any desktop app through the accessibility tree, headless) and **Playwright MCP** (websites) via `npx`, with Playwright's run-code/evaluate tools blocked. The prompt forbids typing passwords, card numbers or 2FA codes: it stops at those screens and hands over. Not run in the dev box (the sandbox blocked downloading the native binary), so the first real test is on Thomas's PC.
- **Up Bank tile** (`src/lib/up.ts`, read-only): balance across accounts, spent 7/30 days (money out only, internal transfers ignored), top categories. Shows on Today only when `UP_TOKEN` is set; the assistant sees it in get_overview. Tested against a mock Up API: $6,235 balance, $57 / $197 spent, transfer and salary excluded.
- **Per-project starter tasks** from the research (migration 0005, idempotent): Day trader (check Alpaca AU, NautilusTrader, Alpha Vantage tile), Web Scrapers (Crawlee vs Crawl4AI, changedetection.io), NDIS Scanner (2026-27 Support Catalogue, PDF→Claude prototype, PRODA CSV spec), Clothing Brand (AU print-on-demand, sample tee), Altona (scope/price, log hours, invoicing).
- Fixed: tasks due today were counted as overdue (UTC vs Melbourne date).
- Web push deferred until the app is online over HTTPS (phone can't reach localhost); Telegram covers phone approvals now.

**07:15–07:45 — "Like Claude Duet / OpenAI dots, but do more"**
- Looked both up. Claude Duet (Anthropic, Oct 2026): proactive app that messages you first (morning brief, checks apps every few hours, pings only when needed), background jobs with a ping when done, one continuous thread, asks before send/pay/sign/delete. OpenAI dots (Sep 2026): always-on agents shown as animated dots; you name your primary dot; plan for teams of specialist dots.
- **Proactive** (`src/lib/proactive.ts`, `/api/proactive`, migration 0006): the launcher ticks every 5 min. Morning brief at `brief_time` (07:30, skipped if Manager wasn't on before noon), check-ins every `checkin_hours` (3) until `quiet_start` (21:30). Check-ins answer exactly NOTHING when nothing needs him, so they stay silent. Anything worth saying goes to Telegram and a "From <name>" card on Today (unread until opened). Settings on the Assistant screen.
- **Background jobs**: runs keep going if the browser closes; when he left before it finished, it's marked unread and he gets a "✅ Done" Telegram message.
- **Name + orb**: the assistant has a name (default Manager, editable) and a live orb (breathes idle, spins while working) on Today, the Assistant screen and the chat.
- **Specialists**: "+ Add a specialist" on any project page; watched projects are checked in every check-in.
- Tested: automatic brief fired on its own ~1 min after start and was delivered to (mock) Telegram; forced check-in correctly stayed quiet right after the brief; job abandoned after 4 s finished in the background (idea added) and sent the Done message.
- Fixed: Telegram rejects link buttons to localhost, so links only appear when APP_URL is a public https address.

**09:55–10:20 — Money, About you, screenshots**
- **Money page** (`/money`, migration 0007): client jobs (log hours, hourly rate and client name, create an invoice from unbilled hours or a fixed amount, mark sent → due in 14 days → paid, void returns hours), totals for owed / overdue / not invoiced; **subscriptions tracker** (monthly/yearly/weekly, per-project monthly cost, renewing-this-week warning, mark cancelled). Up balance tile when connected.
- **About you page** (`/me`, `memories` table): every fact the assistant knows, grouped, add/delete. All facts go into the assistant's prompt. Seeded with 7 facts learned so far.
- New assistant tools: `remember` (refuses anything that looks like a password or card number), `log_time`, `track_subscription`.
- Nav: Money added (phone bar: Today, Assistant, Projects, Money, Approvals; Ideas and About you on desktop sidebar).
- Fixed: project page overflowed sideways on phones (add-task row); dev badge hidden.
- Screenshots of every screen, desktop + phone, in project files `manager/screenshots/` (sample hours/subscriptions in the dev copy only).

**10:20–10:50 — Project health lights, per-project dashboard, phone polish**
- **Health lights** (`src/lib/health.ts`): every active project gets green "On track", amber "Needs a nudge" or red "At risk", with the reasons on hover. Red: deploy failing, past deadline, overdue tasks, untouched 14+ days. Amber: untouched 7+ days, no next action, no open tasks, deadline within 3 days with more than 2 tasks open. Shown on the Projects list.
- **Per-project dashboard** at the top of each project page: the health light and why, open tasks, done in the last 14 days, focus time (14 days), hours logged (client jobs), monthly costs from subscriptions, and a 14-day bar chart of finished tasks.
- Phone polish: Assistant header shorter on phones, chat empty state tighter; client chip and add-task row no longer overflow.
- Screenshots regenerated.
