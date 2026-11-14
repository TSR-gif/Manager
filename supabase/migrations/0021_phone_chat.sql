-- Chats from the online MyManager (phone) without a paid Claude key: the online site leaves the question here and
-- the PC's MyManager answers it with Claude Code, writing the answer back to the same row.
alter table agent_runs add column if not exists queued_goal text;
alter table agent_runs add column if not exists queued_at timestamptz;
create index if not exists agent_runs_queued_idx on agent_runs(queued_at) where queued_goal is not null;
