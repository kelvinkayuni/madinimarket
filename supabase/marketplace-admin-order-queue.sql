create or replace function public.admin_marketplace_order_queue(
  p_filter text default 'needs_action',
  p_search text default '',
  p_offset integer default 0,
  p_limit integer default 25
)
returns table (order_id uuid, total_count bigint, action_priority integer)
language sql
security definer
set search_path = public, pg_temp
as $$
  with order_state as (
    select
      o.id,
      o.control_number,
      o.buyer_name,
      o.buyer_email,
      o.payment_status,
      o.created_at,
      count(i.id)::integer as item_count,
      count(i.id) filter (where i.status in (
        'unavailable', 'payout_paid', 'refunded', 'expired', 'cancelled'
      ))::integer as completed_item_count,
      coalesce(bool_or(i.status in (
        'disputed', 'payout_due', 'refund_due'
      )), false) as has_admin_item_action,
      coalesce(bool_or(
        i.status in ('paid', 'shipped')
        and nullif(btrim(coalesce(i.shipping_carrier, '')), '') is not null
        and nullif(btrim(coalesce(i.tracking_number, '')), '') is not null
      ), false) as can_confirm_delivery
    from public.marketplace_orders o
    left join public.marketplace_order_items i on i.order_id = o.id
    group by o.id
  ),
  classified as (
    select
      *,
      payment_status in ('expired', 'cancelled')
        or (
          payment_status = 'paid'
          and item_count > 0
          and item_count = completed_item_count
        ) as is_history,
      case
        when payment_status = 'payment_submitted' then 0
        when has_admin_item_action or can_confirm_delivery then 1
        else 2
      end as priority
    from order_state
  ),
  filtered as (
    select *
    from classified
    where
      (
        p_search = ''
        or control_number ilike '%' || p_search || '%'
        or buyer_name ilike '%' || p_search || '%'
        or buyer_email ilike '%' || p_search || '%'
      )
      and case p_filter
        when 'needs_action' then
          payment_status = 'payment_submitted'
          or has_admin_item_action
          or can_confirm_delivery
        when 'active' then not is_history
        when 'payment_submitted' then payment_status = 'payment_submitted'
        when 'awaiting_sellers' then payment_status = 'awaiting_sellers'
        when 'awaiting_payment' then payment_status = 'awaiting_payment'
        when 'delivery_due' then can_confirm_delivery
        when 'disputes' then exists (
          select 1 from public.marketplace_order_items i
          where i.order_id = classified.id and i.status = 'disputed'
        )
        when 'payout_due' then exists (
          select 1 from public.marketplace_order_items i
          where i.order_id = classified.id and i.status = 'payout_due'
        )
        when 'refund_due' then exists (
          select 1 from public.marketplace_order_items i
          where i.order_id = classified.id and i.status = 'refund_due'
        )
        when 'history' then is_history
        when 'all' then true
        else false
      end
  ),
  page_rows as (
    select id, priority, count(*) over () as matched_count, created_at
    from filtered
    order by priority, created_at desc
    offset greatest(p_offset, 0)
    limit greatest(1, least(p_limit, 50))
  ),
  total as (
    select count(*) as matched_count from filtered
  )
  select page_rows.id, page_rows.matched_count, page_rows.priority
  from page_rows
  union all
  select null::uuid, total.matched_count, 0
  from total
  where not exists (select 1 from page_rows);
$$;

revoke all on function public.admin_marketplace_order_queue(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_marketplace_order_queue(text, text, integer, integer)
  to service_role;
