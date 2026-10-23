alter table public.marketplace_settings
  add column if not exists market_open_days smallint[] not null default array[0, 1, 2, 3, 4, 5, 6]::smallint[],
  add column if not exists market_open_time time without time zone not null default time '00:00',
  add column if not exists market_close_time time without time zone not null default time '00:00',
  add column if not exists market_hours_updated_at timestamptz,
  add column if not exists market_hours_updated_by uuid references public.profiles (id) on delete set null;

alter table public.marketplace_settings drop constraint if exists marketplace_settings_market_open_days_check;
alter table public.marketplace_settings add constraint marketplace_settings_market_open_days_check
  check (
    cardinality(market_open_days) between 1 and 7
    and market_open_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  );

create or replace function private.is_market_open()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $market_open$
declare
  schedule public.marketplace_settings%rowtype;
  local_now timestamp without time zone;
  local_day smallint;
  local_time time without time zone;
begin
  select settings.*
    into schedule
    from public.marketplace_settings as settings
    where settings.id = true;

  if not found then
    return false;
  end if;

  local_now := now() at time zone 'Africa/Dar_es_Salaam';
  local_day := extract(dow from local_now)::smallint;
  local_time := local_now::time;

  if schedule.market_open_time = schedule.market_close_time then
    return local_day = any(schedule.market_open_days);
  end if;

  if schedule.market_open_time < schedule.market_close_time then
    return local_day = any(schedule.market_open_days)
      and local_time >= schedule.market_open_time
      and local_time < schedule.market_close_time;
  end if;

  return (
      local_day = any(schedule.market_open_days)
      and local_time >= schedule.market_open_time
    ) or (
      ((local_day + 6) % 7)::smallint = any(schedule.market_open_days)
      and local_time < schedule.market_close_time
    );
end;
$market_open$;

revoke all on function private.is_market_open() from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.is_market_open() to anon, authenticated;

drop policy if exists "Anyone can read active listings" on public.listings;
drop policy if exists "Public can read approved listings" on public.listings;
create policy "Public can read approved listings" on public.listings for select to anon, authenticated
using (
  (select private.is_market_open())
  and status = 'approved'
  and is_active = true
  and (select private.is_website_account_active(website_user_id))
);

drop policy if exists "Anyone can read active buy requests" on public.buy_requests;
drop policy if exists "Public can read approved buy requests" on public.buy_requests;
create policy "Public can read approved buy requests" on public.buy_requests for select to anon, authenticated
using (
  (select private.is_market_open())
  and status = 'approved'
  and is_active = true
  and (select private.is_website_account_active(website_user_id))
);

create or replace view public.marketplace_listings
with (security_barrier = true)
as
select listing.id, listing.mineral_name, listing.weight, listing.unit, listing.price, listing.currency,
  listing.country, listing.region, listing.district, listing.image_path, listing.status, listing.created_at, listing.is_active,
  exists (
    select 1 from public.website_account_certificates as certificate
    where certificate.website_user_id = listing.website_user_id
      and certificate.status = 'approved'
  ) as verified_seller,
  listing.listing_type, listing.smallest_stone_weight, listing.largest_stone_weight, listing.stone_weight_unit,
  listing.seller_price, listing.platform_fee_rate, listing.platform_fee_amount
from public.listings as listing
where private.is_market_open()
  and listing.status = 'approved'
  and listing.is_active = true
  and (listing.website_user_id is null or private.is_website_account_active(listing.website_user_id));

create or replace view public.marketplace_buy_requests
with (security_barrier = true)
as
select request.id, request.mineral_name, request.weight, request.unit, request.color,
  request.shape, request.quality, request.offer, request.currency, request.location,
  request.status, request.created_at, request.is_active
from public.buy_requests as request
where private.is_market_open()
  and request.status = 'approved'
  and request.is_active = true
  and (request.website_user_id is null or private.is_website_account_active(request.website_user_id));

create or replace view public.market_listing_feed
with (security_barrier = true)
as
select listing.*,
  exists (
    select 1 from public.website_account_certificates as certificate
    where certificate.website_user_id = listing.website_user_id
      and certificate.status = 'approved'
  ) as verified_seller
from public.listings as listing
where private.is_market_open()
  and listing.status = 'approved'
  and listing.is_active = true
  and (listing.website_user_id is null or private.is_website_account_active(listing.website_user_id));

grant select on public.marketplace_listings, public.marketplace_buy_requests, public.market_listing_feed to anon, authenticated;
notify pgrst, 'reload schema';
