-- Project kind: app (something he builds), client (paid job for someone), personal
alter table projects add column if not exists kind text not null default 'app';
-- Trust ladder: after N straight approvals of a trustable action type, it runs on its own (0 = off)
alter table settings add column if not exists trust_after int not null default 3;

-- Altona Sports Centre is a paid job Thomas is doing, not an app
update projects set kind = 'client',
  goal = 'Deliver the Altona Sports Centre job on time and get paid',
  next_action = 'Write down the scope, deadline and agreed price',
  notes = 'Client job (paid work for Altona Sports Centre). Track scope, deliverables, hours, invoice and payment here.'
where name = 'Altona Sports Centre' and goal like 'Define the goal%';

-- Phone bot: the one Telegram chat allowed to approve and talk to Manager
alter table settings add column if not exists telegram_chat_id text;
