revoke select on table public.listings, public.buy_requests
  from public, anon, authenticated;
revoke select (email, phone) on table public.listings
  from public, anon, authenticated;
revoke select (email, phone) on table public.buy_requests
  from public, anon, authenticated;

drop view if exists public.market_listing_feed;

create view public.market_listing_feed
with (security_barrier = true)
as
select
  listing.id,
  listing.user_id,
  listing.website_user_id,
  listing.mineral_name,
  listing.color,
  listing.comment,
  listing.listing_type,
  listing.weight,
  listing.unit,
  listing.smallest_stone_weight,
  listing.largest_stone_weight,
  listing.stone_weight_unit,
  listing.seller_price,
  listing.platform_fee_rate,
  listing.platform_fee_amount,
  listing.price,
  listing.currency,
  listing.seller_name,
  listing.country,
  listing.region,
  listing.district,
  listing.street,
  listing.image_url,
  listing.image_path,
  listing.image_gallery_paths,
  listing.stone_certificate_path,
  listing.status,
  listing.is_active,
  listing.created_at,
  listing.marketplace_state,
  listing.review_message,
  exists (
    select 1
    from public.website_account_certificates as certificate
    where certificate.website_user_id = listing.website_user_id
      and certificate.status = 'approved'
  ) as verified_seller
from public.listings as listing
where private.is_market_open()
  and listing.status = 'approved'
  and listing.is_active = true
  and (listing.website_user_id is null or private.is_website_account_active(listing.website_user_id));

grant select on public.market_listing_feed to anon, authenticated;

notify pgrst, 'reload schema';
