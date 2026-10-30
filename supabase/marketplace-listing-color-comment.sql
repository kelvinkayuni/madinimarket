alter table public.listings
  add column if not exists color text,
  add column if not exists comment text;

alter table public.listings
  drop constraint if exists listings_color_length_check,
  drop constraint if exists listings_comment_length_check;

alter table public.listings
  add constraint listings_color_length_check
    check (color is null or char_length(color) <= 60),
  add constraint listings_comment_length_check
    check (comment is null or (
      char_length(comment) <= 100
      and position(chr(10) in comment) = 0
      and position(chr(13) in comment) = 0
    ));

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
  listing.seller_price, listing.platform_fee_rate, listing.platform_fee_amount,
  listing.color, listing.comment
from public.listings as listing
where listing.status = 'approved' and listing.is_active = true
  and (
    listing.website_user_id is null
    or private.is_website_account_active(listing.website_user_id)
  );

notify pgrst, 'reload schema';
