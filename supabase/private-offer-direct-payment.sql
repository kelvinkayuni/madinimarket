begin;

alter table public.marketplace_private_offers
  add column if not exists availability_confirmed_at timestamptz;

alter table public.marketplace_private_offers
  alter column availability_confirmed_at set default now();

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
  if not private.is_market_open() then
    raise exception 'The marketplace is closed.' using errcode = '22023';
  end if;

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
  select * into buyer from public.website_accounts
  where id = p_buyer_id and is_active = true for update;
  if not found then raise exception 'An active buyer account is required.' using errcode = '42501'; end if;
  select * into seller from public.website_accounts
  where id = selected_thread.seller_id and is_active = true;
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
      image_path, currency, total_price, seller_amount, platform_fee_rate, platform_fee_amount,
      seller_response_deadline, status, seller_responded_at, private_offer_id,
      mineral_color, mineral_shape, mineral_quality, mineral_country, mineral_region, mineral_district,
      private_inventory_key
    ) values (
      new_order.id, null, seller.id, seller.email, selected_offer.mineral_name, selected_offer.listing_type,
      selected_offer.weight, selected_offer.unit, selected_offer.image_path, selected_offer.currency,
      selected_offer.total_price, selected_offer.seller_amount, selected_offer.platform_fee_rate,
      selected_offer.platform_fee_amount, new_order.seller_response_deadline,
      case when selected_offer.availability_confirmed_at is not null then 'awaiting_payment' else 'awaiting_seller' end,
      case when selected_offer.availability_confirmed_at is not null then now() else null end,
      selected_offer.id, selected_offer.color, selected_offer.shape, selected_offer.quality,
      selected_offer.country, selected_offer.region, selected_offer.district, selected_offer.inventory_key
    );
  exception when unique_violation then
    raise exception 'This mineral is already reserved by another active order.' using errcode = '23505';
  end;

  if selected_offer.availability_confirmed_at is not null then
    update public.marketplace_orders
    set payment_status = 'awaiting_payment', updated_at = now()
    where id = new_order.id
    returning * into new_order;
  end if;

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
  update public.marketplace_private_offers
  set status = 'ordered'
  where id = selected_offer.id;
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

revoke all on function public.create_marketplace_private_offer_order(uuid, uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_marketplace_private_offer_order(uuid, uuid, text, text, text, text, text, text)
  to service_role;

notify pgrst, 'reload schema';

commit;
