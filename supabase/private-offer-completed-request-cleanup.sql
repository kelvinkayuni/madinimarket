begin;

create or replace function private.hide_completed_private_offer_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $hide_completed_private_offer_request$
declare
  selected_request_id bigint;
begin
  if new.private_offer_id is null or new.status <> 'payout_paid'
    or (tg_op = 'UPDATE' and old.status = new.status) then
    return new;
  end if;

  select threads.request_id into selected_request_id
  from public.marketplace_private_offers as offers
  join public.marketplace_private_offer_threads as threads on threads.id = offers.thread_id
  where offers.id = new.private_offer_id;
  if not found then return new; end if;

  update public.buy_requests
  set is_active = false
  where id = selected_request_id and status = 'approved' and is_active = true;

  return new;
end;
$hide_completed_private_offer_request$;

revoke all on function private.hide_completed_private_offer_request() from public, anon, authenticated;
drop trigger if exists hide_completed_private_offer_request on public.marketplace_order_items;
create trigger hide_completed_private_offer_request
after insert or update of status on public.marketplace_order_items
for each row execute function private.hide_completed_private_offer_request();

update public.buy_requests as request
set is_active = false
where request.status = 'approved'
  and request.is_active = true
  and exists (
    select 1
    from public.marketplace_private_offer_threads as threads
    join public.marketplace_private_offers as offers on offers.thread_id = threads.id
    join public.marketplace_order_items as order_item on order_item.private_offer_id = offers.id
    where threads.request_id = request.id
      and order_item.status = 'payout_paid'
  );

notify pgrst, 'reload schema';

commit;
