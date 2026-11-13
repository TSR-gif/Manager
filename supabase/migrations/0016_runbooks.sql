-- Runbooks: a list of steps MyManager carries out on Thomas's PC and watches (start a long job and keep the PC awake,
-- close a program, commit and push, delete a folder with his OK, hand a sign-in over to him).
-- Nothing runs until Thomas approves the whole list; deleting asks again at that step.
create table if not exists runbooks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  title text not null,
  work_dir text,
  status text not null default 'draft',       -- draft | queued | running | waiting | done | stopped | failed
  steps jsonb not null default '{"list": []}',  -- {"list": [Step]} (see src/lib/runbooks.ts)
  last_update text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table if not exists runbook_log (
  id uuid primary key default gen_random_uuid(),
  runbook_id uuid references runbooks(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);
