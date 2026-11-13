# Manager

Thomas's command centre: decides what to work on next, tracks every project and everyday task, and (with approval) takes actions in his tools.

- **Today** – the one project to work on now, next 3 tasks, focus timer, everyday tasks, quick capture.
- **Projects** – status, priority, next action, live GitHub/Vercel signals, active-project cap.
- **Ideas** – inbox with forced triage (make project / park / kill).
- **Approvals** – approval queue, spend caps, audit log of everything Manager does.
- **Review** – weekly review of what moved and what stalled.

See `docs/WORKLOG.md` for the full build log, decisions and what's pending.

## Run locally
1. `cp .env.example .env.local` and fill it in.
2. Apply `supabase/migrations/*.sql` then `supabase/seed.sql` to the Supabase project.
3. `npm install && npm run dev`

No Supabase handy? Run a local Postgres, apply the SQL, then `DATABASE_URL=postgres://... node scripts/dev-rest.mjs` and point `SUPABASE_URL=http://localhost:3001`.
