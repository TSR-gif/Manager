-- A living brief per project that MyManager writes from the real code and reads before it answers or acts.
-- Thomas's own rules for a project live separately (rules) and are never overwritten by the assistant.
alter table projects add column if not exists brief text;
alter table projects add column if not exists brief_updated_at timestamptz;
alter table projects add column if not exists brief_commit text;          -- latest commit seen when the brief was written
alter table projects add column if not exists brief_edited_by_you boolean not null default false;
alter table projects add column if not exists rules text;

update projects set rules = 'Pretend money only. Never connect a real broker, add real broker keys, or write code that places real orders unless Thomas says so in his own words. Run Python with `py` on his PC.'
where name = 'Day trader' and rules is null;
