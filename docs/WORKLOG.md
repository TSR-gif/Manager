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

**10:20–10:55 — "Make it more user friendly", "talk to it like a human", name: MyManager**
- **Renamed to MyManager** (app, assistant, Telegram, login, phone home-screen name). Migration 0009 renames the assistant.
- **Today** is simpler: a welcome card on first open (3 things to know, dismissible), the four number tiles replaced by "needs you" rows that only appear when something does (things to approve, ideas to sort, weekly review due), plain words throughout ("Catch me up", "Wrap up my day", "Next step", "Focus for 50 min").
- **Settings page** (new): everything optional in one place, in plain language. Pick how much it decides with three described cards, morning catch-up and check-ins with simple dropdowns, spending limits worded as "most it can spend on one thing". **Guided setup** for phone alerts (Telegram), bank (Up) and code (GitHub): numbered steps and a box to paste the key, checked live, saved to `.env.local` on the PC (`src/lib/local-env.ts`). No file editing or restarts: the launcher now starts the Telegram bot by itself when a token appears, and pairing is one "Open @bot and tap Start" button.
- **Phone nav**: Today, Assistant, Projects, Money, More (Approvals, Ideas, Weekly review, About you, Settings, with a badge when something's waiting). Bigger tap targets, smaller quick-add button, Money tiles no longer cut off, "Connect your bank" tile links to setup.
- **Approvals** trimmed to what's waiting, approved items to tick off, and history; limits moved to Settings.
- **"Go see how my Day trader is going"**: new `inspect_project` tool (`src/lib/inspect.ts`) reads the project's tasks, and on GitHub its recent commits, open issues and PRs, automated check results, TODO/FIXME notes in the code, whether it has tests and the README, plus the live site status. Works with a GitHub key from Settings, or with the GitHub app if it's already signed in on the PC. The assistant answers how it's going plus a numbered list of what needs doing, then offers to add them as tasks. Tested with that exact sentence against the real DayTrader repo: it found the buy-and-hold result, the backup-file clutter and the out-of-date README, then "yes add them, but skip 6" added five tasks. Same question by Telegram (PunterIQ) got the full answer back in Telegram.
- **Voice**: ask by mic and the answer is read aloud (browser voice, Australian English when available); every answer has a Read aloud button.
- The assistant now writes for a person, not a developer: dates in words, no file names or jargon.
- Before/after screenshots: `manager/screenshots-before/` and `manager/screenshots/`.

**10:45–11:30 — Designed around how people really use apps** (research: `manager/research/mymanager-user-behaviour.md`)
- **Phone Today answers "what now?" in 15 seconds**: waiting approvals pinned at the top with Approve / Not now right there; then one **Do this now** card picked by MyManager (with "Picked because…"), big Done and Start buttons, and the next 3 under "Then". The welcome is one dismissible line. Ask bar comes after.
- **Phone tabs = phone jobs**: Today · Ask · Add · Approvals (badge) · More (Projects, Money, Ideas, Weekly review, About you, Settings). The floating + is gone, so nothing covers buttons; the bottom bar is solid.
- **Answers first**: assistant replies open with the answer and the one next step; details sit behind "Show details"; the working steps fold into one line; replies that end in a question get "Yes, go ahead" / "Not now" buttons; nothing hides behind the input box.
- **No guilt**: missed dates read "From Tue", not a red "5d overdue". Morning catch-up leads with the one thing to do and asks "OK with this plan?"; Wrap up my day asks when each unfinished thing will happen (tomorrow / a day / drop) and changes nothing until he answers. A tip a day in the morning catch-up for the first 10 days.
- **"How often can MyManager message you?"**: Only when needed / Once a day (default) / More often. Quiet from 9 pm by default. Approvals and requested answers always come through.
- **What MyManager did today** on Today, each line with **Undo** (added tasks, ticked tasks, project changes, saved ideas, memories, logged hours, subscriptions, pauses). Tested: Undo removed a saved memory.
- **Plain words**: priorities are Top priority / High / Normal / Low / Someday (no P1–P5); "Keep an eye on this" instead of "specialist"; Australian dates (`en-AU`).
- **Project page**: tasks first; stats only when there's something to show. **Projects**: "Pause these 4 for now?" with one Yes button instead of a warning.
- **Money**: "Make invoice for Altona ($440)" next to the number (makes a draft, nothing is sent).
- **Telegram approvals** read as self-contained cards and update to "Approved by you at 9:14 pm".
- **Private usage log** (`usage_events`): which screens, phone or computer, how long. Shown in the weekly review and given to the assistant so it can suggest changes (always asks first).
- Launcher restarts the Telegram bot by itself if it drops.
- Phone overflow check passes on every main screen. Before/after screenshots in project files.

**11:30–12:15 — Socials and ads for your apps (Marketing)**
- New **Marketing** screen per project (Bargie first): what's coming up by day, reply drafts, ads, and the jobs that run every week.
- **Posts**: ask in plain words ("make 3 Bargie posts") and MyManager drafts picture slideshows, captions and hashtags from real numbers only. Each one waits in Approvals with a phone-style preview. You approve, post it yourself, then tap "I posted it". Tested with real prices: 2 posts and a comment reply, totals checked.
- **Ads**: campaign drafts (where, who sees it, what it says, $ a day × days). Launching an ad or changing its budget always asks you and counts against your spending limits. Approving doesn't launch it: you launch it in the ads dashboard, then tap "I've launched it". Spend and downloads are logged there or by telling MyManager, with cost per download. Tested: $5/day × 7 = a $35 launch waiting for your OK.
- **Weekly jobs**: standing instructions on a schedule ("every Wednesday at 2 pm"), with templates. The two Bargie jobs are set up and **off** until you switch them on. They only ever make drafts.
- MyManager never posts, launches ads or creates accounts.

**12:15–12:40 — Supervise: "Day trader is doing X, Y and Z, make sure it gets finished"**
- Tell MyManager what a project is doing. It turns that into steps, checks on it on a schedule (every 15 min to once a day), and ticks off only what it can see is done.
- When it needs you, it asks one short question on Today, on the Supervise screen and on Telegram. Reply to the Telegram message, or type in the app, and it carries on straight away.
- **Coding steps (optional)**: give it the project's folder on your PC and approve "Work on your code" once for that mission. It then codes one step at a time with Claude Code, on its own branch, commits, and never pushes, deploys or touches real money.
- Tested on a copy of Day trader: "tidy the .bak files and update the README". It made 5 steps and removed 73 unused backup files. It rewrote the README to say it trades with Alpaca pretend money only, then marked the mission finished. Two commits on `mymanager/…`, nothing pushed.
- **"How's everything going?"** gives one line per project: what's running, what finished this week, what needs you. It's also in the morning catch-up when something is being supervised.

**12:40 — Installed on Thomas's PC** (Documents\MyManager). Node, Git and gh were already there, and the Claude CLI was installed with npm. MyManager calls `claude.cmd` so Windows' PowerShell block doesn't matter. Runs on the PC only for now: no Supabase or Vercel.

**12:45 — New look**: three directions for Today (dark command centre, clean and bright, bold and colourful) in project files `manager/ui-directions/`, waiting for Thomas to pick.

**13 Nov evening — Command centre look, coding help, project briefs**
- The dark Command centre look now covers every screen (he picked it from three options).
- **Project briefs**: MyManager reads each project's code (the folder on his PC first, then GitHub) and writes what it is, how it's built, how to run it, where it's at, known problems and what's next. It refreshes the brief when the code moves on and reads it before acting. The brief is on each project page, where he can correct it. **Your rules for this project** sit beside it and are never overwritten; Day trader starts with "pretend money only". Projects with no code are listed so he can describe them.

**13 Nov night — Fixes from Thomas's screenshots**
- "Couldn't find project": project names now match loosely, and if nothing matches it gets the real list. Errors show a red cross, not a green tick.
- Stuck on "working…": a run stops after 5 quiet minutes or 20 minutes in total, and old runs that were cut off by a restart are marked as not finished.
- It really checks projects: **check_project_activity** shows programs running from the folder, Windows scheduled tasks, files changed in the last 2 days, the end of the newest logs and the latest data rows.
- No more "connect GitHub / the live-site link in Settings", and no setup tasks: it uses the folders, git and gh sign-in on his PC. The setup task it had created was ticked off.
- Side questions (e.g. "switch to index investing") become one optional last line, never a blocker.
- Empty project list after an update: database changes now apply by themselves within 15 s of a `git pull`, no restart needed.
- "Yes, go ahead" only appears for real yes/no offers.

**13 Nov night — Full read access to his PC, nothing destructive without his OK**
- Thomas: "should have full access to my pc" + "make sure it doesn't do anything destructive without permission".
- The assistant can read any folder in his user folder and run read-only commands (git status/log/diff, gh list/view, vercel whoami, tasklist…). It never asks to look.
- **Safety guard** (`scripts/guard.mjs`), a hook on every Claude Code session MyManager starts. The app blocks the following, whatever the model decides:
  - deleting or moving files;
  - overwriting files git can't restore;
  - git reset/clean/restore, force and normal pushes, deleting branches;
  - uninstalling or installing software;
  - closing programs; shutdown;
  - registry, power, network and firewall settings;
  - wiping databases; deleting things on GitHub, Vercel or Supabase;
  - reading .env, key and password files.
  
  The chat assistant can't change files at all. The coder can only change files inside its project folder that git can bring back.
- **find_services**: which project folders use Vercel, Supabase and so on, and whether the Vercel, Supabase and GitHub tools on the PC are signed in.

**13 Nov night — Runbooks: step lists MyManager carries out on his PC**
- Tell it a list ("start the Saturday job, close the queue, commit and push, delete the old venv, sign in to QuantConnect if asked"). It plans it as one list in Approvals. Nothing runs until he approves it.
- Step types:
  - **Start a job.** Runs in the background, keeps the PC awake until the job ends (no settings changed), watches the output, and messages him when it finishes, stalls 45 min, or runs 1.5× longer than usual.
  - **Close a program.**
  - **Commit and push.** Skips key files and venv folders, and stops if it sees secrets or files over 50 MB.
  - **Delete a folder.** Asks again at that step.
  - **Open a page.**
  - **Hand over to you.** For sign-ins: it opens the page or a `vercel login` window and he types the password. "Only if needed" hand-overs don't hold things up.
  - **Run a setup command.** Only git, gh, npm, npx, node, py, pip, vercel, supabase, claude or winget. Anything that isn't read-only asks again.
- Shown under **On your PC** on the Supervise screen: live job output, Done / Not needed / Fixed it, try again, and Stop.
- Tested on a copy of Day trader with his exact Saturday list:
  - job started and finished;
  - queue closed;
  - commit stopped on a test key file, then went through after it was added to .gitignore (venv skipped);
  - delete waited for approval, then removed the folder;
  - sign-in hand-over skipped as not needed.

## 2026-11-14 · Simpler screens, watch jobs you started
- Thomas: "hard to navigate less is more", "shows lots of infomation on things when it should be hidden as its the managers job to know this". Every screen now shows only what needs him, his to-dos and a one-line status. Briefs, rules, logs, folders and history sit behind "Details" or "More".
- Menu is Today, Projects, Ask (+ More). Approvals and Running are reached from Today. The sidebar lists projects as "dots" with a light: amber needs you, green working.
- Look: near-black shell with one inset panel, Inter font (bundled in src/app/fonts so it works offline). A full redesign is being done in its own thread; this is an interim.
- New `watch_job` tool and `watch_process` runbook step: MyManager watches a job Thomas started himself (match a process, tail its log, ping when it finishes or goes quiet) without starting it again. Read-only, so no approval.

## 2026-11-14 · Security fixes from the audit (built as if MyManager were online)
Thomas plans to host MyManager online soon, so each fix assumes the app can be reached from the internet. Every finding was checked in the code first; all ten were real.
- **Only this PC can open it.** The app now listens on 127.0.0.1 only (the database already did). New installs get a random password instead of "manager", and the launcher warns while the default password is still set. Thomas changes his own password; MyManager doesn't.
- **Login.** Five wrong passwords in 15 minutes locks login for 15 minutes. Password and key checks take the same time whatever is typed. After login it only goes back to a page on this site (no more `next=//other-site`).
- **Every server action checks the login itself**, not just the front door, so posting an action straight at /login is refused. (Tested: a replayed approve with no cookie was refused.)
- **One approval runs once.** Approving claims the action in a single update; a double tap, or phone and web at once, runs it once. (Tested: 5 approvals at once, then a "no", left it approved once.)
- **Spend caps are checked again right before a paid action runs**, and waiting requests count toward the monthly cap when new ones are asked. (Tested: an over-cap purchase was refused at approve time.)
- **Setup commands.** Anything with `& | ; < > ^` backticks, `$(` or a new line is refused outright. "Read-only" is now an exact list per program (git status/log/diff, gh auth status, vercel whoami…); `npx` only counts for vercel and supabase. The guard also blocks `git diff --output` and `type .env.local`.
- **Login cookie and helper key are now different values**, so a key copied from a helper's config file can't be used to log in. Telegram pairing uses a random one-time code (30 minutes) instead of part of the key. Settings explains that changing the password signs everything out.
- **Each assistant run has its own config and prompt files**, deleted when the run ends.
- **Tests:** `npm test` runs tests/security.test.mjs (command checks, the guard hook, key formula, localhost binding).
- After updating, Thomas has to log in again once (the cookie changed) and re-pair the phone bot if it's set up.

## 2026-11-14 · Loops, a notes file per project, always-on helpers
- **Loops** ("keep going until the tests pass"). A supervised job can now have a check, like `npm test`, `npx tsc --noEmit` or `py -m pytest`. MyManager runs it. If it fails, the coder gets the failure output and fixes it. Once it passes, a second read-only reviewer looks at the change (it can't edit, and the guard blocks changes). That repeats until the check passes and the review approves, then he's told the branch is ready (pushing still asks him). It stops and asks him after 6 goes (or whatever max is set). Only test, type-check, lint and build commands are allowed as checks; scripts named deploy, release, publish, clean, reset, migrate, start and similar are refused. If he answers "stop", the loop ends. Any other answer starts a fresh set of goes with his answer passed to the coder.
- **Separate working copy per job.** Coding now happens in its own git worktree (`~/.mymanager/worktrees/<id>`, branch `mymanager/<id>`), so his own folder isn't touched and two jobs can work on one project at once.
- **Notes file per project.** `.claude/skills/<project>-notes/SKILL.md` in the project folder holds the goal, his rules, the brief and lessons learned. It's rewritten when the brief or rules change, and a lesson is added each time a loop finishes. Any Claude Code session he opens in that folder picks it up, and the coder gets the same notes in its instructions. A notes file he wrote himself is never overwritten.
- **Always-on helpers** (what he meant by OpenAI "dots": the software, not dots on screen). `start_helper` gives a helper an ongoing responsibility instead of a job with an end. It wakes on its schedule and when events happen: something approved or turned down, a runbook or job on his PC finishing, or a mission finishing. It checks things itself, acts within his rules (anything risky still goes through Approvals), and only contacts him for a decision (`ask_thomas`) or a result worth knowing (`tell_thomas`). Helpers never "finish"; he stops them (`stop_mission`). They run while MyManager is running on his PC. How they look is left to the redesign.
- Tested on a copy with a stand-in coder:
  - **Loop:** the check failed, the fix was made in a separate copy on its own branch, the check passed, the review approved and the mission finished. His main folder was unchanged. A `npm run deploy` check was refused.
  - **Helper:** it woke on an approval, a "done" didn't stop it, `tell_thomas` sent, and stop worked.

## 2026-11-14 · New look built into the app (the design Thomas approved)
Thomas approved the v3 assistant design ("looks better", "push it"). It's now the real app. Nothing was removed; every feature has a place.
- **Look.** Light and white, Geist font, a coloured emoji tile per helper. No status dots or lights.
- **Sidebar (desktop):** Today, Calendar, Search; then Helpers (one per active project, with a count when it needs him); then Everything else (Money, Marketing, Ideas, Servers). His name at the bottom opens the menu: Weekly review, About you, Settings, Everything I'm working on, Approvals and history, Log out.
- **Phone:** tabs at the bottom for Today, Helpers and Calendar; the ask box sits just above them.
- **Today:** greeting, chips (need you, working, done for you, next on the calendar), then Needs you as one-line rows. Each row has the question, the amount and the buttons (Pay, Sign up, Send, Push, Run it… and Not now), or an answer box when it's a question. Below that is Working on with progress bars (focus blocks included), Done for you (folded, with Undo), and the ask box with quick buttons (Plan my day, Do the groceries, Check my projects, Pay a bill, Remind me…) and a mic.
- **Helper page** (was the project page) has four tabs. Chat shows what it said and what it's waiting on. Activity holds jobs, to-dos, setup runs, weekly jobs, code and history. Schedule holds check-ins, always-on helpers, weekly jobs and the watch toggle. Rules holds his rules, what it does by itself and what it asks about, the brief, the folder and editing.
- **New pages:** Helpers list, Calendar (reminders with a date, weekly jobs, focus blocks, two weeks ahead; no notes on people), Servers (each linked site and whether its last deploy is OK).
- The Projects page now goes to Helpers. Search (Ctrl+K) knows every new page.
- Checked: type check, lint and `npm test` pass; screens compared with the design on desktop and phone. Screenshots are in project files under manager/screenshots/redesign/built/.
