alter table public.listings
  add column if not exists marketplace_state text not null default 'available';

alter table public.listings drop constraint if exists listings_marketplace_state_check;
alter table public.listings add constraint listings_marketplace_state_check
  check (marketplace_state in ('available', 'reserved', 'seller_unavailable', 'sold'));

alter table public.marketplace_order_items
  add column if not exists availability_expired_at timestamptz,
  add column if not exists seller_availability_timeout_email_sent_at timestamptz;

create table if not exists private.marketplace_listing_reservation_backfill (
  id boolean primary key default true check (id),
  applied_at timestamptz not null default now()
);

do $backfill_marketplace_listing_states$
begin
  if not exists (select 1 from private.marketplace_listing_reservation_backfill where id = true) then
    with latest_items as (
      select distinct on (listing_id) listing_id, status
      from public.marketplace_order_items
      where listing_id is not null
      order by listing_id, created_at desc
    )
    update public.listings as listing
    set marketplace_state = case
          when latest.status in ('awaiting_seller', 'awaiting_payment', 'payment_submitted', 'paid', 'shipped', 'delivered', 'disputed', 'payout_due', 'refund_due') then 'reserved'
          when latest.status = 'unavailable' then 'seller_unavailable'
          when latest.status = 'payout_paid' then 'sold'
          when latest.status = 'refunded' then 'seller_unavailable'
          else listing.marketplace_state
        end,
        is_active = case
          when latest.status in ('awaiting_seller', 'awaiting_payment', 'payment_submitted', 'paid', 'shipped', 'delivered', 'disputed', 'payout_due', 'refund_due') then true
          when latest.status in ('unavailable', 'payout_paid', 'refunded') then false
          else listing.is_active
        end
    from latest_items as latest
    where listing.id = latest.listing_id;

    insert into private.marketplace_listing_reservation_backfill (id) values (true);
  end if;
end;
$backfill_marketplace_listing_states$;

create or replace view public.marketplace_listing_reservations
with (security_barrier = true)
as
select item.listing_id,
  case
    when bool_or(item.status = 'awaiting_seller') then 'availability_pending'
    else 'reserved'
  end as reservation_status
from public.marketplace_order_items as item
join public.listings as listing on listing.id = item.listing_id
where item.listing_id is not null
  and item.status in (
    'awaiting_seller', 'awaiting_payment', 'payment_submitted', 'paid',
    'shipped', 'delivered', 'disputed', 'payout_due', 'refund_due'
  )
  and listing.status = 'approved'
  and listing.is_active = true
  and private.is_market_open()
  and (listing.website_user_id is null or private.is_website_account_active(listing.website_user_id))
group by item.listing_id;

grant select on public.marketplace_listing_reservations to anon, authenticated;

create or replace function private.reserve_marketplace_listing_before_order_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $reserve_marketplace_listing_before_order_item$
begin
  if new.listing_id is not null and new.status = 'awaiting_seller' then
    update public.listings
    set marketplace_state = 'reserved', is_active = true
    where id = new.listing_id
      and status = 'approved'
      and is_active = true
      and marketplace_state = 'available';
    if not found then
      raise exception 'This mineral is already reserved or is no longer available.'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$reserve_marketplace_listing_before_order_item$;

revoke all on function private.reserve_marketplace_listing_before_order_item() from public, anon, authenticated;
drop trigger if exists reserve_marketplace_listing_before_order_item on public.marketplace_order_items;
create trigger reserve_marketplace_listing_before_order_item
before insert on public.marketplace_order_items
for each row execute function private.reserve_marketplace_listing_before_order_item();

create or replace function private.keep_reserved_marketplace_listings_visible()
returns trigger
language plpgsql
security definer
set search_path = ''
as $keep_reserved_marketplace_listings_visible$
begin
  if new.marketplace_state = 'reserved' then
    new.is_active := true;
  end if;
  return new;
end;
$keep_reserved_marketplace_listings_visible$;

revoke all on function private.keep_reserved_marketplace_listings_visible() from public, anon, authenticated;
drop trigger if exists keep_reserved_marketplace_listings_visible on public.listings;
create trigger keep_reserved_marketplace_listings_visible
before update of is_active, marketplace_state on public.listings
for each row execute function private.keep_reserved_marketplace_listings_visible();

create or replace function private.hide_reserved_marketplace_listings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $hide_reserved_marketplace_listings$
begin
  if new.status in ('awaiting_seller', 'awaiting_payment', 'payment_submitted', 'paid', 'shipped', 'delivered', 'disputed', 'payout_due', 'refund_due') then
    update public.listings
    set marketplace_state = 'reserved', is_active = true
    where id = new.listing_id;
  elsif new.status = 'unavailable' then
    update public.listings
    set marketplace_state = 'seller_unavailable', is_active = false
    where id = new.listing_id and status = 'approved';
  elsif new.status = 'payout_paid' then
    update public.listings
    set marketplace_state = 'sold', is_active = false
    where id = new.listing_id and status = 'approved';
  elsif new.status = 'refunded' then
    update public.listings
    set marketplace_state = 'seller_unavailable', is_active = false
    where id = new.listing_id and status = 'approved';
  elsif new.status in ('expired', 'cancelled') then
    update public.listings
    set marketplace_state = 'available', is_active = true
    where id = new.listing_id
      and status = 'approved'
      and marketplace_state = 'reserved';
  end if;
  return new;
end;
$hide_reserved_marketplace_listings$;

revoke all on function private.hide_reserved_marketplace_listings() from public, anon, authenticated;
drop trigger if exists hide_reserved_marketplace_listings on public.marketplace_order_items;
create trigger hide_reserved_marketplace_listings
after insert or update of status on public.marketplace_order_items
for each row execute function private.hide_reserved_marketplace_listings();

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
    set status = 'unavailable',
        seller_responded_at = now(),
        availability_expired_at = now()
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

notify pgrst, 'reload schema';
