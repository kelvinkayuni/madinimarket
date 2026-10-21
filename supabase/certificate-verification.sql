create table if not exists public.website_account_certificates (
  id uuid primary key default gen_random_uuid(),
  website_user_id uuid not null references public.website_accounts (id) on delete cascade,
  kind text not null check (kind in ('dealer', 'broker')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_message text,
  file_name text not null,
  file_path text not null unique,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (website_user_id, kind)
);

alter table public.website_account_certificates enable row level security;
revoke all on public.website_account_certificates from anon, authenticated;
grant all on public.website_account_certificates to service_role;

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('account-certificates', 'account-certificates', false, array['application/pdf', 'image/jpeg', 'image/png'], 10485760)
on conflict (id) do update
set public = false, allowed_mime_types = excluded.allowed_mime_types, file_size_limit = excluded.file_size_limit;

create index if not exists website_account_certificates_status_idx
  on public.website_account_certificates (status, created_at);

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