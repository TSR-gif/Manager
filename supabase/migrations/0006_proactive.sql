-- Proactive assistant: it messages Thomas first (morning brief, check-ins), runs jobs in the background,
-- has a name, and can keep a specialist watching a project.
alter table settings add column if not exists assistant_name text not null default 'Manager';
alter table settings add column if not exists proactive boolean not null default true;
alter table settings add column if not exists brief_time text not null default '07:30';
alter table settings add column if not exists checkin_hours int not null default 3;
alter table settings add column if not exists quiet_start text not null default '21:30';
alter table settings add column if not exists last_brief_date text;
alter table settings add column if not exists last_checkin_at timestamptz;

alter table agent_runs add column if not exists kind text not null default 'chat'; -- chat | brief | checkin | job
alter table agent_runs add column if not exists unread boolean not null default false;

alter table projects add column if not exists watch boolean not null default false; -- has a specialist watching it
