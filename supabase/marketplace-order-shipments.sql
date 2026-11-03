create or replace function public.dispatch_marketplace_order_shipment(
  p_order_item_id uuid,
  p_seller_id uuid,
  p_carrier text,
  p_tracking_number text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $dispatch_marketplace_order_shipment$
declare
  selected_order_id uuid;
  selected_status text;
  selected_carrier text;
  selected_tracking_number text;
  updated_items integer;
begin
  if p_seller_id is null
    or p_carrier is null or length(trim(p_carrier)) not between 1 and 80
    or p_tracking_number is null or length(trim(p_tracking_number)) not between 1 and 120 then
    raise exception 'Enter the delivery carrier and tracking number.' using errcode = '22023';
  end if;

  select orders.id, items.status, items.shipping_carrier, items.tracking_number
    into selected_order_id, selected_status, selected_carrier, selected_tracking_number
  from public.marketplace_order_items as items
  join public.marketplace_orders as orders on orders.id = items.order_id
  where items.id = p_order_item_id and items.seller_id = p_seller_id
  for update of orders;

  if not found then
    raise exception 'Order item not found.' using errcode = 'P0002';
  end if;
  if selected_status <> 'paid'
    or nullif(trim(selected_carrier), '') is not null
    or nullif(trim(selected_tracking_number), '') is not null then
    raise exception 'This order item is not ready to dispatch.' using errcode = '22023';
  end if;

  update public.marketplace_order_items as items
  set status = 'shipped',
      shipped_at = now(),
      shipping_carrier = trim(p_carrier),
      tracking_number = trim(p_tracking_number)
  where items.order_id = selected_order_id
    and items.seller_id = p_seller_id
    and items.status = 'paid'
    and nullif(trim(items.shipping_carrier), '') is null
    and nullif(trim(items.tracking_number), '') is null;
  get diagnostics updated_items = row_count;

  if updated_items = 0 then
    raise exception 'This order item is not ready to dispatch.' using errcode = '22023';
  end if;
  return updated_items;
end;
$dispatch_marketplace_order_shipment$;

revoke all on function public.dispatch_marketplace_order_shipment(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.dispatch_marketplace_order_shipment(uuid, uuid, text, text) to service_role;

create or replace function public.confirm_marketplace_order_shipment_delivery(
  p_order_item_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $confirm_marketplace_order_shipment_delivery$
declare
  selected_order_id uuid;
  selected_seller_id uuid;
  selected_status text;
  selected_carrier text;
  selected_tracking_number text;
  updated_items integer;
begin
  select orders.id, items.seller_id, items.status, items.shipping_carrier, items.tracking_number
    into selected_order_id, selected_seller_id, selected_status, selected_carrier, selected_tracking_number
  from public.marketplace_order_items as items
  join public.marketplace_orders as orders on orders.id = items.order_id
  where items.id = p_order_item_id
  for update of orders;

  if not found then
    raise exception 'Order item not found.' using errcode = 'P0002';
  end if;
  if selected_status not in ('paid', 'shipped')
    or nullif(trim(selected_carrier), '') is null
    or nullif(trim(selected_tracking_number), '') is null then
    raise exception 'This shipment is no longer awaiting carrier delivery confirmation.' using errcode = '22023';
  end if;

  update public.marketplace_order_items as items
  set status = 'delivered',
      delivered_at = now()
  where items.order_id = selected_order_id
    and items.seller_id is not distinct from selected_seller_id
    and items.shipping_carrier = selected_carrier
    and items.tracking_number = selected_tracking_number
    and items.status in ('paid', 'shipped');
  get diagnostics updated_items = row_count;

  if updated_items = 0 then
    raise exception 'This shipment is no longer awaiting carrier delivery confirmation.' using errcode = '22023';
  end if;
  return updated_items;
end;
$confirm_marketplace_order_shipment_delivery$;

revoke all on function public.confirm_marketplace_order_shipment_delivery(uuid) from public, anon, authenticated;
grant execute on function public.confirm_marketplace_order_shipment_delivery(uuid) to service_role;

create or replace function public.confirm_marketplace_order_shipment_receipt(
  p_order_item_id uuid,
  p_buyer_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $confirm_marketplace_order_shipment_receipt$
declare
  selected_order_id uuid;
  selected_seller_id uuid;
  selected_status text;
  selected_carrier text;
  selected_tracking_number text;
  updated_items integer;
begin
  select orders.id, items.seller_id, items.status, items.shipping_carrier, items.tracking_number
    into selected_order_id, selected_seller_id, selected_status, selected_carrier, selected_tracking_number
  from public.marketplace_order_items as items
  join public.marketplace_orders as orders on orders.id = items.order_id
  where items.id = p_order_item_id and orders.buyer_id = p_buyer_id
  for update of orders;

  if not found then
    raise exception 'Order item not found for this buyer.' using errcode = 'P0002';
  end if;
  if selected_status <> 'delivered'
    or nullif(trim(selected_carrier), '') is null
    or nullif(trim(selected_tracking_number), '') is null then
    raise exception 'Only the buyer can confirm a shipment marked delivered.' using errcode = '22023';
  end if;

  update public.marketplace_order_items as items
  set status = 'payout_due',
      buyer_received_at = now(),
      payout_due_at = now()
  where items.order_id = selected_order_id
    and items.seller_id is not distinct from selected_seller_id
    and items.shipping_carrier = selected_carrier
    and items.tracking_number = selected_tracking_number
    and items.status = 'delivered';
  get diagnostics updated_items = row_count;

  if updated_items = 0 then
    raise exception 'This shipment is no longer awaiting receipt confirmation.' using errcode = '22023';
  end if;
  return updated_items;
end;
$confirm_marketplace_order_shipment_receipt$;

revoke all on function public.confirm_marketplace_order_shipment_receipt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_marketplace_order_shipment_receipt(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
