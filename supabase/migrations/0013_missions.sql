-- Supervise: Thomas tells MyManager what a project is doing ("Day trader is doing X, Y and Z, make sure it gets finished").
-- MyManager turns that into a mission with steps (tasks), checks on it regularly, asks him when it needs his input,
-- and (only if he approves it for that mission) does the coding steps itself in the project's folder on his PC.
create table if not exists missions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  goal text not null,
  status text not null default 'running' check (status in ('running','waiting','done','stopped')),
  question text,                       -- what it needs from Thomas while status = waiting
  last_update text,                    -- one plain line: where it's at
  check_every_minutes int not null default 60,
  next_check_at timestamptz default now(),
  last_check_at timestamptz,
  checks int not null default 0,
  work_dir text,                       -- the project's folder on this PC, for coding steps
  can_code boolean not null default false,  -- set only when Thomas approves "work on the code" for this mission
  worker text not null default 'idle', -- idle | working
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table missions enable row level security;

create table if not exists mission_log (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid references missions(id) on delete cascade,
  kind text not null default 'note',   -- check | question | answer | work | done | note
  text text not null,
  created_at timestamptz not null default now()
);
alter table mission_log enable row level security;
create index if not exists mission_log_idx on mission_log(mission_id, created_at);

alter table tasks add column if not exists mission_id uuid references missions(id) on delete set null;
alter table projects add column if not exists local_path text;
