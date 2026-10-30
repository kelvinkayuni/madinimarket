alter table public.website_accounts
  add column if not exists order_status_channel_token uuid not null default gen_random_uuid();

create or replace function public.broadcast_marketplace_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  buyer_account_id uuid;
  seller_account_id uuid;
  buyer_channel_token uuid;
  seller_channel_token uuid;
begin
  select order_row.buyer_id, order_item.seller_id
  into buyer_account_id, seller_account_id
  from public.marketplace_orders as order_row
  join public.marketplace_order_items as order_item on order_item.order_id = order_row.id
  where order_item.id = new.id;

  select order_status_channel_token
  into buyer_channel_token
  from public.website_accounts
  where id = buyer_account_id;

  if buyer_channel_token is not null then
    perform realtime.send(
      payload := jsonb_build_object('type', 'order_status_changed'),
      event := 'order_status_changed',
      topic := 'marketplace-order-status:' || buyer_channel_token::text,
      private := false
    );
  end if;

  if seller_account_id is not null and seller_account_id is distinct from buyer_account_id then
    select order_status_channel_token
    into seller_channel_token
    from public.website_accounts
    where id = seller_account_id;

    if seller_channel_token is not null then
      perform realtime.send(
        payload := jsonb_build_object('type', 'order_status_changed'),
        event := 'order_status_changed',
        topic := 'marketplace-order-status:' || seller_channel_token::text,
        private := false
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.broadcast_marketplace_order_status_change()
  from public, anon, authenticated;
grant execute on function public.broadcast_marketplace_order_status_change()
  to service_role;

drop trigger if exists broadcast_marketplace_order_status_change
  on public.marketplace_order_items;

create trigger broadcast_marketplace_order_status_change
  after update of status on public.marketplace_order_items
  for each row
  when (old.status is distinct from new.status)
  execute function public.broadcast_marketplace_order_status_change();
