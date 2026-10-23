alter table public.marketplace_settings
  add column if not exists listing_fee_rate numeric(5, 4) not null default 0.05,
  add column if not exists listing_fee_updated_at timestamptz not null default now(),
  add column if not exists listing_fee_updated_by uuid references public.profiles (id) on delete set null;

alter table public.marketplace_settings drop constraint if exists marketplace_settings_listing_fee_rate_check;
alter table public.marketplace_settings add constraint marketplace_settings_listing_fee_rate_check
  check (listing_fee_rate between 0 and 1);
insert into public.marketplace_settings (id, usd_enabled, listing_fee_rate)
values (true, true, 0.05)
on conflict (id) do nothing;

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
  and platform_fee_rate between 0 and 1
  and platform_fee_amount >= 0
  and price = seller_price + platform_fee_amount
);

create or replace function public.apply_listing_fee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $apply_listing_fee$
declare
  fee_rate numeric;
begin
  if tg_op = 'INSERT' then
    select settings.listing_fee_rate
      into fee_rate
      from public.marketplace_settings as settings
      where settings.id = true;
    if fee_rate is null then
      raise exception 'Mineral listing fee settings are unavailable'
        using errcode = '23514';
    end if;
  else
    fee_rate := old.platform_fee_rate;
  end if;

  new.platform_fee_rate := fee_rate;
  new.platform_fee_amount := round(new.seller_price * fee_rate, case when new.currency = 'TZS' then 0 else 2 end);
  new.price := new.seller_price + new.platform_fee_amount;
  return new;
end;
$apply_listing_fee$;

revoke all on function public.apply_listing_fee() from public, anon, authenticated;

drop trigger if exists apply_listing_fee on public.listings;
create trigger apply_listing_fee
before insert or update of seller_price, platform_fee_rate, platform_fee_amount, price, currency on public.listings
for each row execute function public.apply_listing_fee();

alter table public.marketplace_settings enable row level security;
revoke all on public.marketplace_settings from anon, authenticated;
grant all privileges on public.marketplace_settings to service_role;

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
