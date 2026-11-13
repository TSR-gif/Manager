-- Always-on helpers: a mission that owns an ongoing responsibility instead of a job with an end.
-- It wakes on a schedule and on events (wake_on), acts within the project's rules, and only comes back
-- to Thomas for a decision or a result worth knowing.
alter table missions add column if not exists ongoing boolean not null default false;
alter table missions add column if not exists wake_on jsonb not null default '[]'::jsonb;
