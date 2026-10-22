create schema if not exists private;

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  months integer not null unique check (months between 1 and 120),
  price_tzs numeric(14, 2) not null check (price_tzs > 0),
  price_usd numeric(14, 2) not null check (price_usd > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.account_subscriptions (
  id uuid primary key default gen_random_uuid(),
  website_user_id uuid not null references public.website_accounts (id) on delete cascade,
  plan_id uuid references public.subscription_plans (id) on delete set null,
  months integer not null check (months between 1 and 120),
  currency text not null check (currency in ('TZS', 'USD')),
  amount numeric(14, 2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'active', 'expired', 'rejected')),
  requested_at timestamptz not null default now(),
  starts_at timestamptz,
  expires_at timestamptz,
  paid_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  check (
    (status = 'active' and starts_at is not null and expires_at is not null and paid_at is not null)
    or (status <> 'active')
  )
);

create index if not exists account_subscriptions_user_requested_idx
  on public.account_subscriptions (website_user_id, requested_at desc);
create unique index if not exists account_subscriptions_one_pending_per_user_idx
  on public.account_subscriptions (website_user_id) where status = 'pending';
drop index if exists public.account_subscriptions_one_active_per_user_idx;

alter table public.subscription_plans enable row level security;
alter table public.account_subscriptions enable row level security;
revoke all on public.subscription_plans, public.account_subscriptions from anon, authenticated;
drop policy if exists "Public can read active subscription plans" on public.subscription_plans;
create policy "Public can read active subscription plans" on public.subscription_plans for select to anon, authenticated
using (is_active = true);
grant select on public.subscription_plans to anon, authenticated;
grant all privileges on public.subscription_plans, public.account_subscriptions to service_role;

create or replace function private.is_website_account_active(p_website_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $is_account_active$
  select p_website_user_id is null or exists (
    select 1
    from public.website_accounts as account
    where account.id = p_website_user_id
      and account.is_active = true
      and exists (
        select 1
        from public.account_subscriptions as subscription
        where subscription.website_user_id = account.id
          and subscription.status = 'active'
          and subscription.starts_at <= now()
          and subscription.expires_at > now()
      )
  );
$is_account_active$;
revoke all on function private.is_website_account_active(uuid) from public, anon, authenticated;
grant usage on schema private to anon, authenticated;
grant execute on function private.is_website_account_active(uuid) to anon, authenticated;

drop policy if exists "Public can read approved listings" on public.listings;
create policy "Public can read approved listings" on public.listings for select to anon, authenticated
using (status = 'approved' and is_active = true and (select private.is_website_account_active(website_user_id)));

drop policy if exists "Public can read approved buy requests" on public.buy_requests;
create policy "Public can read approved buy requests" on public.buy_requests for select to anon, authenticated
using (status = 'approved' and is_active = true and (select private.is_website_account_active(website_user_id)));

create or replace view public.marketplace_listings
with (security_barrier = true)
as
select listing.id, listing.mineral_name, listing.weight, listing.unit, listing.price, listing.currency,
  listing.country, listing.region, listing.district, listing.image_path, listing.status, listing.created_at, listing.is_active,
  exists (
    select 1 from public.website_account_certificates as certificate
    where certificate.website_user_id = listing.website_user_id
      and certificate.status = 'approved'
  ) as verified_seller,
  listing.listing_type, listing.smallest_stone_weight, listing.largest_stone_weight, listing.stone_weight_unit,
  listing.seller_price, listing.platform_fee_rate, listing.platform_fee_amount
from public.listings as listing
where listing.status = 'approved' and listing.is_active = true
  and (listing.website_user_id is null or private.is_website_account_active(listing.website_user_id));

create or replace view public.marketplace_buy_requests
with (security_barrier = true)
as
select request.id, request.mineral_name, request.weight, request.unit, request.color,
  request.shape, request.quality, request.offer, request.currency, request.location,
  request.status, request.created_at, request.is_active
from public.buy_requests as request
where request.status = 'approved' and request.is_active = true
  and (request.website_user_id is null or private.is_website_account_active(request.website_user_id));

create or replace view public.market_listing_feed
with (security_barrier = true)
as
select listing.*,
  exists (
    select 1 from public.website_account_certificates as certificate
    where certificate.website_user_id = listing.website_user_id
      and certificate.status = 'approved'
  ) as verified_seller
from public.listings as listing
where listing.status = 'approved' and listing.is_active = true
  and (listing.website_user_id is null or private.is_website_account_active(listing.website_user_id));

grant select on public.marketplace_listings, public.marketplace_buy_requests, public.market_listing_feed to anon, authenticated;

create or replace function public.enforce_subscription_currency_setting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $enforce_subscription_currency$
declare
  usd_is_enabled boolean;
begin
  if new.currency = 'USD' then
    select settings.usd_enabled
      into usd_is_enabled
      from public.marketplace_settings as settings
      where settings.id = true;
    if not coalesce(usd_is_enabled, false) then
      raise exception 'USD currency is currently disabled by the marketplace administrator'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$enforce_subscription_currency$;
revoke all on function public.enforce_subscription_currency_setting() from public, anon, authenticated;
drop trigger if exists enforce_subscription_currency_setting on public.account_subscriptions;
create trigger enforce_subscription_currency_setting
before insert or update of currency on public.account_subscriptions
for each row execute function public.enforce_subscription_currency_setting();

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
  current_subscription public.account_subscriptions%rowtype;
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

  select * into current_subscription
  from public.account_subscriptions
  where website_user_id = p_website_user_id
    and status = 'active'
    and expires_at > now()
  order by expires_at desc
  limit 1;

  if found and current_subscription.plan_id is distinct from selected_plan.id then
    raise exception 'While your subscription is active, you can only renew your current plan' using errcode = '22023';
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

create or replace function public.review_website_subscription(
  p_subscription_id uuid,
  p_admin_id uuid,
  p_approved boolean
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
    set status = 'rejected', reviewed_by = p_admin_id, reviewed_at = now()
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

  subscription_start := greatest(now(), coalesce(current_subscription.expires_at, now()));

  update public.account_subscriptions
  set status = 'active',
      starts_at = subscription_start,
      expires_at = subscription_start + make_interval(days => requested_subscription.months * 30),
      paid_at = now(),
      reviewed_by = p_admin_id,
      reviewed_at = now()
  where id = requested_subscription.id
  returning * into approved_subscription;

  return approved_subscription;
end;
$review_subscription$;
revoke all on function public.review_website_subscription(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.review_website_subscription(uuid, uuid, boolean) to service_role;
