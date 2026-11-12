do $drop_permission_constraints$
declare
  permission_constraint record;
begin
  for permission_constraint in
    select constraint_row.conname
    from pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.staff_roles'::regclass
      and constraint_row.contype = 'c'
      and pg_get_constraintdef(constraint_row.oid) ilike '%permissions%'
  loop
    execute format('alter table public.staff_roles drop constraint %I', permission_constraint.conname);
  end loop;
end;
$drop_permission_constraints$;

update public.staff_roles as role
set permissions = (
  select array_agg(permission order by permission)
  from (
    select distinct mapped.permission
    from unnest(role.permissions) as old(permission)
    cross join lateral unnest(
      case old.permission
        when 'accounting' then array['marketplace_orders']::text[]
        when 'market_moderation' then array['seller_submission_reviews', 'buyer_submission_reviews']::text[]
        else array[old.permission]::text[]
      end
    ) as mapped(permission)
  ) as migrated
);

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
  if not found or not public.staff_has_permission(p_staff_user_id, 'seller_submission_reviews') then
    raise exception 'Active seller submission review access is required.' using errcode = '42501';
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
  if not found or not public.staff_has_permission(p_staff_user_id, 'buyer_submission_reviews') then
    raise exception 'Active buyer submission review access is required.' using errcode = '42501';
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
  selected_staff_id bigint;
begin
  select id into selected_staff_id
  from public.staff_members
  where user_id = p_staff_user_id
    and status = 'active'
    and public.staff_has_permission(p_staff_user_id, 'delivery_confirmation');
  if not found then
    raise exception 'Active delivery confirmation access is required.' using errcode = '42501';
  end if;

  updated_items := public.confirm_marketplace_order_shipment_delivery(p_order_item_id);

  insert into public.staff_audit_log (
    actor_user_id, staff_member_id, action, entity_type, entity_id, details
  ) values (
    p_staff_user_id, selected_staff_id, 'confirm_shipment_delivery',
    'marketplace_order_item', p_order_item_id::text,
    jsonb_build_object('items_updated', updated_items)
  );
  return updated_items;
end;
$staff_confirm_marketplace_order_delivery$;

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
    'marketplace_order', 'marketplace_order_item', 'marketplace_delivery',
    'marketplace_payout', 'marketplace_dispute', 'buyer_refund',
    'subscription_payment', 'account_setting', 'support_thread',
    'website_account', 'translation_pair', 'homepage_headline', 'homepage_setting'
  ) or nullif(trim(p_task_id), '') is null or length(p_task_id) > 160 then
    raise exception 'Choose a valid staff task.' using errcode = '22023';
  end if;

  delete from public.staff_task_claims as expired_claims
  where expired_claims.expires_at <= now();

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

create or replace function public.review_website_subscription(
  p_subscription_id uuid,
  p_admin_id uuid,
  p_approved boolean,
  p_review_note text
)
returns public.account_subscriptions
language plpgsql
security definer
set search_path = ''
as $review_subscription$
declare
  requested_website_user_id uuid;
  requested_subscription public.account_subscriptions%rowtype;
  current_subscription public.account_subscriptions%rowtype;
  approved_subscription public.account_subscriptions%rowtype;
  subscription_start timestamptz;
begin
  if not exists (select 1 from public.profiles where id = p_admin_id and role = 'admin')
    and not (
      exists (select 1 from public.profiles where id = p_admin_id and role = 'staff')
      and public.staff_has_permission(p_admin_id, 'subscription_payment_confirmations')
    )
  then
    raise exception 'Admin or assigned subscription payment confirmation access required' using errcode = '42501';
  end if;

  if not p_approved and char_length(trim(coalesce(p_review_note, ''))) = 0 then
    raise exception 'Provide a reason when rejecting a subscription payment' using errcode = '22023';
  end if;
  if char_length(coalesce(p_review_note, '')) > 500 then
    raise exception 'Review notes must be 500 characters or fewer' using errcode = '22023';
  end if;

  select website_user_id into requested_website_user_id
  from public.account_subscriptions
  where id = p_subscription_id and status = 'pending';
  if not found then
    raise exception 'Pending subscription request not found' using errcode = 'P0002';
  end if;

  perform 1 from public.website_accounts
  where id = requested_website_user_id and is_active = true
  for update;
  if not found then
    raise exception 'Website account is not active' using errcode = '22023';
  end if;

  select * into requested_subscription
  from public.account_subscriptions
  where id = p_subscription_id and status = 'pending'
  for update;
  if not found then
    raise exception 'Pending subscription request not found' using errcode = 'P0002';
  end if;

  if not p_approved then
    update public.account_subscriptions
    set status = 'rejected',
        reviewed_by = p_admin_id,
        reviewed_at = now(),
        review_note = trim(p_review_note)
    where id = requested_subscription.id
    returning * into approved_subscription;
    return approved_subscription;
  end if;

  select * into current_subscription
  from public.account_subscriptions
  where website_user_id = requested_subscription.website_user_id
    and status = 'active'
    and expires_at > now()
  order by expires_at desc
  limit 1
  for update;

  if found then
    raise exception 'The account already has an active or scheduled subscription. This request cannot be approved until it expires.'
      using errcode = '22023';
  end if;

  subscription_start := now();

  update public.account_subscriptions
  set status = 'active',
      starts_at = subscription_start,
      expires_at = subscription_start + make_interval(days => requested_subscription.months * 30),
      paid_at = now(),
      reviewed_by = p_admin_id,
      reviewed_at = now(),
      review_note = null
  where id = requested_subscription.id
  returning * into approved_subscription;

  return approved_subscription;
end;
$review_subscription$;

revoke all on function public.update_unassigned_staff_role(bigint, text, text[], uuid)
  from public, anon, authenticated;
grant execute on function public.update_unassigned_staff_role(bigint, text, text[], uuid)
  to service_role;
revoke all on function public.staff_review_listing(uuid, bigint, boolean, text)
  from public, anon, authenticated;
grant execute on function public.staff_review_listing(uuid, bigint, boolean, text)
  to service_role;
revoke all on function public.staff_review_buy_request(uuid, bigint, boolean, text)
  from public, anon, authenticated;
grant execute on function public.staff_review_buy_request(uuid, bigint, boolean, text)
  to service_role;
revoke all on function public.staff_confirm_marketplace_order_delivery(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.staff_confirm_marketplace_order_delivery(uuid, uuid)
  to service_role;
revoke all on function public.claim_staff_task(bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_staff_task(bigint, text, text)
  to service_role;
revoke all on function public.review_website_subscription(uuid, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.review_website_subscription(uuid, uuid, boolean, text)
  to service_role;

notify pgrst, 'reload schema';
