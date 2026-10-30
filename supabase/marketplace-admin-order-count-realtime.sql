create or replace function public.broadcast_marketplace_admin_order_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform realtime.send(
    payload := jsonb_build_object('type', 'marketplace_orders_changed'),
    event := 'marketplace_orders_changed',
    topic := 'admin-marketplace-order-count',
    private := true
  );
  return null;
end;
$$;

revoke all on function public.broadcast_marketplace_admin_order_change()
  from public, anon, authenticated;
grant execute on function public.broadcast_marketplace_admin_order_change()
  to service_role;

drop trigger if exists broadcast_marketplace_admin_order_change
  on public.marketplace_orders;

create trigger broadcast_marketplace_admin_order_change
  after insert or delete or update of payment_status
  on public.marketplace_orders
  for each row
  execute function public.broadcast_marketplace_admin_order_change();

drop trigger if exists broadcast_marketplace_admin_order_item_change
  on public.marketplace_order_items;

create trigger broadcast_marketplace_admin_order_item_change
  after insert or delete or update of status
  on public.marketplace_order_items
  for each row
  execute function public.broadcast_marketplace_admin_order_change();

drop policy if exists "Admins can receive marketplace order count updates"
  on realtime.messages;

create policy "Admins can receive marketplace order count updates"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() = 'admin-marketplace-order-count'
    and (select private.is_admin())
  );
