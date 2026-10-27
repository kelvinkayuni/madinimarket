alter table public.marketplace_settings
  add column if not exists seller_confirmation_hours integer not null default 6,
  add column if not exists buyer_payment_hours integer not null default 2,
  add column if not exists order_time_limits_updated_at timestamptz,
  add column if not exists order_time_limits_updated_by uuid references public.profiles (id) on delete set null;

alter table public.marketplace_settings
  drop constraint if exists marketplace_settings_seller_confirmation_hours_check,
  drop constraint if exists marketplace_settings_buyer_payment_hours_check;

alter table public.marketplace_settings
  add constraint marketplace_settings_seller_confirmation_hours_check
    check (seller_confirmation_hours between 1 and 168),
  add constraint marketplace_settings_buyer_payment_hours_check
    check (buyer_payment_hours between 1 and 168);

insert into public.marketplace_settings (id, seller_confirmation_hours, buyer_payment_hours)
values (true, 6, 2)
on conflict (id) do nothing;

create or replace function private.apply_marketplace_order_time_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $apply_marketplace_order_time_limits$
declare
  seller_hours integer;
  buyer_hours integer;
begin
  select settings.seller_confirmation_hours, settings.buyer_payment_hours
    into seller_hours, buyer_hours
  from public.marketplace_settings as settings
  where settings.id = true;

  if not found then
    raise exception 'Marketplace order time limits are not configured.';
  end if;

  if tg_op = 'INSERT' then
    new.seller_response_deadline := now() + make_interval(hours => seller_hours);
  elsif old.payment_status <> 'awaiting_payment' and new.payment_status = 'awaiting_payment' then
    new.payment_deadline := now() + make_interval(hours => buyer_hours);
  end if;

  return new;
end;
$apply_marketplace_order_time_limits$;

revoke all on function private.apply_marketplace_order_time_limits() from public, anon, authenticated;
drop trigger if exists apply_marketplace_order_time_limits on public.marketplace_orders;
create trigger apply_marketplace_order_time_limits
before insert or update of payment_status on public.marketplace_orders
for each row execute function private.apply_marketplace_order_time_limits();

create or replace function public.update_marketplace_order_time_limits(
  p_seller_confirmation_hours integer,
  p_buyer_payment_hours integer,
  p_admin_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $update_marketplace_order_time_limits$
declare
  settings public.marketplace_settings%rowtype;
begin
  if p_seller_confirmation_hours is null
    or p_buyer_payment_hours is null
    or p_seller_confirmation_hours not between 1 and 168
    or p_buyer_payment_hours not between 1 and 168
    or p_admin_id is null then
    raise exception 'Enter whole-hour windows from 1 to 168.' using errcode = '22023';
  end if;

  update public.marketplace_settings
  set seller_confirmation_hours = p_seller_confirmation_hours,
      buyer_payment_hours = p_buyer_payment_hours,
      order_time_limits_updated_at = now(),
      order_time_limits_updated_by = p_admin_id,
      updated_at = now()
  where id = true
  returning * into settings;
  if not found then
    raise exception 'Marketplace settings are not configured.';
  end if;

  update public.marketplace_orders
  set seller_response_deadline = created_at + make_interval(hours => p_seller_confirmation_hours)
  where payment_status = 'awaiting_sellers';

  update public.marketplace_order_items as item
  set seller_response_deadline = orders.seller_response_deadline,
      availability_email_sent_at = null
  from public.marketplace_orders as orders
  where item.order_id = orders.id
    and orders.payment_status = 'awaiting_sellers'
    and item.status = 'awaiting_seller';

  update public.marketplace_orders
  set payment_deadline = updated_at + make_interval(hours => p_buyer_payment_hours),
      payment_ready_email_sent_at = null
  where payment_status = 'awaiting_payment';

  return jsonb_build_object(
    'seller_confirmation_hours', settings.seller_confirmation_hours,
    'buyer_payment_hours', settings.buyer_payment_hours,
    'order_time_limits_updated_at', settings.order_time_limits_updated_at
  );
end;
$update_marketplace_order_time_limits$;

revoke all on function public.update_marketplace_order_time_limits(integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.update_marketplace_order_time_limits(integer, integer, uuid) to service_role;

notify pgrst, 'reload schema';
