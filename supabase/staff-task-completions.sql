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
  group by completions.staff_member_id, completions.task_type;
$admin_staff_completion_counts$;

revoke all on function public.admin_staff_completion_counts()
  from public, anon, authenticated;
grant execute on function public.admin_staff_completion_counts()
  to service_role;

notify pgrst, 'reload schema';
