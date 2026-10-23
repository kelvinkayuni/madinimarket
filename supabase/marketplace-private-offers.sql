begin;

create table if not exists public.marketplace_private_offer_threads (
  id uuid primary key default gen_random_uuid(),
  request_id bigint not null references public.buy_requests (id) on delete restrict,
  buyer_id uuid not null references public.website_accounts (id) on delete restrict,
  seller_id uuid not null references public.website_accounts (id) on delete restrict,
  state text not null default 'open'
    check (state in ('open', 'accepted', 'awaiting_buyer_checkout', 'ordered', 'closed')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, seller_id)
);

create table if not exists public.marketplace_private_offers (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.marketplace_private_offer_threads (id) on delete restrict,
  attempt_number smallint not null check (attempt_number between 1 and 3),
  mineral_name text not null,
  listing_type text not null check (listing_type in ('single', 'batch')),
  weight numeric not null check (weight > 0),
  unit text not null check (unit in ('carats', 'g', 'kg', 'tons')),
  smallest_stone_weight numeric,
  largest_stone_weight numeric,
  stone_weight_unit text check (stone_weight_unit in ('carats', 'g', 'kg')),
  color text not null,
  shape text not null check (shape in ('Cut', 'Uncut')),
  quality text not null,
  image_path text not null,
  country text not null,
  region text not null,
  district text not null,
  inventory_key text not null,
  seller_amount numeric(14, 2) not null check (seller_amount > 0),
  platform_fee_rate numeric(7, 6) not null check (platform_fee_rate between 0 and 1),
  platform_fee_amount numeric(14, 2) not null check (platform_fee_amount >= 0),
  total_price numeric(14, 2) not null check (total_price > 0),
  currency text not null check (currency in ('TZS', 'USD')),
  status text not null default 'pending'
    check (status in ('pending', 'declined', 'accepted', 'awaiting_buyer_checkout', 'ordered', 'closed')),
  created_at timestamptz not null default now(),
  unique (thread_id, attempt_number),
  check (
    (listing_type = 'single' and smallest_stone_weight is null and largest_stone_weight is null and stone_weight_unit is null)
    or (
      listing_type = 'batch'
      and smallest_stone_weight > 0
      and largest_stone_weight >= smallest_stone_weight
      and stone_weight_unit is not null
      and largest_stone_weight * case stone_weight_unit when 'carats' then 0.2 when 'kg' then 1000 else 1 end
        <= weight * case unit when 'carats' then 0.2 when 'kg' then 1000 when 'tons' then 1000000 else 1 end
    )
  ),
  check (total_price = seller_amount + platform_fee_amount)
);

create index if not exists marketplace_private_offer_threads_buyer_state_idx
  on public.marketplace_private_offer_threads (buyer_id, state, updated_at desc);
create index if not exists marketplace_private_offer_threads_seller_state_idx
  on public.marketplace_private_offer_threads (seller_id, state, updated_at desc);
create index if not exists marketplace_private_offers_thread_created_idx
  on public.marketplace_private_offers (thread_id, created_at desc);

alter table public.marketplace_order_items
  add column if not exists private_offer_id uuid references public.marketplace_private_offers (id) on delete set null,
  add column if not exists mineral_color text,
  add column if not exists mineral_shape text,
  add column if not exists mineral_quality text,
  add column if not exists mineral_country text,
  add column if not exists mineral_region text,
  add column if not exists mineral_district text,
  add column if not exists private_inventory_key text;

create unique index if not exists marketplace_order_items_private_offer_id_idx
  on public.marketplace_order_items (private_offer_id)
  where private_offer_id is not null;
create unique index if not exists marketplace_order_items_private_inventory_reservation_idx
  on public.marketplace_order_items (seller_id, private_inventory_key)
  where private_inventory_key is not null and status in (
    'awaiting_seller', 'awaiting_payment', 'payment_submitted', 'paid', 'shipped',
    'delivered', 'disputed', 'payout_due', 'payout_paid', 'refund_due'
  );

create or replace function private.marketplace_private_offer_inventory_key(
  p_seller_id uuid,
  p_mineral_name text,
  p_listing_type text,
  p_weight numeric,
  p_unit text,
  p_smallest_stone_weight numeric,
  p_largest_stone_weight numeric,
  p_stone_weight_unit text,
  p_color text,
  p_shape text,
  p_quality text,
  p_country text,
  p_region text,
  p_district text
)
returns text
language sql
immutable
set search_path = ''
as $private_offer_inventory_key$
  select encode(extensions.digest(convert_to(concat_ws(chr(31),
    p_seller_id::text,
    lower(trim(p_mineral_name)),
    p_listing_type,
    trim_scale(p_weight)::text,
    p_unit,
    coalesce(trim_scale(p_smallest_stone_weight)::text, ''),
    coalesce(trim_scale(p_largest_stone_weight)::text, ''),
    coalesce(p_stone_weight_unit, ''),
    lower(trim(p_color)),
    p_shape,
    lower(trim(p_quality)),
    lower(trim(p_country)),
    lower(trim(p_region)),
    lower(trim(p_district))
  ), 'UTF8'), 'sha256'), 'hex');
$private_offer_inventory_key$;
revoke all on function private.marketplace_private_offer_inventory_key(uuid, text, text, numeric, text, numeric, numeric, text, text, text, text, text, text, text) from public, anon, authenticated;

alter table public.marketplace_private_offer_threads enable row level security;
alter table public.marketplace_private_offers enable row level security;
revoke all on public.marketplace_private_offer_threads, public.marketplace_private_offers from anon, authenticated;
grant all on public.marketplace_private_offer_threads, public.marketplace_private_offers to service_role;

create or replace view public.marketplace_buy_requests
with (security_barrier = true)
as
select request.id, request.mineral_name, request.weight, request.unit, request.color,
  request.shape, request.quality, request.offer, request.currency, request.location,
  request.status, request.created_at, request.is_active,
  (request.website_user_id is not null) as offer_enabled
from public.buy_requests as request
where private.is_market_open()
  and request.status = 'approved'
  and request.is_active = true
  and (request.website_user_id is null or private.is_website_account_active(request.website_user_id));

grant select on public.marketplace_buy_requests to anon, authenticated;

drop function if exists public.send_marketplace_private_offer(uuid, bigint, uuid, text, text, numeric, text, numeric, numeric, text, text, text, text, text, text, text, numeric, text);
create or replace function public.send_marketplace_private_offer(
  p_seller_id uuid,
  p_request_id bigint,
  p_thread_id uuid,
  p_mineral_name text,
  p_listing_type text,
  p_weight numeric,
  p_unit text,
  p_smallest_stone_weight numeric,
  p_largest_stone_weight numeric,
  p_stone_weight_unit text,
  p_color text,
  p_shape text,
  p_quality text,
  p_image_path text,
  p_country text,
  p_region text,
  p_district text,
  p_seller_amount numeric,
  p_currency text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $send_marketplace_private_offer$
declare
  request_row public.buy_requests%rowtype;
  selected_thread public.marketplace_private_offer_threads%rowtype;
  fee_rate numeric(7, 6);
  rounded_seller_amount numeric(14, 2);
  fee_amount numeric(14, 2);
  buyer_total numeric(14, 2);
  new_offer_id uuid;
  item_inventory_key text;
begin
  if p_mineral_name is null or length(trim(p_mineral_name)) not between 1 and 120
    or p_listing_type not in ('single', 'batch')
    or p_weight is null or p_weight <= 0
    or p_unit not in ('carats', 'g', 'kg', 'tons')
    or p_color is null or length(trim(p_color)) not between 1 and 100
    or p_shape not in ('Cut', 'Uncut')
    or p_quality is null or length(trim(p_quality)) not between 1 and 200
    or p_image_path is null or length(p_image_path) > 500
    or p_country is null or length(trim(p_country)) not between 1 and 100
    or p_region is null or length(trim(p_region)) not between 1 and 100
    or p_district is null or length(trim(p_district)) not between 1 and 100
    or p_seller_amount is null or p_seller_amount <= 0
    or p_currency not in ('TZS', 'USD')
    or (p_listing_type = 'single' and (p_smallest_stone_weight is not null or p_largest_stone_weight is not null or p_stone_weight_unit is not null))
    or (p_listing_type = 'batch' and (
      p_smallest_stone_weight is null or p_smallest_stone_weight <= 0
      or p_largest_stone_weight is null or p_largest_stone_weight < p_smallest_stone_weight
      or p_stone_weight_unit not in ('carats', 'g', 'kg')
      or p_largest_stone_weight * case p_stone_weight_unit when 'carats' then 0.2 when 'kg' then 1000 else 1 end
        > p_weight * case p_unit when 'carats' then 0.2 when 'kg' then 1000 when 'tons' then 1000000 else 1 end
    )) then
    raise exception 'Check all private mineral offer details and try again.' using errcode = '22023';
  end if;
  if not private.is_market_open() then
    raise exception 'The marketplace is closed. Please send offers when it reopens.' using errcode = '22023';
  end if;

  perform 1 from public.website_accounts
  where id = p_seller_id and is_active = true
  for update;
  if not found then raise exception 'An active seller account is required.' using errcode = '42501'; end if;

  if not exists (
    select 1 from public.account_subscriptions as subscription
    where subscription.website_user_id = p_seller_id
      and subscription.status = 'active'
      and subscription.starts_at <= now()
      and subscription.expires_at > now()
  ) then
    raise exception 'An active seller subscription is required to send a private offer.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.website_account_certificates as certificate
    where certificate.website_user_id = p_seller_id and certificate.status = 'approved'
  ) then
    raise exception 'An approved dealer or broker licence is required to send a private mineral offer.' using errcode = '42501';
  end if;
  if split_part(p_image_path, '/', 1) <> p_seller_id::text then
    raise exception 'The mineral photo must belong to your seller account.' using errcode = '42501';
  end if;

  select * into request_row
  from public.buy_requests
  where id = p_request_id
    and status = 'approved'
    and is_active = true
    and website_user_id is not null
  for update;
  if not found then raise exception 'This buyer request is no longer accepting offers.' using errcode = '22023'; end if;
  if request_row.website_user_id = p_seller_id then
    raise exception 'You cannot send an offer to your own buying request.' using errcode = '42501';
  end if;
  if not private.is_website_account_active(request_row.website_user_id) then
    raise exception 'This buyer request is no longer eligible for offers.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.marketplace_order_items as order_item
    join public.marketplace_private_offers as existing_offer on existing_offer.id = order_item.private_offer_id
    join public.marketplace_private_offer_threads as existing_thread on existing_thread.id = existing_offer.thread_id
    where existing_thread.request_id = p_request_id
      and order_item.status in ('awaiting_seller', 'awaiting_payment', 'payment_submitted', 'paid', 'shipped', 'delivered', 'disputed', 'payout_due', 'payout_paid', 'refund_due')
  ) then
    raise exception 'This buyer request already has an active or completed order.' using errcode = '22023';
  end if;
  item_inventory_key := private.marketplace_private_offer_inventory_key(
    p_seller_id, p_mineral_name, p_listing_type, p_weight, p_unit,
    p_smallest_stone_weight, p_largest_stone_weight, p_stone_weight_unit,
    p_color, p_shape, p_quality, p_country, p_region, p_district
  );
  if exists (
    select 1 from public.marketplace_order_items
    where seller_id = p_seller_id
      and private_inventory_key = item_inventory_key
      and status in ('awaiting_seller', 'awaiting_payment', 'payment_submitted', 'paid', 'shipped', 'delivered', 'disputed', 'payout_due', 'payout_paid', 'refund_due')
  ) then
    raise exception 'This mineral is already reserved by an active order.' using errcode = '22023';
  end if;

  if p_thread_id is null then
    insert into public.marketplace_private_offer_threads (request_id, buyer_id, seller_id)
    values (request_row.id, request_row.website_user_id, p_seller_id)
    on conflict (request_id, seller_id) do nothing;
    select * into selected_thread
    from public.marketplace_private_offer_threads
    where request_id = p_request_id and seller_id = p_seller_id
    for update;
  else
    select * into selected_thread
    from public.marketplace_private_offer_threads
    where id = p_thread_id and request_id = p_request_id and seller_id = p_seller_id
    for update;
    if not found then raise exception 'Private offer thread not found.' using errcode = 'P0002'; end if;
  end if;

  if selected_thread.buyer_id <> request_row.website_user_id then
    raise exception 'This offer thread does not match the buyer request.' using errcode = '22023';
  end if;
  if selected_thread.state <> 'open' then
    raise exception 'This offer thread is no longer accepting offers.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.marketplace_private_offers
    where thread_id = selected_thread.id and status <> 'declined'
  ) then
    raise exception 'Wait for the buyer to decline the current offer before sending another.' using errcode = '22023';
  end if;
  if selected_thread.attempt_count >= 3 then
    update public.marketplace_private_offer_threads set state = 'closed' where id = selected_thread.id;
    raise exception 'You have used all three offers for this buyer request.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.marketplace_settings as settings
    where settings.id = true
      and (p_currency <> 'USD' or settings.usd_enabled = true)
  ) then
    raise exception 'This offer currency is currently disabled.' using errcode = '22023';
  end if;
  select settings.listing_fee_rate into fee_rate
  from public.marketplace_settings as settings
  where settings.id = true;
  if fee_rate is null then raise exception 'Marketplace fee settings are unavailable.' using errcode = '55000'; end if;

  rounded_seller_amount := case when p_currency = 'TZS' then round(p_seller_amount) else round(p_seller_amount, 2) end;
  fee_amount := case when p_currency = 'TZS' then round(rounded_seller_amount * fee_rate) else round(rounded_seller_amount * fee_rate, 2) end;
  buyer_total := rounded_seller_amount + fee_amount;

  update public.marketplace_private_offer_threads
  set attempt_count = attempt_count + 1, updated_at = now()
  where id = selected_thread.id
  returning * into selected_thread;

  insert into public.marketplace_private_offers (
    thread_id, attempt_number, mineral_name, listing_type, weight, unit,
    smallest_stone_weight, largest_stone_weight, stone_weight_unit, color, shape, quality, image_path,
    country, region, district, inventory_key, seller_amount, platform_fee_rate, platform_fee_amount, total_price, currency
  ) values (
    selected_thread.id, selected_thread.attempt_count, trim(p_mineral_name), p_listing_type, p_weight, p_unit,
    p_smallest_stone_weight, p_largest_stone_weight, p_stone_weight_unit, trim(p_color), p_shape, trim(p_quality),
    p_image_path, trim(p_country), trim(p_region), trim(p_district), item_inventory_key, rounded_seller_amount, fee_rate, fee_amount, buyer_total, p_currency
  )
  returning id into new_offer_id;
  return new_offer_id;
end;
$send_marketplace_private_offer$;

create or replace function public.decide_marketplace_private_offer(
  p_buyer_id uuid,
  p_offer_id uuid,
  p_agree boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $decide_marketplace_private_offer$
declare
  selected_offer public.marketplace_private_offers%rowtype;
  selected_thread public.marketplace_private_offer_threads%rowtype;
  next_state text;
begin
  select offers.* into selected_offer
  from public.marketplace_private_offers as offers
  join public.marketplace_private_offer_threads as threads on threads.id = offers.thread_id
  where offers.id = p_offer_id and threads.buyer_id = p_buyer_id
  for update of offers;
  if not found then raise exception 'Private offer not found.' using errcode = 'P0002'; end if;
  select * into selected_thread from public.marketplace_private_offer_threads
  where id = selected_offer.thread_id for update;
  if selected_offer.status <> 'pending' or selected_thread.state <> 'open' then
    raise exception 'This offer has already been answered.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.website_accounts where id = p_buyer_id and is_active = true) then
    raise exception 'An active buyer account is required.' using errcode = '42501';
  end if;

  if p_agree then
    update public.marketplace_private_offers set status = 'accepted' where id = p_offer_id;
    update public.marketplace_private_offer_threads
    set state = 'accepted', updated_at = now()
    where id = selected_thread.id;
    next_state := 'accepted';
  else
    update public.marketplace_private_offers set status = 'declined' where id = p_offer_id;
    next_state := case when selected_thread.attempt_count >= 3 then 'closed' else 'open' end;
    update public.marketplace_private_offer_threads
    set state = next_state, updated_at = now()
    where id = selected_thread.id;
  end if;
  return jsonb_build_object('thread_state', next_state, 'attempt_count', selected_thread.attempt_count);
end;
$decide_marketplace_private_offer$;

drop function if exists public.confirm_marketplace_private_offer(uuid, uuid);
create or replace function public.confirm_marketplace_private_offer(
  p_seller_id uuid,
  p_offer_id uuid,
  p_mineral_name text,
  p_listing_type text,
  p_weight numeric,
  p_unit text,
  p_smallest_stone_weight numeric,
  p_largest_stone_weight numeric,
  p_stone_weight_unit text,
  p_color text,
  p_shape text,
  p_quality text,
  p_country text,
  p_region text,
  p_district text
)
returns void
language plpgsql
security definer
set search_path = ''
as $confirm_marketplace_private_offer$
declare
  selected_offer public.marketplace_private_offers%rowtype;
  selected_thread public.marketplace_private_offer_threads%rowtype;
  item_inventory_key text;
begin
  if p_mineral_name is null or length(trim(p_mineral_name)) not between 1 and 120
    or p_listing_type not in ('single', 'batch')
    or p_weight is null or p_weight <= 0
    or p_unit not in ('carats', 'g', 'kg', 'tons')
    or p_color is null or length(trim(p_color)) not between 1 and 100
    or p_shape not in ('Cut', 'Uncut')
    or p_quality is null or length(trim(p_quality)) not between 1 and 200
    or p_country is null or length(trim(p_country)) not between 1 and 100
    or p_region is null or length(trim(p_region)) not between 1 and 100
    or p_district is null or length(trim(p_district)) not between 1 and 100
    or (p_listing_type = 'single' and (p_smallest_stone_weight is not null or p_largest_stone_weight is not null or p_stone_weight_unit is not null))
    or (p_listing_type = 'batch' and (
      p_smallest_stone_weight is null or p_smallest_stone_weight <= 0
      or p_largest_stone_weight is null or p_largest_stone_weight < p_smallest_stone_weight
      or p_stone_weight_unit not in ('carats', 'g', 'kg')
      or p_largest_stone_weight * case p_stone_weight_unit when 'carats' then 0.2 when 'kg' then 1000 else 1 end
        > p_weight * case p_unit when 'carats' then 0.2 when 'kg' then 1000 when 'tons' then 1000000 else 1 end
    )) then
    raise exception 'Check all final mineral details and try again.' using errcode = '22023';
  end if;
  select offers.* into selected_offer
  from public.marketplace_private_offers as offers
  join public.marketplace_private_offer_threads as threads on threads.id = offers.thread_id
  where offers.id = p_offer_id and threads.seller_id = p_seller_id
  for update of offers;
  if not found then raise exception 'Private offer not found.' using errcode = 'P0002'; end if;
  select * into selected_thread from public.marketplace_private_offer_threads
  where id = selected_offer.thread_id for update;
  if selected_offer.status <> 'accepted' or selected_thread.state <> 'accepted' then
    raise exception 'This offer is not waiting for seller confirmation.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.website_accounts where id = p_seller_id and is_active = true) then
    raise exception 'An active seller account is required.' using errcode = '42501';
  end if;
  item_inventory_key := private.marketplace_private_offer_inventory_key(
    p_seller_id, p_mineral_name, p_listing_type, p_weight, p_unit,
    p_smallest_stone_weight, p_largest_stone_weight, p_stone_weight_unit,
    p_color, p_shape, p_quality, p_country, p_region, p_district
  );
  if exists (
    select 1 from public.marketplace_order_items
    where seller_id = p_seller_id
      and private_inventory_key = item_inventory_key
      and status in ('awaiting_seller', 'awaiting_payment', 'payment_submitted', 'paid', 'shipped', 'delivered', 'disputed', 'payout_due', 'payout_paid', 'refund_due')
  ) then
    raise exception 'This mineral is already reserved by an active order.' using errcode = '22023';
  end if;
  update public.marketplace_private_offers set
    mineral_name = trim(p_mineral_name),
    listing_type = p_listing_type,
    weight = p_weight,
    unit = p_unit,
    smallest_stone_weight = p_smallest_stone_weight,
    largest_stone_weight = p_largest_stone_weight,
    stone_weight_unit = p_stone_weight_unit,
    color = trim(p_color),
    shape = p_shape,
    quality = trim(p_quality),
    country = trim(p_country),
    region = trim(p_region),
    district = trim(p_district),
    inventory_key = item_inventory_key,
    status = 'awaiting_buyer_checkout'
  where id = p_offer_id;
  update public.marketplace_private_offer_threads
  set state = 'awaiting_buyer_checkout', updated_at = now()
  where id = selected_thread.id;
end;
$confirm_marketplace_private_offer$;

create or replace function public.create_marketplace_private_offer_order(
  p_buyer_id uuid,
  p_offer_id uuid,
  p_buyer_name text,
  p_buyer_phone text,
  p_delivery_country text,
  p_delivery_region text,
  p_delivery_district text,
  p_delivery_address text
)
returns public.marketplace_orders
language plpgsql
security definer
set search_path = ''
as $create_marketplace_private_offer_order$
declare
  selected_offer public.marketplace_private_offers%rowtype;
  selected_thread public.marketplace_private_offer_threads%rowtype;
  buyer public.website_accounts%rowtype;
  seller public.website_accounts%rowtype;
  new_order public.marketplace_orders%rowtype;
  candidate_control text;
  attempt integer := 0;
begin
  if p_buyer_name is null or length(trim(p_buyer_name)) not between 1 and 120
    or p_buyer_phone is null or length(trim(p_buyer_phone)) not between 1 and 40
    or p_delivery_country is null or length(trim(p_delivery_country)) not between 1 and 100
    or p_delivery_region is null or length(trim(p_delivery_region)) not between 1 and 100
    or p_delivery_district is null or length(trim(p_delivery_district)) not between 1 and 100
    or p_delivery_address is null or length(trim(p_delivery_address)) not between 1 and 300 then
    raise exception 'Complete your contact and delivery address.' using errcode = '22023';
  end if;
  if not private.is_market_open() then raise exception 'The marketplace is closed.' using errcode = '22023'; end if;

  select offers.* into selected_offer
  from public.marketplace_private_offers as offers
  join public.marketplace_private_offer_threads as threads on threads.id = offers.thread_id
  where offers.id = p_offer_id and threads.buyer_id = p_buyer_id;
  if not found then raise exception 'Private offer not found.' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(selected_offer.inventory_key, 0));
  select * into selected_thread from public.marketplace_private_offer_threads
  where id = selected_offer.thread_id and buyer_id = p_buyer_id;
  if not found then raise exception 'Private offer not found.' using errcode = 'P0002'; end if;
  perform 1 from public.buy_requests where id = selected_thread.request_id for update;
  select * into selected_offer from public.marketplace_private_offers
  where id = p_offer_id for update;
  if not found then raise exception 'Private offer not found.' using errcode = 'P0002'; end if;
  select * into selected_thread from public.marketplace_private_offer_threads
  where id = selected_offer.thread_id and buyer_id = p_buyer_id for update;
  if not found or selected_offer.status <> 'awaiting_buyer_checkout'
    or selected_thread.state <> 'awaiting_buyer_checkout' then
    raise exception 'This private offer is not ready for checkout.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.marketplace_order_items as order_item
    join public.marketplace_private_offers as existing_offer on existing_offer.id = order_item.private_offer_id
    join public.marketplace_private_offer_threads as existing_thread on existing_thread.id = existing_offer.thread_id
    where existing_thread.request_id = selected_thread.request_id
      and order_item.status in ('awaiting_seller', 'awaiting_payment', 'payment_submitted', 'paid', 'shipped', 'delivered', 'disputed', 'payout_due', 'payout_paid', 'refund_due')
  ) then
    raise exception 'This buyer request already has an active or completed order.' using errcode = '22023';
  end if;
  select * into buyer from public.website_accounts where id = p_buyer_id and is_active = true for update;
  if not found then raise exception 'An active buyer account is required.' using errcode = '42501'; end if;
  select * into seller from public.website_accounts where id = selected_thread.seller_id and is_active = true;
  if not found then raise exception 'The seller account is no longer active.' using errcode = '22023'; end if;

  loop
    attempt := attempt + 1;
    candidate_control := 'MM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    begin
      insert into public.marketplace_orders (
        control_number, buyer_id, buyer_name, buyer_email, buyer_phone,
        delivery_country, delivery_region, delivery_district, delivery_address,
        currency, total_amount
      ) values (
        candidate_control, p_buyer_id, trim(p_buyer_name), lower(trim(buyer.email)), trim(p_buyer_phone),
        trim(p_delivery_country), trim(p_delivery_region), trim(p_delivery_district), trim(p_delivery_address),
        selected_offer.currency, selected_offer.total_price
      )
      returning * into new_order;
      exit;
    exception when unique_violation then
      if attempt >= 5 then raise; end if;
    end;
  end loop;

  begin
    insert into public.marketplace_order_items (
      order_id, listing_id, seller_id, seller_email, mineral_name, listing_type, weight, unit,
      image_path, currency, total_price, seller_amount, platform_fee_rate, platform_fee_amount, seller_response_deadline,
      private_offer_id, mineral_color, mineral_shape, mineral_quality, mineral_country, mineral_region, mineral_district,
      private_inventory_key
    ) values (
      new_order.id, null, seller.id, seller.email, selected_offer.mineral_name, selected_offer.listing_type,
      selected_offer.weight, selected_offer.unit, selected_offer.image_path, selected_offer.currency, selected_offer.total_price,
      selected_offer.seller_amount, selected_offer.platform_fee_rate, selected_offer.platform_fee_amount,
      new_order.seller_response_deadline, selected_offer.id, selected_offer.color, selected_offer.shape,
      selected_offer.quality, selected_offer.country, selected_offer.region, selected_offer.district,
      selected_offer.inventory_key
    );
  exception when unique_violation then
    raise exception 'This mineral is already reserved by another active order.' using errcode = '23505';
  end;
  update public.marketplace_private_offers
  set status = 'closed'
  where thread_id in (
    select competing_thread.id
    from public.marketplace_private_offer_threads as competing_thread
    where competing_thread.id <> selected_thread.id
      and competing_thread.state in ('open', 'accepted', 'awaiting_buyer_checkout')
      and (
        competing_thread.request_id = selected_thread.request_id
        or (
          competing_thread.seller_id = selected_thread.seller_id
          and exists (
            select 1 from public.marketplace_private_offers as same_mineral
            where same_mineral.thread_id = competing_thread.id
              and same_mineral.inventory_key = selected_offer.inventory_key
          )
        )
      )
  )
    and status in ('pending', 'accepted', 'awaiting_buyer_checkout');
  update public.marketplace_private_offer_threads as competing_thread
  set state = 'closed', updated_at = now()
  where competing_thread.id <> selected_thread.id
    and competing_thread.state in ('open', 'accepted', 'awaiting_buyer_checkout')
    and (
      competing_thread.request_id = selected_thread.request_id
      or (
        competing_thread.seller_id = selected_thread.seller_id
        and exists (
          select 1 from public.marketplace_private_offers as same_mineral
          where same_mineral.thread_id = competing_thread.id
            and same_mineral.inventory_key = selected_offer.inventory_key
        )
      )
    );
  update public.marketplace_private_offers set status = 'ordered' where id = selected_offer.id;
  update public.marketplace_private_offer_threads
  set state = 'ordered', updated_at = now()
  where id = selected_thread.id;
  update public.website_accounts set
    phone = trim(p_buyer_phone),
    delivery_country = trim(p_delivery_country),
    delivery_region = trim(p_delivery_region),
    delivery_district = trim(p_delivery_district),
    delivery_address = trim(p_delivery_address)
  where id = p_buyer_id;
  return new_order;
end;
$create_marketplace_private_offer_order$;

revoke all on function public.send_marketplace_private_offer(uuid, bigint, uuid, text, text, numeric, text, numeric, numeric, text, text, text, text, text, text, text, text, numeric, text) from public, anon, authenticated;
revoke all on function public.decide_marketplace_private_offer(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.confirm_marketplace_private_offer(uuid, uuid, text, text, numeric, text, numeric, numeric, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.create_marketplace_private_offer_order(uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.send_marketplace_private_offer(uuid, bigint, uuid, text, text, numeric, text, numeric, numeric, text, text, text, text, text, text, text, text, numeric, text) to service_role;
grant execute on function public.decide_marketplace_private_offer(uuid, uuid, boolean) to service_role;
grant execute on function public.confirm_marketplace_private_offer(uuid, uuid, text, text, numeric, text, numeric, numeric, text, text, text, text, text, text, text) to service_role;
grant execute on function public.create_marketplace_private_offer_order(uuid, uuid, text, text, text, text, text, text) to service_role;

notify pgrst, 'reload schema';

commit;
