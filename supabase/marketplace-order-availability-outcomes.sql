-- Apply after marketplace-listing-reservations.sql.
alter table public.marketplace_order_items
  add column if not exists buyer_availability_result_email_sent_at timestamptz,
  add column if not exists buyer_availability_result_email_claimed_at timestamptz;

update public.marketplace_order_items
set status = 'expired',
    seller_responded_at = null
where status = 'unavailable'
  and availability_expired_at is not null;

update public.listings as listing
set marketplace_state = 'available',
    is_active = true
where listing.status = 'approved'
  and listing.marketplace_state in ('reserved', 'seller_unavailable')
  and not exists (
    select 1
    from public.marketplace_order_items as active_item
    where active_item.listing_id = listing.id
      and active_item.status in (
        'awaiting_seller', 'awaiting_payment', 'payment_submitted', 'paid',
        'shipped', 'delivered', 'disputed', 'payout_due', 'refund_due'
      )
  )
  and exists (
    select 1
    from (
      select distinct on (item.listing_id) item.listing_id, item.status, item.availability_expired_at
      from public.marketplace_order_items as item
      where item.listing_id is not null
      order by item.listing_id, item.created_at desc, item.id desc
    ) as latest_item
    where latest_item.listing_id = listing.id
      and latest_item.status = 'expired'
      and latest_item.availability_expired_at is not null
  );

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
    set status = 'expired',
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
