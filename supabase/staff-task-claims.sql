create table if not exists public.staff_task_claims (
  task_type text not null,
  task_id text not null,
  staff_member_id bigint not null references public.staff_members (id) on delete cascade,
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (task_type, task_id)
);

create index if not exists staff_task_claims_expiry_idx
  on public.staff_task_claims (expires_at);

alter table public.staff_task_claims enable row level security;
revoke all on public.staff_task_claims from anon, authenticated;
grant all on public.staff_task_claims to service_role;

create or replace function public.claim_staff_task(
  p_staff_member_id bigint,
  p_task_type text,
  p_task_id text
)
returns table (staff_member_id bigint, claimed_at timestamptz, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $claim_staff_task$
begin
  if p_task_type not in (
    'listing_review', 'buyer_request_review', 'certificate_review',
    'marketplace_order', 'marketplace_order_item', 'support_thread',
    'website_account', 'translation_pair', 'homepage_headline', 'homepage_setting'
  ) or nullif(trim(p_task_id), '') is null or length(p_task_id) > 160 then
    raise exception 'Choose a valid staff task.' using errcode = '22023';
  end if;

  delete from public.staff_task_claims
  where expires_at <= now();

  insert into public.staff_task_claims as claims (
    task_type, task_id, staff_member_id, claimed_at, expires_at
  ) values (
    p_task_type, trim(p_task_id), p_staff_member_id, now(), now() + interval '15 minutes'
  )
  on conflict (task_type, task_id) do update
  set staff_member_id = excluded.staff_member_id,
      claimed_at = case
        when claims.staff_member_id = excluded.staff_member_id then claims.claimed_at
        else now()
      end,
      expires_at = now() + interval '15 minutes'
  where claims.expires_at <= now()
     or claims.staff_member_id = excluded.staff_member_id;

  return query
  select claims.staff_member_id, claims.claimed_at, claims.expires_at
  from public.staff_task_claims as claims
  where claims.task_type = p_task_type
    and claims.task_id = trim(p_task_id)
    and claims.staff_member_id = p_staff_member_id;
end;
$claim_staff_task$;

revoke all on function public.claim_staff_task(bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_staff_task(bigint, text, text)
  to service_role;

notify pgrst, 'reload schema';
