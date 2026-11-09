alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check check (role in ('user', 'admin', 'staff'));

create table if not exists public.staff_members (
  id bigint generated always as identity primary key,
  employee_code text generated always as ('MMSA-' || lpad(id::text, 4, '0')) stored unique,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 1 and 120),
  job_role text not null check (job_role = 'order_operations'),
  status text not null default 'invited' check (status in ('invited', 'active', 'suspended')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users (id) on delete set null,
  staff_member_id bigint references public.staff_members (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists staff_members_status_role_idx
  on public.staff_members (status, job_role);
create index if not exists staff_audit_log_created_at_idx
  on public.staff_audit_log (created_at desc);

alter table public.staff_members enable row level security;
alter table public.staff_audit_log enable row level security;
revoke all on public.staff_members, public.staff_audit_log from anon, authenticated;
grant all on public.staff_members, public.staff_audit_log to service_role;
grant usage, select on sequence public.staff_members_id_seq, public.staff_audit_log_id_seq
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
  select staff.id into staff_member_id
  from public.staff_members as staff
  where staff.user_id = p_staff_user_id
    and staff.job_role = 'order_operations'
    and staff.status = 'active';
  if not found then
    raise exception 'Active order operations staff access is required.' using errcode = '42501';
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

revoke all on function public.staff_confirm_marketplace_order_delivery(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.staff_confirm_marketplace_order_delivery(uuid, uuid)
  to service_role;

create or replace function public.activate_staff_invitation(p_staff_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $activate_staff_invitation$
declare
  selected_staff public.staff_members%rowtype;
begin
  select * into selected_staff
  from public.staff_members
  where user_id = p_staff_user_id
  for update;
  if not found or selected_staff.status = 'suspended' then
    raise exception 'This staff invitation is no longer available.' using errcode = '42501';
  end if;
  if selected_staff.status = 'invited' then
    update public.staff_members
    set status = 'active', updated_at = now()
    where id = selected_staff.id;
    insert into public.staff_audit_log (
      actor_user_id, staff_member_id, action, entity_type, entity_id
    ) values (
      p_staff_user_id, selected_staff.id, 'staff_invitation_accepted',
      'staff_member', selected_staff.id::text
    );
  end if;
  return true;
end;
$activate_staff_invitation$;

revoke all on function public.activate_staff_invitation(uuid)
  from public, anon, authenticated;
grant execute on function public.activate_staff_invitation(uuid)
  to service_role;

notify pgrst, 'reload schema';
