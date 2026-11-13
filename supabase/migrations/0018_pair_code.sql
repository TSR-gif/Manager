-- Telegram pairing uses a random one-time code instead of part of the app key.
alter table settings add column if not exists telegram_pair_code text;
alter table settings add column if not exists telegram_pair_expires timestamptz;
