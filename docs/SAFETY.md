# What MyManager enforces, and what it doesn't (yet)

Thomas's rule: nothing destructive without his permission, enforced by the app; approvals and spend caps on payments; no stored card numbers or passwords. This page says plainly where that holds today.

## Enforced by the app
- **Approvals.** Every action that pays, signs up, emails, posts, uses the PC, codes, pushes or runs PC steps waits in Approvals. A decision is claimed once in the database (`mm_claim_action`), so a double tap or phone + web at once runs it once.
- **Spend caps.** Paid requests are checked and reserved inside the database under one lock (`mm_queue_paid_action`), and checked again when approved. Requests arriving at the same moment can't add up past the cap. Money counts in the month it was approved, in Melbourne time; anything still waiting counts too. Saying no releases it.
- **Who can approve.** Only the browser login and the phone bot's helper key reach `/api/bot` and the approval actions. Claude sessions MyManager starts get a pass for their own run that only works on `/api/agent/tool`, which has no approve tool. Coders and reviewers get no pass at all.
- **Keys stay out of workers.** Claude sessions, loop checks (`npm test` etc.) and runbook jobs start with MyManager's own settings removed from their environment (password, database key, GitHub/Vercel/Up/Telegram/Anthropic keys, anything named like a key or token). See `src/lib/worker-env.ts`.
- **The database answers only MyManager.** The built-in database checks a key that only the app has; the old shared placeholder "local" no longer works. In Supabase every table has row-level security with no public policies.
- **Commands.** Runbook commands can't chain, pipe, redirect or use variables. "Read-only" (runs without a second OK) is decided on every word: `git branch` lists, `git branch -D x` asks. A hand-over step can only open a sign-in (gh auth login, vercel login, supabase login, npm login).
- **Runbook order.** Steps run in order. A step that failed holds the ones after it until Thomas says try again, skip or stop; a running job holds the next step unless marked independent. Stop is checked right before every step that changes something, and a Stop can't be undone by a step that was already going.
- **Coding.** A coder only ever works in its own git worktree (`~/.mymanager/worktrees/<id>`); if one can't be made, nothing runs and Thomas is asked. Stop ends a running coder and everything it started. A loop only finishes when its check passes on new commits and the reviewer approves that exact commit; a push approval is for one exact commit and is refused if the branch moved.
- **Honest endings.** A job MyManager started records its exit code (`scripts/job-runner.mjs`), so after a restart it still knows whether it finished. A job that vanished without one is reported as interrupted, and a watched program that's no longer running is reported as "can't confirm", never as done. A mission can only be marked done when all its steps are done and no coder is working.

## A check, not a sandbox
`scripts/guard.mjs` runs before every tool call in every Claude session MyManager starts. It blocks deleting, overwriting what git can't restore, history rewrites, pushes, uninstalls, killing programs, settings changes, inline code (`node -e`, `python -c`), reading environment variables, calling MyManager's own app or database, and writing outside the work folder (links and junctions are followed). It reads the command text, so a program the coder writes and then runs (for example a test script) is not contained by it. On Windows, Claude Code's own sandbox needs WSL2. Real containment needs one of: WSL2 with the sandbox turned on, a separate Windows user account for the coder, or running coders in the cloud. That's Thomas's call (it installs software or changes accounts).

## What leaves the PC
- **To Anthropic (through the Claude Code app or the API):** the assistant's prompt, which includes project names, briefs, rules, open tasks, recent activity, files it reads from project folders and command output it runs. Never .env or key files.
- **To Telegram (if paired):** approval titles, reasons and costs, mission questions, job finished/stalled messages, and the assistant's replies to what he types there.
- **To GitHub/Vercel/Up:** only the calls each feature makes with his tokens (status, issues, redeploys, bank totals).

## Backups and restore (built-in database)
A compressed copy is saved once a day to `.localdb-backups/<date>.tar.gz` (newest 14 kept). To restore: close MyManager, rename `.localdb` to `.localdb-old` (nothing is deleted), then run `node scripts/dev-rest.mjs --restore .localdb-backups/<date>.tar.gz`. When it says the database is ready, close it and start MyManager as usual. It refuses to restore over an existing `.localdb`.
