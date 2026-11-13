-- Client jobs: hours and invoices (e.g. Altona Sports Centre)
alter table projects add column if not exists client_name text;
alter table projects add column if not exists hourly_rate_cents int;

create table if not exists time_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  worked_on date not null default current_date,
  minutes int not null check (minutes > 0),
  note text,
  invoice_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  number text,
  amount_cents int not null check (amount_cents >= 0),
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  issued_on date,
  due_on date,
  paid_on date,
  note text,
  created_at timestamptz not null default now()
);

-- Subscriptions: what his projects and tools cost
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  project_id uuid references projects(id) on delete set null,
  amount_cents int not null check (amount_cents >= 0),
  currency text not null default 'AUD',
  cycle text not null default 'monthly' check (cycle in ('monthly', 'yearly', 'weekly')),
  next_renewal date,
  url text,
  status text not null default 'active' check (status in ('active', 'cancelled', 'trial')),
  note text,
  created_at timestamptz not null default now()
);

-- What Manager knows about Thomas (he can see, edit and delete every fact)
create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  fact text not null,
  category text not null default 'general' check (category in ('general', 'preference', 'person', 'routine', 'work', 'money')),
  source text not null default 'user' check (source in ('user', 'assistant')),
  created_at timestamptz not null default now()
);

alter table time_entries enable row level security;
alter table invoices enable row level security;
alter table subscriptions enable row level security;
alter table memories enable row level security;

-- Starting facts, all learned from Thomas so far
insert into memories (fact, category, source)
select f, c, 'assistant' from (values
  ('Lives in Melbourne, Australia. Prices in AUD.', 'general'),
  ('Wants the assistant to do things, not just advise, and to make low-stakes decisions itself.', 'preference'),
  ('Polished UI matters a lot to him.', 'preference'),
  ('Money, signups and messages sent as him always need his approval. Never store card numbers or passwords.', 'preference'),
  ('Runs TS Rail (tsrail.com.au), his business.', 'work'),
  ('Altona Sports Centre is a paid client job he is doing.', 'work'),
  ('Day trader uses pretend money only unless he says otherwise.', 'money')
) as v(f, c)
where not exists (select 1 from memories);
