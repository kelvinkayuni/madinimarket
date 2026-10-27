alter table public.website_accounts
  add column if not exists delivery_country text,
  add column if not exists delivery_region text,
  add column if not exists delivery_district text,
  add column if not exists delivery_address text;

create table if not exists public.marketplace_cart_items (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.website_accounts (id) on delete cascade,
  listing_id bigint not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (buyer_id, listing_id)
);

create table if not exists public.marketplace_orders (
  id uuid primary key default gen_random_uuid(),
  control_number text not null unique,
  buyer_id uuid not null references public.website_accounts (id) on delete restrict,
  buyer_name text not null,
  buyer_email text not null,
  buyer_phone text not null,
  delivery_country text not null,
  delivery_region text not null,
  delivery_district text not null,
  delivery_address text not null,
  currency text not null check (currency in ('TZS', 'USD')),
  total_amount numeric(14, 2) not null check (total_amount > 0),
  payment_status text not null default 'awaiting_sellers'
    check (payment_status in ('awaiting_sellers', 'awaiting_payment', 'payment_submitted', 'paid', 'expired', 'cancelled')),
  seller_response_deadline timestamptz not null default (now() + interval '6 hours'),
  payment_deadline timestamptz,
  payment_reference text,
  payment_note text,
  payment_proof_path text,
  payment_submitted_at timestamptz,
  payment_verified_at timestamptz,
  payment_verified_by uuid references public.profiles (id) on delete set null,
  payment_ready_email_sent_at timestamptz,
  buyer_payment_verified_email_sent_at timestamptz,
  buyer_unavailable_email_sent_at timestamptz,
  buyer_expired_email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketplace_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.marketplace_orders (id) on delete restrict,
  listing_id bigint references public.listings (id) on delete set null,
  seller_id uuid references public.website_accounts (id) on delete set null,
  seller_email text not null,
  mineral_name text not null,
  listing_type text not null,
  weight numeric not null,
  unit text not null,
  image_path text,
  currency text not null check (currency in ('TZS', 'USD')),
  total_price numeric(14, 2) not null check (total_price > 0),
  seller_amount numeric(14, 2) not null check (seller_amount > 0),
  platform_fee_rate numeric(7, 6) not null default 0 check (platform_fee_rate between 0 and 1),
  platform_fee_amount numeric(14, 2) not null default 0 check (platform_fee_amount >= 0),
  status text not null default 'awaiting_seller'
    check (status in ('awaiting_seller', 'unavailable', 'awaiting_payment', 'payment_submitted', 'paid', 'shipped', 'delivered', 'payout_due', 'payout_paid', 'expired', 'cancelled')),
  seller_response_deadline timestamptz not null,
  seller_responded_at timestamptz,
  availability_email_sent_at timestamptz,
  availability_email_claimed_at timestamptz,
  dispatch_email_sent_at timestamptz,
  buyer_shipped_email_sent_at timestamptz,
  buyer_delivered_email_sent_at timestamptz,
  seller_receipt_email_sent_at timestamptz,
  payout_due_email_sent_at timestamptz,
  shipped_at timestamptz,
  shipping_carrier text,
  tracking_number text,
  delivered_at timestamptz,
  disputed_at timestamptz,
  dispute_reason text,
  dispute_resolved_at timestamptz,
  dispute_resolution text check (dispute_resolution in ('seller', 'buyer')),
  buyer_received_at timestamptz,
  payout_due_at timestamptz,
  payout_paid_at timestamptz,
  payout_reference text,
  refund_reference text,
  created_at timestamptz not null default now()
);

alter table public.marketplace_order_items
  add column if not exists availability_email_claimed_at timestamptz;

alter table public.marketplace_order_items drop constraint if exists marketplace_order_items_status_check;
alter table public.marketplace_order_items add constraint marketplace_order_items_status_check check (
  status in ('awaiting_seller', 'unavailable', 'awaiting_payment', 'payment_submitted', 'paid', 'shipped', 'delivered', 'disputed', 'payout_due', 'payout_paid', 'refund_due', 'refunded', 'expired', 'cancelled')
);

drop index if exists public.marketplace_order_items_one_active_reservation_idx;
create unique index marketplace_order_items_one_active_reservation_idx
  on public.marketplace_order_items (listing_id)
  where listing_id is not null and status in (
    'awaiting_seller', 'awaiting_payment', 'payment_submitted', 'paid', 'shipped', 'delivered', 'disputed', 'payout_due', 'refund_due'
  );
create index if not exists marketplace_cart_items_buyer_created_idx
  on public.marketplace_cart_items (buyer_id, created_at);
create index if not exists marketplace_orders_buyer_created_idx
  on public.marketplace_orders (buyer_id, created_at desc);
create index if not exists marketplace_order_items_seller_status_idx
  on public.marketplace_order_items (seller_id, status, created_at desc);
create index if not exists marketplace_orders_expiry_idx
  on public.marketplace_orders (payment_status, payment_deadline);

alter table public.marketplace_cart_items enable row level security;
alter table public.marketplace_orders enable row level security;
alter table public.marketplace_order_items enable row level security;
revoke all on public.marketplace_cart_items, public.marketplace_orders, public.marketplace_order_items from anon, authenticated;
grant all on public.marketplace_cart_items, public.marketplace_orders, public.marketplace_order_items to service_role;

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values (
  'marketplace-payment-proofs',
  'marketplace-payment-proofs',
  false,
  array['application/pdf', 'image/jpeg', 'image/png'],
  10485760
)
on conflict (id) do update set
  public = false,
  allowed_mime_types = excluded.allowed_mime_types,
  file_size_limit = excluded.file_size_limit;

create or replace function public.create_marketplace_order(
  p_buyer_id uuid,
  p_buyer_name text,
  p_buyer_email text,
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
as $create_marketplace_order$
declare
  cart_count integer;
  currency_count integer;
  selected_currency text;
  new_order public.marketplace_orders%rowtype;
  candidate_control text;
  attempt integer := 0;
begin
  if p_buyer_name is null or length(trim(p_buyer_name)) not between 1 and 120
    or p_buyer_email is null or length(trim(p_buyer_email)) > 254
    or p_buyer_phone is null or length(trim(p_buyer_phone)) not between 1 and 40
    or p_delivery_country is null or length(trim(p_delivery_country)) not between 1 and 100
    or p_delivery_region is null or length(trim(p_delivery_region)) not between 1 and 100
    or p_delivery_district is null or length(trim(p_delivery_district)) not between 1 and 100
    or p_delivery_address is null or length(trim(p_delivery_address)) not between 1 and 300 then
    raise exception 'Complete the buyer contact and delivery address.' using errcode = '22023';
  end if;
  if not private.is_market_open() then
    raise exception 'The marketplace is closed. Please confirm your cart when it reopens.' using errcode = '22023';
  end if;

  perform 1 from public.website_accounts
  where id = p_buyer_id and is_active = true
  for update;
  if not found then
    raise exception 'An active buyer account is required.' using errcode = '42501';
  end if;

  select count(*), count(distinct listing.currency), min(listing.currency)
    into cart_count, currency_count, selected_currency
  from public.marketplace_cart_items as cart
  join public.listings as listing on listing.id = cart.listing_id
  where cart.buyer_id = p_buyer_id;
  if cart_count = 0 then
    raise exception 'Your cart is empty.' using errcode = '22023';
  end if;
  if currency_count <> 1 then
    raise exception 'A cart can contain items in only one currency.' using errcode = '22023';
  end if;

  perform listing.id
  from public.marketplace_cart_items as cart
  join public.listings as listing on listing.id = cart.listing_id
  where cart.buyer_id = p_buyer_id
  order by listing.id
  for update of listing;

  if exists (
    select 1
    from public.marketplace_cart_items as cart
    join public.listings as listing on listing.id = cart.listing_id
    where cart.buyer_id = p_buyer_id
      and (listing.status <> 'approved' or listing.is_active <> true or listing.website_user_id is null
        or not private.is_website_account_active(listing.website_user_id))
  ) then
    raise exception 'A cart item is no longer available for purchase.' using errcode = '22023';
  end if;

  loop
    attempt := attempt + 1;
    candidate_control := 'MM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    begin
      insert into public.marketplace_orders (
        control_number, buyer_id, buyer_name, buyer_email, buyer_phone,
        delivery_country, delivery_region, delivery_district, delivery_address, currency, total_amount
      )
      select candidate_control, p_buyer_id, trim(p_buyer_name), lower(trim(p_buyer_email)), trim(p_buyer_phone),
        trim(p_delivery_country), trim(p_delivery_region), trim(p_delivery_district), trim(p_delivery_address),
        selected_currency, sum(listing.price)
      from public.marketplace_cart_items as cart
      join public.listings as listing on listing.id = cart.listing_id
      where cart.buyer_id = p_buyer_id
      returning * into new_order;
      exit;
    exception when unique_violation then
      if attempt >= 5 then raise; end if;
    end;
  end loop;

  insert into public.marketplace_order_items (
    order_id, listing_id, seller_id, seller_email, mineral_name, listing_type, weight, unit, image_path,
    currency, total_price, seller_amount, platform_fee_rate, platform_fee_amount, seller_response_deadline
  )
  select new_order.id, listing.id, listing.website_user_id, account.email, listing.mineral_name,
    listing.listing_type, listing.weight, listing.unit, listing.image_path, listing.currency,
    listing.price, listing.seller_price, listing.platform_fee_rate, listing.platform_fee_amount,
    new_order.seller_response_deadline
  from public.marketplace_cart_items as cart
  join public.listings as listing on listing.id = cart.listing_id
  join public.website_accounts as account on account.id = listing.website_user_id
  where cart.buyer_id = p_buyer_id;

  update public.listings as listing set is_active = false
  where listing.id in (
    select cart.listing_id from public.marketplace_cart_items as cart where cart.buyer_id = p_buyer_id
  );
  delete from public.marketplace_cart_items where buyer_id = p_buyer_id;
  update public.website_accounts set
    phone = trim(p_buyer_phone),
    delivery_country = trim(p_delivery_country),
    delivery_region = trim(p_delivery_region),
    delivery_district = trim(p_delivery_district),
    delivery_address = trim(p_delivery_address)
  where id = p_buyer_id;
  return new_order;
end;
$create_marketplace_order$;

revoke all on function public.create_marketplace_order(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_marketplace_order(uuid, text, text, text, text, text, text, text) to service_role;

create or replace function public.respond_to_marketplace_order_item(
  p_order_item_id uuid,
  p_seller_id uuid,
  p_available boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $respond_to_marketplace_order_item$
declare
  selected_order public.marketplace_orders%rowtype;
  updated_order public.marketplace_orders%rowtype;
  selected_item public.marketplace_order_items%rowtype;
  waiting_count integer;
  available_count integer;
begin
  select orders.* into selected_order
  from public.marketplace_orders as orders
  join public.marketplace_order_items as items on items.order_id = orders.id
  where items.id = p_order_item_id and items.seller_id = p_seller_id
  for update of orders;
  if not found then raise exception 'Order item not found.' using errcode = 'P0002'; end if;
  if selected_order.payment_status <> 'awaiting_sellers'
    or selected_order.seller_response_deadline <= now() then
    raise exception 'The seller response period has ended.' using errcode = '22023';
  end if;

  update public.marketplace_order_items
  set status = case when p_available then 'awaiting_payment' else 'unavailable' end,
      seller_responded_at = now()
  where id = p_order_item_id and status = 'awaiting_seller'
  returning * into selected_item;
  if not found then raise exception 'This item has already received a response.' using errcode = '22023'; end if;

  select count(*) filter (where status = 'awaiting_seller'),
      count(*) filter (where status = 'awaiting_payment')
    into waiting_count, available_count
  from public.marketplace_order_items where order_id = selected_order.id;
  if waiting_count = 0 then
    update public.marketplace_orders
    set payment_status = case when available_count > 0 then 'awaiting_payment' else 'cancelled' end,
        payment_deadline = case when available_count > 0 then now() + interval '2 hours' else null end,
        total_amount = case when available_count > 0 then (
          select sum(total_price) from public.marketplace_order_items
          where order_id = selected_order.id and status = 'awaiting_payment'
        ) else total_amount end,
        updated_at = now()
    where id = selected_order.id
    returning * into updated_order;
  else
    updated_order := selected_order;
  end if;
  return jsonb_build_object(
    'order_id', selected_order.id,
    'payment_status', updated_order.payment_status,
    'payment_deadline', updated_order.payment_deadline,
    'buyer_email', selected_order.buyer_email,
    'buyer_name', selected_order.buyer_name,
    'control_number', selected_order.control_number,
    'finalized', waiting_count = 0
  );
end;
$respond_to_marketplace_order_item$;

revoke all on function public.respond_to_marketplace_order_item(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.respond_to_marketplace_order_item(uuid, uuid, boolean) to service_role;

create or replace function public.submit_marketplace_order_payment(
  p_order_id uuid,
  p_buyer_id uuid,
  p_reference text,
  p_note text,
  p_proof_path text
)
returns public.marketplace_orders
language plpgsql
security definer
set search_path = ''
as $submit_marketplace_order_payment$
declare
  selected_order public.marketplace_orders%rowtype;
  updated_order public.marketplace_orders%rowtype;
  updated_items integer;
begin
  select * into selected_order
  from public.marketplace_orders
  where id = p_order_id and buyer_id = p_buyer_id
  for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if selected_order.payment_status <> 'awaiting_payment'
    or selected_order.payment_deadline is null
    or selected_order.payment_deadline <= now() then
    raise exception 'The payment window has closed or this order is no longer awaiting payment.' using errcode = '22023';
  end if;
  if p_reference is null or length(trim(p_reference)) not between 3 and 120 then
    raise exception 'Enter a valid payment reference.' using errcode = '22023';
  end if;
  if p_proof_path is null or length(trim(p_proof_path)) > 500 then
    raise exception 'Upload payment proof before submitting.' using errcode = '22023';
  end if;
  update public.marketplace_order_items
  set status = 'payment_submitted'
  where order_id = p_order_id and status = 'awaiting_payment';
  get diagnostics updated_items = row_count;
  if updated_items = 0 then raise exception 'This order has no payable items.' using errcode = '22023'; end if;
  update public.marketplace_orders
  set payment_status = 'payment_submitted',
      payment_reference = trim(p_reference),
      payment_note = nullif(trim(p_note), ''),
      payment_proof_path = trim(p_proof_path),
      payment_submitted_at = now(),
      updated_at = now()
  where id = p_order_id
  returning * into updated_order;
  return updated_order;
end;
$submit_marketplace_order_payment$;

revoke all on function public.submit_marketplace_order_payment(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_marketplace_order_payment(uuid, uuid, text, text, text) to service_role;

create or replace function public.verify_marketplace_order_payment(
  p_order_id uuid,
  p_admin_id uuid
)
returns public.marketplace_orders
language plpgsql
security definer
set search_path = ''
as $verify_marketplace_order_payment$
declare
  selected_order public.marketplace_orders%rowtype;
  updated_order public.marketplace_orders%rowtype;
  updated_items integer;
begin
  select * into selected_order
  from public.marketplace_orders
  where id = p_order_id
  for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if selected_order.payment_status <> 'payment_submitted' then
    raise exception 'This order is not waiting for payment verification.' using errcode = '22023';
  end if;
  update public.marketplace_order_items
  set status = 'paid'
  where order_id = p_order_id and status = 'payment_submitted';
  get diagnostics updated_items = row_count;
  if updated_items = 0 then raise exception 'This order has no submitted payment items.' using errcode = '22023'; end if;
  update public.marketplace_orders
  set payment_status = 'paid',
      payment_verified_at = now(),
      payment_verified_by = p_admin_id,
      updated_at = now()
  where id = p_order_id
  returning * into updated_order;
  return updated_order;
end;
$verify_marketplace_order_payment$;

revoke all on function public.verify_marketplace_order_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.verify_marketplace_order_payment(uuid, uuid) to service_role;

create or replace function public.process_marketplace_orders()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $process_marketplace_orders$
declare
  order_row record;
  expired_orders integer := 0;
  finalized_orders integer := 0;
  released_items integer := 0;
begin
  for order_row in
    select id from public.marketplace_orders
    where payment_status = 'awaiting_sellers' and seller_response_deadline <= now()
    for update
  loop
    update public.marketplace_order_items
    set status = 'unavailable', seller_responded_at = now()
    where order_id = order_row.id and status = 'awaiting_seller';

    if exists (select 1 from public.marketplace_order_items where order_id = order_row.id and status = 'awaiting_payment') then
      update public.marketplace_orders
      set payment_status = 'awaiting_payment',
          payment_deadline = now() + interval '2 hours',
          total_amount = (
            select sum(total_price) from public.marketplace_order_items
            where order_id = order_row.id and status = 'awaiting_payment'
          ),
          updated_at = now()
      where id = order_row.id;
      finalized_orders := finalized_orders + 1;
    else
      update public.marketplace_orders
      set payment_status = 'cancelled', updated_at = now()
      where id = order_row.id;
    end if;
  end loop;

  with expired as (
    update public.marketplace_orders
    set payment_status = 'expired', updated_at = now()
    where payment_status = 'awaiting_payment' and payment_deadline <= now()
    returning id
  )
  update public.marketplace_order_items
  set status = 'expired'
  where order_id in (select id from expired) and status = 'awaiting_payment';
  get diagnostics expired_orders = row_count;

  update public.marketplace_order_items
  set status = 'payout_due', payout_due_at = now()
  where status = 'delivered'
    and buyer_received_at is null
    and disputed_at is null
    and delivered_at <= now() - interval '7 days';
  get diagnostics released_items = row_count;

  return jsonb_build_object(
    'finalized_orders', finalized_orders,
    'expired_orders', expired_orders,
    'payout_due_items', released_items
  );
end;
$process_marketplace_orders$;

revoke all on function public.process_marketplace_orders() from public, anon, authenticated;
grant execute on function public.process_marketplace_orders() to service_role;

create or replace function private.hide_reserved_marketplace_listings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $hide_reserved_marketplace_listings$
begin
  if new.status in ('awaiting_seller', 'awaiting_payment', 'payment_submitted', 'paid', 'shipped', 'delivered', 'disputed', 'payout_due', 'refund_due') then
    update public.listings set is_active = false where id = new.listing_id;
  elsif new.status in ('unavailable', 'expired', 'cancelled') then
    update public.listings set is_active = true
    where id = new.listing_id and status = 'approved';
  end if;
  return new;
end;
$hide_reserved_marketplace_listings$;

revoke all on function private.hide_reserved_marketplace_listings() from public, anon, authenticated;
drop trigger if exists hide_reserved_marketplace_listings on public.marketplace_order_items;
create trigger hide_reserved_marketplace_listings
after insert or update of status on public.marketplace_order_items
for each row execute function private.hide_reserved_marketplace_listings();

notify pgrst, 'reload schema';
