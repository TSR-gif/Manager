-- Recurring jobs for a project: MyManager runs them on a schedule (e.g. "every Wednesday at 2 pm").
-- Anything they make that goes outside (a social post, a reply) lands in Approvals as a draft with a preview.
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  name text not null,
  instructions text not null,
  days text not null default 'wed',          -- comma list: mon,tue,wed,thu,fri,sat,sun
  at_time text not null default '14:00',      -- HH:MM, Melbourne
  source_url text,                            -- optional: where to read real data from (export link, page)
  enabled boolean not null default false,
  last_run_at timestamptz,
  last_run_id uuid,
  created_at timestamptz not null default now()
);
alter table jobs enable row level security;

-- Worked example: Bargie (Rewards App) weekly social posts + weekly report. Off until Thomas turns them on.
insert into jobs (project_id, name, instructions, days, at_time)
select p.id, 'Weekly social posts',
  'After the Wednesday price upload, make this week''s Bargie posts for TikTok and Instagram from real numbers only. Ideas: the same 15 items priced at Coles, Woolies and Aldi; the biggest price drops this week; the best points deal. For each post call draft_social_post with a picture slideshow (5 to 8 slides, each a short heading plus the real price or fact, and which product photo to use), a caption in Bargie''s honest, friendly voice, and 5 to 10 hashtags. Make 3 posts. Never invent a price: if you can''t read this week''s real numbers, draft nothing and say what you need. Also draft replies to any new comments or questions you are given, with draft_social_post channel "reply". Nothing is posted until Thomas approves.',
  'wed', '14:00'
from projects p where p.name = 'Rewards App'
  and not exists (select 1 from jobs j where j.name = 'Weekly social posts' and j.project_id = p.id);

insert into jobs (project_id, name, instructions, days, at_time)
select p.id, 'Weekly post report',
  'Write the weekly Bargie social report: which posts went out this week (approved social posts in Approvals), and which brought downloads, using any numbers you can read (app store or analytics links, or what Thomas told you). If you can''t see download numbers, say so and ask him for them in one line. Finish with the one change to make next week.',
  'mon', '09:00'
from projects p where p.name = 'Rewards App'
  and not exists (select 1 from jobs j where j.name = 'Weekly post report' and j.project_id = p.id);
