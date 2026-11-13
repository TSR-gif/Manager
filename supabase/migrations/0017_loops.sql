-- Loops: a mission can carry a "done check" (a command such as `npm test`). MyManager keeps coding
-- until it passes, then a second, read-only agent reviews the change. Thomas hears only when it's done or stuck.
alter table missions add column if not exists done_check text;
alter table missions add column if not exists max_rounds int not null default 6;
alter table missions add column if not exists rounds int not null default 0;
-- Each mission codes in its own git worktree, so two can run at once and Thomas's own checkout is never touched.
alter table missions add column if not exists worktree text;

-- Things MyManager learned while working on a project (loops add a line when they finish). Written into the project's notes skill.
alter table projects add column if not exists lessons text;
