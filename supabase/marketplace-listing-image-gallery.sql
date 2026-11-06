alter table public.listings
  add column if not exists image_gallery_paths text[] not null default '{}';

alter table public.website_account_drafts
  add column if not exists image_gallery_paths text[] not null default '{}';

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
  listing.seller_price, listing.platform_fee_rate, listing.platform_fee_amount, listing.color, listing.comment,
  listing.image_gallery_paths
from public.listings as listing
where private.is_market_open()
  and listing.status = 'approved'
  and listing.is_active = true
  and (listing.website_user_id is null or private.is_website_account_active(listing.website_user_id));

drop view if exists public.market_listing_feed;

create view public.market_listing_feed
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

grant select on public.marketplace_listings, public.market_listing_feed to anon, authenticated;

drop policy if exists "Public can read approved mineral images" on storage.objects;
create policy "Public can read approved mineral images" on storage.objects for select to anon, authenticated
using (
  bucket_id = 'mineral-images'
  and exists (
    select 1
    from public.marketplace_listings as listing
    where listing.image_path = name
      or listing.image_gallery_paths @> array[name]::text[]
  )
);

notify pgrst, 'reload schema';
