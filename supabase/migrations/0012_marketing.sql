-- Ads for a project's marketing. MyManager drafts campaigns and tracks results; launching or changing
-- a budget is money, so it always goes through Approvals and the spend limits.
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  name text not null,
  platform text not null default 'meta',         -- meta (Facebook + Instagram), tiktok, google, apple
  goal text,                                      -- e.g. app installs
  audience text,
  creative text,                                  -- what the ad shows / says
  daily_budget_cents int not null default 0,
  days int not null default 7,
  status text not null default 'draft' check (status in ('draft', 'waiting', 'ready', 'live', 'paused', 'ended')),
  spend_cents int not null default 0,
  installs int not null default 0,
  clicks int not null default 0,
  impressions int not null default 0,
  started_on date,
  notes text,
  created_at timestamptz not null default now()
);
alter table campaigns enable row level security;
