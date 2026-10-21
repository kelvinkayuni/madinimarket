alter table public.listings
  add column if not exists seller_price numeric,
  add column if not exists platform_fee_rate numeric not null default 0,
  add column if not exists platform_fee_amount numeric not null default 0;

update public.listings
set seller_price = price
where seller_price is null;

alter table public.listings
  alter column seller_price set not null;

alter table public.listings drop constraint if exists listings_price_breakdown_check;
alter table public.listings add constraint listings_price_breakdown_check check (
  seller_price > 0
  and platform_fee_rate between 0 and 0.07
  and platform_fee_amount >= 0
  and price = seller_price + platform_fee_amount
);

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
where listing.status = 'approved' and listing.is_active = true
  and (
    listing.website_user_id is null
    or exists (
      select 1 from public.website_accounts as account
      where account.id = listing.website_user_id and account.is_active = true
    )
  );

grant select on public.market_listing_feed to anon, authenticated;
notify pgrst, 'reload schema';
