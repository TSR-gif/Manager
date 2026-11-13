-- Fixes from the outside program review (2026-11-14).

-- 1) Runbooks hold folder paths, commands and job output: lock them down like every other table.
--    Only the server (service role) reads them; the public API roles get nothing.
alter table runbooks enable row level security;
alter table runbook_log enable row level security;

-- 2) Spending: one place, inside the database, decides whether a paid request fits under the caps.
--    Every check takes the same lock, so five requests at once can't each see room for themselves.
--    Money counts in the month it was approved (in Thomas's time zone), plus anything still waiting for his OK.
alter table actions add column if not exists spent_at timestamptz;
alter table settings add column if not exists budget_timezone text not null default 'Australia/Melbourne';
alter table settings add column if not exists currency text not null default 'AUD';
update actions set spent_at = coalesce(decided_at, created_at)
  where spent_at is null and cost_cents > 0 and status in ('approved', 'executed');

create or replace function mm_budget_used(p_exclude uuid default null, p_include_pending boolean default true)
returns bigint language sql stable as $$
  select coalesce(sum(a.cost_cents), 0)::bigint
  from actions a cross join settings s
  where s.id = 1 and a.cost_cents > 0 and a.id is distinct from p_exclude and (
    (p_include_pending and a.status = 'pending')
    or (a.status in ('approved', 'executed')
        and a.spent_at >= (date_trunc('month', now() at time zone s.budget_timezone) at time zone s.budget_timezone))
  )
$$;

-- Queue a paid request: reserves the money (as "pending") only if it fits, otherwise saves it as blocked.
create or replace function mm_queue_paid_action(
  p_kind text, p_title text, p_reason text, p_payload jsonb, p_cost int, p_project uuid, p_requested_by text
) returns setof actions language plpgsql as $$
declare
  s settings;
  why text;
begin
  perform pg_advisory_xact_lock(7710001);
  select * into s from settings where id = 1;
  if p_cost is null or p_cost <= 0 then raise exception 'mm_queue_paid_action needs a cost above 0'; end if;
  if p_cost > s.per_purchase_cap_cents then why := 'over per-purchase cap';
  elsif mm_budget_used(null, true) + p_cost > s.monthly_cap_cents then why := 'over monthly cap';
  end if;
  return query insert into actions (kind, title, reason, payload, cost_cents, risk, project_id, requested_by, status, result, decided_at)
    values (p_kind, p_title, p_reason, coalesce(p_payload, '{}'::jsonb), p_cost,
            case when why is null then 'approval' else 'blocked' end, p_project, coalesce(p_requested_by, 'user'),
            case when why is null then 'pending' else 'rejected' end,
            case when why is null then null else jsonb_build_object('blocked', why) end,
            case when why is null then null else now() end)
    returning *;
end $$;

-- Decide a pending action exactly once. Approving a paid one re-checks the caps under the same lock
-- (they may have been lowered, or the month may have filled since) and records when the money was spent.
-- Returns the claimed row, or nothing if someone else already decided it.
create or replace function mm_claim_action(p_id uuid, p_approve boolean)
returns setof actions language plpgsql as $$
declare
  a actions;
  s settings;
  why text;
begin
  perform pg_advisory_xact_lock(7710001);
  select * into a from actions where id = p_id and status = 'pending' and decided_at is null for update;
  if not found then return; end if;
  if not p_approve then
    return query update actions set status = 'rejected', decided_at = now() where id = p_id returning *;
    return;
  end if;
  if a.cost_cents > 0 then
    select * into s from settings where id = 1;
    if a.cost_cents > s.per_purchase_cap_cents then why := 'over per-purchase cap';
    elsif mm_budget_used(a.id, true) + a.cost_cents > s.monthly_cap_cents then why := 'over monthly cap';
    end if;
    if why is not null then
      return query update actions set status = 'rejected', decided_at = now(), result = jsonb_build_object('blocked', why)
        where id = p_id returning *;
      return;
    end if;
  end if;
  return query update actions
    set status = 'approved', decided_at = now(), spent_at = case when a.cost_cents > 0 then now() else null end
    where id = p_id returning *;
end $$;

-- 3) Coding loops: remember the commit the work started from, so the review compares against it.
alter table missions add column if not exists base_sha text;

-- On a real Supabase project the public API roles must not reach any of this.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on runbooks, runbook_log from anon, authenticated;
    revoke execute on function mm_budget_used(uuid, boolean), mm_queue_paid_action(text, text, text, jsonb, int, uuid, text), mm_claim_action(uuid, boolean) from public, anon, authenticated;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      grant execute on function mm_budget_used(uuid, boolean), mm_queue_paid_action(text, text, text, jsonb, int, uuid, text), mm_claim_action(uuid, boolean) to service_role;
    end if;
  end if;
end $$;

-- 4) Invoices: numbered from a sequence (never two with the same number) and the hours are claimed in the same
--    step, so a double click or two requests at once can't bill the same hours twice.
create sequence if not exists mm_invoice_seq;
select setval('mm_invoice_seq', greatest(
  coalesce((select max(nullif(regexp_replace(number, '\D', '', 'g'), '')::bigint) from invoices), 0),
  (select count(*) from invoices)) + 1, false);

create or replace function mm_create_invoice(p_project uuid, p_fixed_cents int, p_note text)
returns setof invoices language plpgsql as $$
declare
  rate int;
  mins bigint;
  amount int;
  inv invoices;
begin
  perform pg_advisory_xact_lock(7710002);
  select coalesce(hourly_rate_cents, 0) into rate from projects where id = p_project;
  if not found then return; end if;
  select coalesce(sum(minutes), 0) into mins from time_entries where project_id = p_project and invoice_id is null;
  amount := case when coalesce(p_fixed_cents, 0) > 0 then p_fixed_cents else round(mins / 60.0 * rate)::int end;
  if amount <= 0 then return; end if;
  insert into invoices (project_id, amount_cents, number, note)
    values (p_project, amount, 'INV-' || lpad(nextval('mm_invoice_seq')::text, 3, '0'), p_note)
    returning * into inv;
  if coalesce(p_fixed_cents, 0) <= 0 then
    update time_entries set invoice_id = inv.id where project_id = p_project and invoice_id is null;
  end if;
  return next inv;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function mm_create_invoice(uuid, int, text) from public, anon, authenticated;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      grant execute on function mm_create_invoice(uuid, int, text) to service_role;
      grant usage on sequence mm_invoice_seq to service_role;
    end if;
  end if;
end $$;
