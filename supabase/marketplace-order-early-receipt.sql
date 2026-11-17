begin;

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
  set status = case when items.buyer_received_at is not null then 'payout_due' else 'delivered' end,
      delivered_at = now(),
      payout_due_at = case
        when items.buyer_received_at is not null then coalesce(items.payout_due_at, now())
        else items.payout_due_at
      end
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
  selected_buyer_received_at timestamptz;
  updated_items integer;
begin
  select orders.id, items.seller_id, items.status, items.shipping_carrier, items.tracking_number, items.buyer_received_at
    into selected_order_id, selected_seller_id, selected_status, selected_carrier, selected_tracking_number, selected_buyer_received_at
  from public.marketplace_order_items as items
  join public.marketplace_orders as orders on orders.id = items.order_id
  where items.id = p_order_item_id and orders.buyer_id = p_buyer_id
  for update of orders;

  if not found then
    raise exception 'Order item not found for this buyer.' using errcode = 'P0002';
  end if;
  if selected_status not in ('shipped', 'delivered')
    or nullif(trim(selected_carrier), '') is null
    or nullif(trim(selected_tracking_number), '') is null then
    raise exception 'Only shipped orders with tracking details can be confirmed as received.' using errcode = '22023';
  end if;
  if selected_buyer_received_at is not null then
    raise exception 'Receipt has already been confirmed for this shipment.' using errcode = '22023';
  end if;

  update public.marketplace_order_items as items
  set status = case when items.status = 'delivered' then 'payout_due' else items.status end,
      buyer_received_at = now(),
      payout_due_at = case
        when items.status = 'delivered' then coalesce(items.payout_due_at, now())
        else items.payout_due_at
      end
  where items.order_id = selected_order_id
    and items.seller_id is not distinct from selected_seller_id
    and items.shipping_carrier = selected_carrier
    and items.tracking_number = selected_tracking_number
    and items.status in ('shipped', 'delivered')
    and items.buyer_received_at is null;
  get diagnostics updated_items = row_count;

  if updated_items = 0 then
    raise exception 'This shipment is no longer awaiting receipt confirmation.' using errcode = '22023';
  end if;
  return updated_items;
end;
$confirm_marketplace_order_shipment_receipt$;

revoke all on function public.confirm_marketplace_order_shipment_receipt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_marketplace_order_shipment_receipt(uuid, uuid) to service_role;

commit;
