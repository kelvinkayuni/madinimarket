alter table public.listings
  add column if not exists listing_type text not null default 'single',
  add column if not exists smallest_stone_weight numeric,
  add column if not exists largest_stone_weight numeric,
  add column if not exists stone_weight_unit text;

alter table public.listings drop constraint if exists listings_listing_type_check;
alter table public.listings add constraint listings_listing_type_check
  check (listing_type in ('single', 'batch'));

alter table public.listings drop constraint if exists listings_stone_weight_unit_check;
alter table public.listings add constraint listings_stone_weight_unit_check
  check (stone_weight_unit is null or stone_weight_unit in ('carats', 'g', 'kg'));

alter table public.listings drop constraint if exists listings_batch_weights_check;
alter table public.listings add constraint listings_batch_weights_check check (
  (listing_type = 'single' and smallest_stone_weight is null and largest_stone_weight is null and stone_weight_unit is null)
  or
  (listing_type = 'batch'
    and smallest_stone_weight is not null
    and largest_stone_weight is not null
    and smallest_stone_weight > 0
    and largest_stone_weight >= smallest_stone_weight
    and stone_weight_unit is not null
    and largest_stone_weight * case stone_weight_unit when 'carats' then 0.2 when 'kg' then 1000 else 1 end
      <= weight * case unit when 'carats' then 0.2 when 'kg' then 1000 when 'tons' then 1000000 else 1 end)
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
  listing.listing_type, listing.smallest_stone_weight, listing.largest_stone_weight, listing.stone_weight_unit
from public.listings as listing
where listing.status = 'approved' and listing.is_active = true
  and (
    listing.website_user_id is null
    or exists (
      select 1 from public.website_accounts as account
      where account.id = listing.website_user_id and account.is_active = true
    )
  );

grant select on public.marketplace_listings to anon, authenticated;
grant select, insert, update, delete on public.listings, public.buy_requests to authenticated;
grant all privileges on public.listings, public.buy_requests to service_role;
