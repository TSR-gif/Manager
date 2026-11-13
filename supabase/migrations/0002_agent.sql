-- Agent runs: one row per goal handed to the Claude agent.
create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  goal text not null,
  status text not null default 'running' check (status in ('running','done','failed','stopped')),
  messages jsonb not null default '[]'::jsonb,  -- full Claude conversation (for follow-ups)
  events jsonb not null default '[]'::jsonb,    -- what the UI shows: steps, tool calls, results
  summary text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists agent_runs_created_idx on agent_runs(created_at desc);
alter table agent_runs enable row level security;
