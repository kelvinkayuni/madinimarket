alter table public.staff_roles
  drop constraint if exists staff_roles_permissions_check;

alter table public.staff_roles
  add constraint staff_roles_permissions_check check (
    cardinality(permissions) > 0
    and permissions <@ array[
      'accounts',
      'translations',
      'homepage_headlines',
      'marketplace_orders',
      'delivery_confirmation',
      'order_disputes',
      'buyer_refunds',
      'account_status_management',
      'account_deletion',
      'seller_submission_reviews',
      'buyer_submission_reviews',
      'subscription_payment_confirmations',
      'customer_support'
    ]::text[]
  );

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
      'account_status_management',
      'account_deletion',
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

create or replace function public.set_staff_role_account_permission(
  p_role_id bigint,
  p_permission text,
  p_enabled boolean,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $set_staff_role_account_permission$
declare
  selected_role public.staff_roles%rowtype;
  updated_permissions text[];
begin
  if p_permission is null
    or p_permission not in ('account_status_management', 'account_deletion')
    or p_enabled is null
  then
    raise exception 'Choose a valid account permission and state.'
      using errcode = '22023';
  end if;

  select * into selected_role
  from public.staff_roles
  where id = p_role_id
  for update;
  if not found then
    raise exception 'Staff role not found.' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(normalized.permission order by normalized.permission), array[]::text[])
  into updated_permissions
  from (
    select distinct candidate.permission
    from unnest(
      case
        when p_enabled then selected_role.permissions || array[p_permission]::text[]
        else array_remove(selected_role.permissions, p_permission)
      end
    ) as candidate(permission)
  ) as normalized;

  if cardinality(updated_permissions) = 0 then
    raise exception 'A role must have at least one permission.'
      using errcode = '22023';
  end if;

  update public.staff_roles
  set permissions = updated_permissions
  where id = p_role_id;

  insert into public.staff_audit_log (
    actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_actor_user_id, 'staff_role_account_permission_updated', 'staff_role', p_role_id::text,
    jsonb_build_object(
      'permission', p_permission,
      'enabled', p_enabled,
      'previous_permissions', selected_role.permissions,
      'permissions', updated_permissions
    )
  );
end;
$set_staff_role_account_permission$;

revoke all on function public.set_staff_role_account_permission(bigint, text, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.set_staff_role_account_permission(bigint, text, boolean, uuid)
  to service_role;
