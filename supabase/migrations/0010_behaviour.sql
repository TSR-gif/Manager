-- Designed around how people really use apps (research 13 Nov 2026).

-- "What MyManager did today", each with an undo where possible.
create table if not exists activity (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  undo jsonb,
  undone boolean not null default false,
  created_at timestamptz not null default now()
);
alter table activity enable row level security;

-- Private usage log so MyManager can learn how Thomas actually uses it. Stays in his own database.
create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  device text,
  seconds int,
  created_at timestamptz not null default now()
);
alter table usage_events enable row level security;

-- How often it may message him first: 'needed' (only when something needs him), 'daily' (morning catch-up only), 'more' (catch-up + check-ins).
alter table settings add column if not exists message_mode text not null default 'daily';
-- First day of use, for one tip a day in the morning catch-up during the first 10 days.
alter table settings add column if not exists first_seen date not null default current_date;
-- Quiet by default overnight.
update settings set quiet_start = '21:00' where quiet_start = '21:30';
