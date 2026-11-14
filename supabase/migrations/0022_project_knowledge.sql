-- What MyManager has worked out about each project from studying it in depth: the business facts the app holds,
-- how its data is laid out, where it's hosted, what's broken, and what only Thomas can do. For the assistant's own use:
-- kept in MyManager's own database, never written into the project's folder or shown as a screen of detail.
alter table projects add column if not exists knowledge text;
alter table projects add column if not exists knowledge_updated_at timestamptz;
-- Folders and files on Thomas's PC that hold the project's data (spreadsheets, exports, PDFs), one per line.
alter table projects add column if not exists data_paths text;
