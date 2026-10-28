alter table public.account_subscriptions
  add column if not exists payment_reference text,
  add column if not exists payment_receipt_path text,
  add column if not exists review_note text;

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values (
  'account-subscription-payment-proofs',
  'account-subscription-payment-proofs',
  false,
  array['application/pdf', 'image/jpeg', 'image/png'],
  4194304
)
on conflict (id) do update set
  public = false,
  allowed_mime_types = excluded.allowed_mime_types,
  file_size_limit = excluded.file_size_limit;

drop function if exists public.request_website_subscription(uuid, uuid, text);

create or replace function public.request_website_subscription(
  p_website_user_id uuid,
  p_plan_id uuid,
  p_currency text,
  p_payment_reference text,
  p_payment_receipt_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $request_subscription$
declare
  selected_plan public.subscription_plans%rowtype;
  new_subscription_id uuid;
  selected_amount numeric(14, 2);
begin
  if p_currency is null or p_currency not in ('TZS', 'USD') then
    raise exception 'Select a valid subscription currency' using errcode = '22023';
  end if;

  if char_length(trim(coalesce(p_payment_reference, ''))) < 3
    or char_length(trim(p_payment_reference)) > 120 then
    raise exception 'Enter a payment reference between 3 and 120 characters' using errcode = '22023';
  end if;

  if coalesce(p_payment_receipt_path, '') !~ (
    '^' || p_website_user_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png)$'
  ) then
    raise exception 'Upload a valid payment receipt' using errcode = '22023';
  end if;

  perform 1 from public.website_accounts
  where id = p_website_user_id and is_active = true
  for update;
  if not found then
    raise exception 'Active website account required' using errcode = '42501';
  end if;

  select * into selected_plan
  from public.subscription_plans
  where id = p_plan_id and is_active = true;
  if not found then
    raise exception 'Subscription plan is no longer available' using errcode = '22023';
  end if;

  if p_currency = 'USD' then
    perform 1 from public.marketplace_settings
    where id = true and usd_enabled = true;
    if not found then
      raise exception 'USD currency is currently disabled' using errcode = '23514';
    end if;
    selected_amount := selected_plan.price_usd;
  else
    selected_amount := selected_plan.price_tzs;
  end if;

  if exists (
    select 1 from public.account_subscriptions
    where website_user_id = p_website_user_id and status = 'pending'
  ) then
    raise exception 'A subscription payment is already awaiting admin confirmation' using errcode = '23505';
  end if;

  if exists (
    select 1 from public.account_subscriptions
    where website_user_id = p_website_user_id
      and status = 'active'
      and expires_at > now()
  ) then
    raise exception 'Your subscription is active or already scheduled. You can choose a new plan after it expires.'
      using errcode = '22023';
  end if;

  insert into public.account_subscriptions (
    website_user_id, plan_id, months, currency, amount, status,
    payment_reference, payment_receipt_path
  ) values (
    p_website_user_id, selected_plan.id, selected_plan.months, p_currency, selected_amount, 'pending',
    trim(p_payment_reference), p_payment_receipt_path
  )
  returning id into new_subscription_id;

  return new_subscription_id;
end;
$request_subscription$;
revoke all on function public.request_website_subscription(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.request_website_subscription(uuid, uuid, text, text, text) to service_role;

drop function if exists public.review_website_subscription(uuid, uuid, boolean);

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
  if not exists (select 1 from public.profiles where id = p_admin_id and role = 'admin') then
    raise exception 'Admin access required' using errcode = '42501';
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
revoke all on function public.review_website_subscription(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.review_website_subscription(uuid, uuid, boolean, text) to service_role;
