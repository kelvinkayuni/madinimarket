alter table public.staff_members
  drop constraint if exists staff_members_job_role_check;

create table if not exists public.staff_roles (
  id bigint generated always as identity primary key,
  name text not null unique check (length(trim(name)) between 2 and 80),
  permissions text[] not null check (
    cardinality(permissions) > 0
    and permissions <@ array[
      'delivery_confirmation',
      'marketplace_orders',
      'accounting',
      'customer_support',
      'market_moderation',
      'review_submissions',
      'accounts',
      'translations',
      'homepage_headlines'
    ]::text[]
  ),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_member_roles (
  staff_member_id bigint not null references public.staff_members (id) on delete cascade,
  role_id bigint not null references public.staff_roles (id) on delete cascade,
  assigned_by uuid references auth.users (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (staff_member_id, role_id)
);

create index if not exists staff_member_roles_role_idx
  on public.staff_member_roles (role_id);

alter table public.staff_roles enable row level security;
alter table public.staff_member_roles enable row level security;
revoke all on public.staff_roles, public.staff_member_roles from anon, authenticated;
grant all on public.staff_roles, public.staff_member_roles to service_role;
grant usage, select on sequence public.staff_roles_id_seq to service_role;

insert into public.staff_roles (name, permissions)
values ('Delivery confirmation', array['delivery_confirmation']::text[])
on conflict (name) do nothing;

insert into public.staff_member_roles (staff_member_id, role_id)
select member.id, role.id
from public.staff_members as member
cross join public.staff_roles as role
where member.job_role = 'order_operations'
  and role.name = 'Delivery confirmation'
on conflict (staff_member_id, role_id) do nothing;

update public.staff_members
set job_role = 'multiple'
where job_role = 'order_operations';

create or replace function public.staff_has_permission(
  p_staff_user_id uuid,
  p_permission text
)
returns boolean
language sql
security definer
set search_path = ''
as $staff_has_permission$
  select exists (
    select 1
    from public.staff_members as member
    join public.staff_member_roles as assignment on assignment.staff_member_id = member.id
    join public.staff_roles as role on role.id = assignment.role_id
    where member.user_id = p_staff_user_id
      and member.status = 'active'
      and p_permission = any(role.permissions)
  );
$staff_has_permission$;

revoke all on function public.staff_has_permission(uuid, text)
  from public, anon, authenticated;
grant execute on function public.staff_has_permission(uuid, text)
  to service_role;

create or replace function public.replace_staff_role_assignments(
  p_staff_member_id bigint,
  p_role_ids bigint[],
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $replace_staff_role_assignments$
declare
  selected_count integer;
begin
  if cardinality(p_role_ids) = 0 then
    raise exception 'Assign at least one role.' using errcode = '22023';
  end if;
  perform 1 from public.staff_members where id = p_staff_member_id for update;
  if not found then
    raise exception 'Staff member not found.' using errcode = 'P0002';
  end if;
  select count(*) into selected_count
  from public.staff_roles
  where id = any(p_role_ids);
  if selected_count <> cardinality(p_role_ids) then
    raise exception 'One or more selected roles are no longer available.' using errcode = '22023';
  end if;

  delete from public.staff_member_roles where staff_member_id = p_staff_member_id;
  insert into public.staff_member_roles (staff_member_id, role_id, assigned_by)
  select p_staff_member_id, selected_role_id, p_actor_user_id
  from unnest(p_role_ids) as selected_role_id;

  insert into public.staff_audit_log (
    actor_user_id, staff_member_id, action, entity_type, entity_id, details
  ) values (
    p_actor_user_id, p_staff_member_id, 'staff_roles_updated',
    'staff_member', p_staff_member_id::text,
    jsonb_build_object('role_ids', p_role_ids)
  );
end;
$replace_staff_role_assignments$;

revoke all on function public.replace_staff_role_assignments(bigint, bigint[], uuid)
  from public, anon, authenticated;
grant execute on function public.replace_staff_role_assignments(bigint, bigint[], uuid)
  to service_role;

create or replace function public.staff_review_listing(
  p_staff_user_id uuid,
  p_listing_id bigint,
  p_approved boolean,
  p_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $staff_review_listing$
declare
  selected_staff_id bigint;
begin
  select id into selected_staff_id
  from public.staff_members
  where user_id = p_staff_user_id and status = 'active';
  if not found or not public.staff_has_permission(p_staff_user_id, 'market_moderation')
    and not public.staff_has_permission(p_staff_user_id, 'review_submissions') then
    raise exception 'Active market moderation access is required.' using errcode = '42501';
  end if;
  if not p_approved and nullif(trim(p_message), '') is null then
    raise exception 'A rejection message is required.' using errcode = '22023';
  end if;
  update public.listings
  set status = case when p_approved then 'approved' else 'rejected' end,
      review_message = case when p_approved then null else trim(p_message) end,
      reviewed_by = p_staff_user_id,
      reviewed_at = now()
  where id = p_listing_id and status = 'pending';
  if not found then raise exception 'Pending seller listing not found.' using errcode = 'P0002'; end if;
  insert into public.staff_audit_log (actor_user_id, staff_member_id, action, entity_type, entity_id, details)
  values (p_staff_user_id, selected_staff_id, 'review_listing', 'listing', p_listing_id::text,
    jsonb_build_object('approved', p_approved));
end;
$staff_review_listing$;

create or replace function public.staff_review_buy_request(
  p_staff_user_id uuid,
  p_request_id bigint,
  p_approved boolean,
  p_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $staff_review_buy_request$
declare
  selected_staff_id bigint;
begin
  select id into selected_staff_id
  from public.staff_members
  where user_id = p_staff_user_id and status = 'active';
  if not found or not public.staff_has_permission(p_staff_user_id, 'market_moderation')
    and not public.staff_has_permission(p_staff_user_id, 'review_submissions') then
    raise exception 'Active market moderation access is required.' using errcode = '42501';
  end if;
  if not p_approved and nullif(trim(p_message), '') is null then
    raise exception 'A rejection message is required.' using errcode = '22023';
  end if;
  update public.buy_requests
  set status = case when p_approved then 'approved' else 'rejected' end,
      review_message = case when p_approved then null else trim(p_message) end,
      reviewed_by = p_staff_user_id,
      reviewed_at = now()
  where id = p_request_id and status = 'pending';
  if not found then raise exception 'Pending buyer request not found.' using errcode = 'P0002'; end if;
  insert into public.staff_audit_log (actor_user_id, staff_member_id, action, entity_type, entity_id, details)
  values (p_staff_user_id, selected_staff_id, 'review_buy_request', 'buy_request', p_request_id::text,
    jsonb_build_object('approved', p_approved));
end;
$staff_review_buy_request$;

revoke all on function public.staff_review_listing(uuid, bigint, boolean, text)
  from public, anon, authenticated;
grant execute on function public.staff_review_listing(uuid, bigint, boolean, text)
  to service_role;
revoke all on function public.staff_review_buy_request(uuid, bigint, boolean, text)
  from public, anon, authenticated;
grant execute on function public.staff_review_buy_request(uuid, bigint, boolean, text)
  to service_role;

create or replace function public.staff_confirm_marketplace_order_delivery(
  p_staff_user_id uuid,
  p_order_item_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $staff_confirm_marketplace_order_delivery$
declare
  updated_items integer;
  staff_member_id bigint;
begin
  select member.id into staff_member_id
  from public.staff_members as member
  where member.user_id = p_staff_user_id
    and member.status = 'active'
    and exists (
      select 1
      from public.staff_member_roles as assignment
      join public.staff_roles as role on role.id = assignment.role_id
      where assignment.staff_member_id = member.id
        and (
          'delivery_confirmation' = any(role.permissions)
          or 'marketplace_orders' = any(role.permissions)
        )
    );
  if not found then
    raise exception 'Active marketplace order access is required.' using errcode = '42501';
  end if;

  updated_items := public.confirm_marketplace_order_shipment_delivery(p_order_item_id);

  insert into public.staff_audit_log (
    actor_user_id, staff_member_id, action, entity_type, entity_id, details
  ) values (
    p_staff_user_id, staff_member_id, 'confirm_shipment_delivery',
    'marketplace_order_item', p_order_item_id::text,
    jsonb_build_object('items_updated', updated_items)
  );
  return updated_items;
end;
$staff_confirm_marketplace_order_delivery$;

notify pgrst, 'reload schema';
