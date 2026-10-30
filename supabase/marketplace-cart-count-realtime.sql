create or replace function public.broadcast_marketplace_cart_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  buyer_account_id uuid;
  buyer_channel_token uuid;
begin
  buyer_account_id := case when tg_op = 'DELETE' then old.buyer_id else new.buyer_id end;

  select order_status_channel_token
  into buyer_channel_token
  from public.website_accounts
  where id = buyer_account_id;

  if buyer_channel_token is not null then
    perform realtime.send(
      payload := jsonb_build_object('type', 'cart_changed'),
      event := 'cart_changed',
      topic := 'marketplace-order-status:' || buyer_channel_token::text,
      private := false
    );
  end if;

  return null;
end;
$$;

revoke all on function public.broadcast_marketplace_cart_change()
  from public, anon, authenticated;
grant execute on function public.broadcast_marketplace_cart_change()
  to service_role;

drop trigger if exists broadcast_marketplace_cart_change
  on public.marketplace_cart_items;

create trigger broadcast_marketplace_cart_change
  after insert or delete on public.marketplace_cart_items
  for each row
  execute function public.broadcast_marketplace_cart_change();
