-- Friendlier setup: remember the Telegram bot's name so the app can link straight to it,
-- and replace developer jargon in Manager's own next step.
alter table settings add column if not exists telegram_bot_name text;
update projects set next_action = 'Use Manager every day this week and tell it what gets in your way'
  where name = 'Manager' and next_action = 'Go live: run setup.sql, add secrets in Vercel, use it daily for a week';
