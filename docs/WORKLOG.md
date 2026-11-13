# Manager — work log

Running log of everything built, decided and waiting on Thomas. Newest entries at the bottom of each day.

## Waiting on Thomas
- [ ] **Supabase project "Manager"** (free, Sydney): Supabase's confirm prompt timed out twice (05:12, 05:14 UTC). Needs his tap.
- [ ] **Secrets for Vercel** once deployed: `APP_PASSWORD` (login), `GITHUB_TOKEN` (fine-grained PAT, repo read + issues write), `VERCEL_TOKEN`, later `ANTHROPIC_API_KEY`.
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
