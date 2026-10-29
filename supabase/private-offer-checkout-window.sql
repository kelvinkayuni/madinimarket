begin;

alter table public.marketplace_private_offers
  add column if not exists checkout_deadline timestamptz,
  add column if not exists buyer_offer_email_sent_at timestamptz,
  add column if not exists buyer_offer_email_claimed_at timestamptz;

create or replace function private.guard_marketplace_private_offer_checkout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $guard_marketplace_private_offer_checkout$
begin
  if new.status = 'awaiting_buyer_checkout'
    and (tg_op = 'INSERT' or old.status is distinct from new.status or old.inventory_key is distinct from new.inventory_key) then
    perform pg_advisory_xact_lock(hashtextextended(new.inventory_key, 0));

    if exists (
      select 1
      from public.marketplace_order_items as item
      where item.seller_id = (select threads.seller_id from public.marketplace_private_offer_threads as threads where threads.id = new.thread_id)
        and item.private_inventory_key = new.inventory_key
        and item.status in ('awaiting_seller', 'awaiting_payment', 'payment_submitted', 'paid', 'shipped', 'delivered', 'disputed', 'payout_due', 'payout_paid', 'refund_due')
    ) then
      raise exception 'This mineral is already reserved by another order.' using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.marketplace_private_offers as other_offer
      where other_offer.inventory_key = new.inventory_key
        and other_offer.id <> new.id
        and other_offer.status = 'awaiting_buyer_checkout'
        and other_offer.checkout_deadline > now()
    ) then
      raise exception 'This mineral is temporarily reserved while another buyer completes checkout.' using errcode = '22023';
    end if;
    new.checkout_deadline := now() + interval '30 minutes';
  elsif tg_op = 'UPDATE' and old.status = 'awaiting_buyer_checkout' and new.status <> 'awaiting_buyer_checkout' then
    if new.status = 'ordered' and (old.checkout_deadline is null or old.checkout_deadline <= now()) then
      raise exception 'The checkout deadline has passed. This offer is no longer available.' using errcode = '22023';
    end if;
    new.checkout_deadline := null;
  end if;
  return new;
end;
$guard_marketplace_private_offer_checkout$;

revoke all on function private.guard_marketplace_private_offer_checkout() from public, anon, authenticated;
drop trigger if exists guard_marketplace_private_offer_checkout on public.marketplace_private_offers;
create trigger guard_marketplace_private_offer_checkout
before insert or update of status, inventory_key on public.marketplace_private_offers
for each row execute function private.guard_marketplace_private_offer_checkout();

update public.marketplace_private_offers
set checkout_deadline = coalesce(checkout_deadline, now() + interval '30 minutes')
where status = 'awaiting_buyer_checkout';

create or replace function public.process_marketplace_private_offer_checkouts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $process_marketplace_private_offer_checkouts$
declare
  expired_offer record;
  expired_count integer := 0;
begin
  for expired_offer in
    select id, thread_id, inventory_key
    from public.marketplace_private_offers
    where status = 'awaiting_buyer_checkout'
      and checkout_deadline <= now()
    order by checkout_deadline
    limit 100
  loop
    perform pg_advisory_xact_lock(hashtextextended(expired_offer.inventory_key, 0));

    update public.marketplace_private_offers
    set status = 'closed'
    where id = expired_offer.id
      and status = 'awaiting_buyer_checkout'
      and checkout_deadline <= now();
    if not found then continue; end if;

    update public.marketplace_private_offer_threads
    set state = 'closed',
        closed_at = now(),
        close_reason = 'buyer_checkout_expired',
        updated_at = now()
    where id = expired_offer.thread_id
      and state = 'awaiting_buyer_checkout';

    update public.buy_requests as request
    set is_active = true
    where request.id = (
      select threads.request_id
      from public.marketplace_private_offer_threads as threads
      where threads.id = expired_offer.thread_id
    )
      and request.status = 'approved';

    update public.marketplace_private_offer_threads as competing_thread
    set state = 'open',
        closed_at = null,
        closed_by = null,
        close_reason = null,
        buyer_deleted_at = null,
        seller_deleted_at = null,
        updated_at = now()
    where competing_thread.request_id = (
      select threads.request_id
      from public.marketplace_private_offer_threads as threads
      where threads.id = expired_offer.thread_id
    )
      and competing_thread.id <> expired_offer.thread_id
      and competing_thread.state = 'closed'
      and competing_thread.close_reason = 'buyer_accepted_another_offer'
      and competing_thread.attempt_count < 3;

    expired_count := expired_count + 1;
  end loop;

  return jsonb_build_object('expired_checkouts', expired_count);
end;
$process_marketplace_private_offer_checkouts$;

revoke all on function public.process_marketplace_private_offer_checkouts() from public, anon, authenticated;
grant execute on function public.process_marketplace_private_offer_checkouts() to service_role;

notify pgrst, 'reload schema';

commit;
