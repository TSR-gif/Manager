-- Manager: core schema
create extension if not exists pgcrypto;

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active','paused','idea','done','archived')),
  priority int not null default 3 check (priority between 1 and 5), -- 1 = highest
  next_action text,
  goal text,
  notes text,
  github_repo text,      -- "owner/name"
  vercel_project text,   -- vercel project name
  deadline date,
  last_touched_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  title text not null,
  status text not null default 'todo' check (status in ('todo','doing','done')),
  priority int not null default 3 check (priority between 1 and 5),
  due date,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists tasks_project_idx on tasks(project_id, status);

create table if not exists ideas (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  status text not null default 'inbox' check (status in ('inbox','promoted','parked','killed')),
  project_id uuid references projects(id) on delete set null,
  created_at timestamptz not null default now(),
  triaged_at timestamptz
);

create table if not exists focus_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  task_id uuid references tasks(id) on delete set null,
  planned_minutes int not null default 50,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  outcome text
);

-- Approval queue + audit log. Every action the app or agent wants to take goes here.
create table if not exists actions (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                       -- e.g. github.create_issue, vercel.redeploy, purchase
  title text not null,                      -- human summary
  reason text,                              -- why the agent wants to do it
  payload jsonb not null default '{}'::jsonb,
  risk text not null default 'approval' check (risk in ('auto','approval','blocked')),
  cost_cents int not null default 0,
  status text not null default 'pending' check (status in ('pending','approved','rejected','executed','failed')),
  project_id uuid references projects(id) on delete set null,
  requested_by text not null default 'user',
  result jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  executed_at timestamptz
);
create index if not exists actions_status_idx on actions(status, created_at desc);

create table if not exists settings (
  id int primary key default 1 check (id = 1),
  max_active_projects int not null default 5,
  per_purchase_cap_cents int not null default 5000,
  monthly_cap_cents int not null default 20000,
  focus_minutes int not null default 50,
  last_review_at timestamptz
);
insert into settings (id) values (1) on conflict do nothing;

-- Lock everything down: only the server (service role) talks to these tables.
alter table projects enable row level security;
alter table tasks enable row level security;
alter table ideas enable row level security;
alter table focus_sessions enable row level security;
alter table actions enable row level security;
alter table settings enable row level security;
