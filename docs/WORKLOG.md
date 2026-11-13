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
