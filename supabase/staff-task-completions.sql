create table if not exists public.staff_task_completions (
  id bigint generated always as identity primary key,
  staff_member_id bigint not null,
  staff_name text not null,
  employee_code text not null,
  task_type text not null check (task_type in (
    'listing_review', 'buyer_request_review', 'certificate_review',
    'marketplace_order', 'marketplace_delivery', 'marketplace_payout',
    'marketplace_dispute', 'buyer_refund', 'support_thread',
    'website_account', 'translation_pair', 'homepage_setting',
    'account_setting', 'subscription_payment'
  )),
  task_id text not null,
  action text not null,
  completed_at timestamptz not null default now()
);

create index if not exists staff_task_completions_staff_completed_idx
  on public.staff_task_completions (staff_member_id, completed_at desc);
create index if not exists staff_task_completions_completed_idx
  on public.staff_task_completions (completed_at desc, staff_member_id, task_type);

alter table public.staff_task_completions enable row level security;
revoke all on public.staff_task_completions from anon, authenticated;
grant all on public.staff_task_completions to service_role;
grant usage, select on sequence public.staff_task_completions_id_seq to service_role;

delete from public.staff_task_completions
where task_type = 'website_account'
  and action in ('bank_edit_enabled', 'bank_edit_disabled');

create or replace function public.admin_staff_completion_counts()
returns table (
  staff_member_id bigint,
  task_type text,
  today_count bigint,
  month_count bigint,
  year_count bigint
)
language sql
stable
security definer
set search_path = ''
as $admin_staff_completion_counts$
  with boundaries as (
    select
      date_trunc('day', now() at time zone 'Africa/Dar_es_Salaam')
        at time zone 'Africa/Dar_es_Salaam' as today_start,
      date_trunc('month', now() at time zone 'Africa/Dar_es_Salaam')
        at time zone 'Africa/Dar_es_Salaam' as month_start,
      date_trunc('year', now() at time zone 'Africa/Dar_es_Salaam')
        at time zone 'Africa/Dar_es_Salaam' as year_start
  )
  select
    completions.staff_member_id,
    completions.task_type,
    count(*) filter (where completions.completed_at >= boundaries.today_start) as today_count,
    count(*) filter (where completions.completed_at >= boundaries.month_start) as month_count,
    count(*) as year_count
  from public.staff_task_completions as completions
  cross join boundaries
  where completions.completed_at >= boundaries.year_start
    and not (
      completions.task_type = 'website_account'
      and completions.action in ('bank_edit_enabled', 'bank_edit_disabled')
    )
  group by completions.staff_member_id, completions.task_type;
$admin_staff_completion_counts$;

revoke all on function public.admin_staff_completion_counts()
  from public, anon, authenticated;
grant execute on function public.admin_staff_completion_counts()
  to service_role;

create or replace function public.admin_staff_completion_history(
  p_staff_member_id bigint,
  p_period text,
  p_before_id bigint default null
)
returns table (
  id bigint,
  task_type text,
  task_id text,
  action text,
  completed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $admin_staff_completion_history$
  with boundaries as (
    select
      date_trunc('day', now() at time zone 'Africa/Dar_es_Salaam')
        at time zone 'Africa/Dar_es_Salaam' as today_start,
      date_trunc('month', now() at time zone 'Africa/Dar_es_Salaam')
        at time zone 'Africa/Dar_es_Salaam' as month_start,
      date_trunc('year', now() at time zone 'Africa/Dar_es_Salaam')
        at time zone 'Africa/Dar_es_Salaam' as year_start
  )
  select
    completions.id,
    completions.task_type,
    completions.task_id,
    completions.action,
    completions.completed_at
  from public.staff_task_completions as completions
  cross join boundaries
  where completions.staff_member_id = p_staff_member_id
    and completions.completed_at >= case p_period
      when 'today' then boundaries.today_start
      when 'month' then boundaries.month_start
      when 'year' then boundaries.year_start
      else null
    end
    and not (
      completions.task_type = 'website_account'
      and completions.action in ('bank_edit_enabled', 'bank_edit_disabled')
    )
    and (p_before_id is null or completions.id < p_before_id)
  order by completions.id desc
  limit 51;
$admin_staff_completion_history$;

revoke all on function public.admin_staff_completion_history(bigint, text, bigint)
  from public, anon, authenticated;
grant execute on function public.admin_staff_completion_history(bigint, text, bigint)
  to service_role;

create or replace function public.admin_update_website_account_state(
  p_account_id uuid,
  p_state text,
  p_value boolean,
  p_staff_member_id bigint default null,
  p_staff_name text default null,
  p_employee_code text default null
)
returns table (
  account_id uuid,
  is_active boolean,
  bank_info_edit_unlocked boolean,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $admin_update_website_account_state$
declare
  account_row public.website_accounts%rowtype;
begin
  if p_state not in ('is_active', 'bank_info_edit_unlocked') then
    raise exception 'Unsupported website account state.';
  end if;
  if p_staff_member_id is not null and (p_staff_name is null or p_employee_code is null) then
    raise exception 'Staff completion identity is incomplete.';
  end if;
  if p_staff_member_id is null and (p_staff_name is not null or p_employee_code is not null) then
    raise exception 'Staff completion identity is inconsistent.';
  end if;

  if p_state = 'is_active' then
    update public.website_accounts as account
    set is_active = p_value
    where account.id = p_account_id
      and account.is_active is distinct from p_value
    returning account.* into account_row;
  else
    update public.website_accounts as account
    set bank_info_edit_unlocked = p_value
    where account.id = p_account_id
      and account.bank_info_edit_unlocked is distinct from p_value
    returning account.* into account_row;
  end if;

  if found then
    if p_staff_member_id is not null and p_state = 'is_active' then
      insert into public.staff_task_completions (
        staff_member_id,
        staff_name,
        employee_code,
        task_type,
        task_id,
        action
      ) values (
        p_staff_member_id,
        p_staff_name,
        p_employee_code,
        'website_account',
        p_account_id::text,
        case
          when p_value then 'set_active_true'
          else 'set_active_false'
        end
      );
    end if;
    return query
      select account_row.id, account_row.is_active, account_row.bank_info_edit_unlocked, true;
    return;
  end if;

  select account.*
    into account_row
  from public.website_accounts as account
  where account.id = p_account_id;
  if not found then
    return;
  end if;

  return query
    select account_row.id, account_row.is_active, account_row.bank_info_edit_unlocked, false;
end;
$admin_update_website_account_state$;

revoke all on function public.admin_update_website_account_state(uuid, text, boolean, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_update_website_account_state(uuid, text, boolean, bigint, text, text)
  to service_role;

notify pgrst, 'reload schema';
