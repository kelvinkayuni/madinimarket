create or replace function public.request_website_subscription(
  p_website_user_id uuid,
  p_plan_id uuid,
  p_currency text
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
  if p_currency not in ('TZS', 'USD') then
    raise exception 'Select a valid subscription currency' using errcode = '22023';
  end if;

  perform 1 from public.website_accounts
  where id = p_website_user_id and is_active = true
  for update;
  if not found then
    raise exception 'Active website account required' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.account_subscriptions
    where website_user_id = p_website_user_id and status = 'active' and expires_at > now()
  ) then
    raise exception 'Your subscription is active. You can choose another plan after it expires.' using errcode = '22023';
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

  insert into public.account_subscriptions (
    website_user_id, plan_id, months, currency, amount, status
  ) values (
    p_website_user_id, selected_plan.id, selected_plan.months, p_currency, selected_amount, 'pending'
  )
  returning id into new_subscription_id;

  return new_subscription_id;
end;
$request_subscription$;
revoke all on function public.request_website_subscription(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.request_website_subscription(uuid, uuid, text) to service_role;
