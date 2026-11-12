create or replace function public.update_unassigned_staff_role(
  p_role_id bigint,
  p_name text,
  p_permissions text[],
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $update_unassigned_staff_role$
declare
  selected_role public.staff_roles%rowtype;
  normalized_name text := trim(p_name);
begin
  if length(normalized_name) < 2 or length(normalized_name) > 80
    or cardinality(p_permissions) = 0
    or not (p_permissions <@ array[
      'accounts',
      'translations',
      'homepage_headlines',
      'marketplace_orders',
      'delivery_confirmation',
      'order_disputes',
      'buyer_refunds',
      'seller_submission_reviews',
      'buyer_submission_reviews',
      'subscription_payment_confirmations',
      'customer_support'
    ]::text[])
  then
    raise exception 'Enter a role name and choose at least one valid permission.'
      using errcode = '22023';
  end if;

  select * into selected_role
  from public.staff_roles
  where id = p_role_id
  for update;
  if not found then
    raise exception 'Staff role not found.' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.staff_member_roles
    where role_id = p_role_id
  ) then
    raise exception 'This role is assigned to staff and cannot be edited.'
      using errcode = '23503';
  end if;

  update public.staff_roles
  set name = normalized_name, permissions = p_permissions
  where id = p_role_id;

  insert into public.staff_audit_log (
    actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_actor_user_id, 'staff_role_updated', 'staff_role', p_role_id::text,
    jsonb_build_object(
      'previous_name', selected_role.name,
      'previous_permissions', selected_role.permissions,
      'name', normalized_name,
      'permissions', p_permissions
    )
  );
end;
$update_unassigned_staff_role$;

revoke all on function public.update_unassigned_staff_role(bigint, text, text[], uuid)
  from public, anon, authenticated;
grant execute on function public.update_unassigned_staff_role(bigint, text, text[], uuid)
  to service_role;

create or replace function public.delete_unassigned_staff_role(
  p_role_id bigint,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $delete_unassigned_staff_role$
declare
  selected_role public.staff_roles%rowtype;
begin
  select * into selected_role
  from public.staff_roles
  where id = p_role_id
  for update;
  if not found then
    raise exception 'Staff role not found.' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.staff_member_roles
    where role_id = p_role_id
  ) then
    raise exception 'This role is assigned to staff and cannot be deleted.'
      using errcode = '23503';
  end if;

  delete from public.staff_roles where id = p_role_id;

  insert into public.staff_audit_log (
    actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_actor_user_id, 'staff_role_deleted', 'staff_role', p_role_id::text,
    jsonb_build_object('name', selected_role.name, 'permissions', selected_role.permissions)
  );
end;
$delete_unassigned_staff_role$;

revoke all on function public.delete_unassigned_staff_role(bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_unassigned_staff_role(bigint, uuid)
  to service_role;

notify pgrst, 'reload schema';
