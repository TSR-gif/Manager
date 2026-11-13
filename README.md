# Manager

Thomas's command centre: decides what to work on next, tracks every project and everyday task, and (with approval) takes actions in his tools.

- **Today** – the one project to work on now, next 3 tasks, focus timer, everyday tasks, quick capture.
- **Projects** – status, priority, next action, live GitHub/Vercel signals, active-project cap.
- **Ideas** – inbox with forced triage (make project / park / kill).
- **Approvals** – approval queue, spend caps, audit log of everything Manager does.
- **Review** – weekly review of what moved and what stalled.

See `docs/WORKLOG.md` for the full build log, decisions and what's pending.

## Run it on your PC (easiest)
- **Windows:** double-click `Start-Manager.bat`. **Mac/Linux:** `npm install && npm run local`.
- First run creates `.env.local` (login password `manager`, change it there) and a built-in database in `.localdb/` with your projects already loaded. Nothing else to set up.
- The assistant uses the **Claude Code app already signed in on this PC** (`AGENT_BACKEND=claude-code`). To use the Claude API instead, set `AGENT_BACKEND=api` and `ANTHROPIC_API_KEY=` in `.env.local`.
- The assistant gets Manager's own tools over a local MCP bridge (`scripts/mcp-manager.mjs`) plus web search. It can't run shell commands or edit files.

## Run against Supabase
1. `cp .env.example .env.local` and fill it in.
2. Apply `supabase/migrations/*.sql` then `supabase/seed.sql` to the Supabase project.
3. `npm install && npm run dev`

No Supabase handy? Run a local Postgres, apply the SQL, then `DATABASE_URL=postgres://... node scripts/dev-rest.mjs` and point `SUPABASE_URL=http://localhost:3001`.
