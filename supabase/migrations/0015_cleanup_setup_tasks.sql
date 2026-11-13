-- MyManager used to add "connect GitHub / live-site link in Settings" tasks. Thomas asked it to stop:
-- it now uses the folders, git and GitHub sign-in already on his PC. Tick off the ones it made (reversible).
update tasks set status = 'done', done_at = now()
where status <> 'done' and title ilike '%connect%' and (title ilike '%github%' or title ilike '%live%site%') and title ilike '%settings%';
