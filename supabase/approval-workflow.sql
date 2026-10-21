create schema if not exists private;

create table if not exists public.website_accounts (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  username text not null unique check (username ~ '^MM-[0-9]{4}$'),
  email text not null unique,
  phone text,
  password_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz default now() not null
);

alter table public.website_accounts
  add column if not exists is_active boolean not null default true;

create table if not exists public.website_account_drafts (
  website_user_id uuid not null references public.website_accounts (id) on delete cascade,
  kind text not null check (kind in ('seller', 'buyer')),
  payload jsonb not null default '{}'::jsonb,
  image_path text,
  updated_at timestamptz not null default now(),
  primary key (website_user_id, kind)
);

alter table public.profiles
  add column if not exists email text,
  add column if not exists role text not null default 'user';

update public.profiles as profile
set email = auth_user.email
from auth.users as auth_user
where profile.id = auth_user.id and profile.email is null;

create unique index if not exists profiles_email_unique
  on public.profiles (email) where email is not null;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('user', 'admin'));

alter table public.listings
  alter column user_id drop not null,
  add column if not exists website_user_id uuid references public.website_accounts (id) on delete cascade,
  add column if not exists image_path text,
  add column if not exists stone_certificate_path text,
  add column if not exists listing_type text not null default 'single',
  add column if not exists smallest_stone_weight numeric,
  add column if not exists largest_stone_weight numeric,
  add column if not exists stone_weight_unit text,
  add column if not exists status text not null default 'pending',
  add column if not exists review_message text,
  add column if not exists reviewed_by uuid references public.profiles (id),
  add column if not exists reviewed_at timestamptz;
alter table public.listings drop constraint if exists listings_listing_type_check;
alter table public.listings add constraint listings_listing_type_check check (listing_type in ('single', 'batch'));
alter table public.listings drop constraint if exists listings_stone_weight_unit_check;
alter table public.listings add constraint listings_stone_weight_unit_check check (stone_weight_unit is null or stone_weight_unit in ('carats', 'g', 'kg'));
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
alter table public.listings drop constraint if exists listings_status_check;
alter table public.listings add constraint listings_status_check check (status in ('pending', 'approved', 'rejected'));

alter table public.buy_requests
  alter column user_id drop not null,
  add column if not exists website_user_id uuid references public.website_accounts (id) on delete cascade,
  add column if not exists status text not null default 'pending',
  add column if not exists review_message text,
  add column if not exists reviewed_by uuid references public.profiles (id),
  add column if not exists reviewed_at timestamptz;
alter table public.buy_requests drop constraint if exists buy_requests_status_check;
alter table public.buy_requests add constraint buy_requests_status_check check (status in ('pending', 'approved', 'rejected'));

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $is_admin$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$is_admin$;

create or replace function private.is_website_account_active(p_website_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $is_account_active$
  select p_website_user_id is null or exists (
    select 1 from public.website_accounts
    where id = p_website_user_id and is_active = true
  );
$is_account_active$;

revoke all on function private.is_website_account_active(uuid) from public, anon, authenticated;

revoke all on function private.is_admin() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $new_user$
begin
  insert into public.profiles (id, display_name, username, email, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'username', 'MM-' || lpad((1000 + floor(random() * 9000))::integer::text, 4, '0')),
    new.email,
    new.raw_user_meta_data ->> 'phone',
    'user'
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$new_user$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.review_listing(p_id bigint, p_approved boolean, p_message text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $review_listing$
begin
  if not private.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if not p_approved and nullif(trim(p_message), '') is null then
    raise exception 'A rejection message is required';
  end if;
  update public.listings
  set status = case when p_approved then 'approved' else 'rejected' end,
      review_message = case when p_approved then null else trim(p_message) end,
      reviewed_by = (select auth.uid()), reviewed_at = now()
  where id = p_id and status = 'pending';
  if not found then raise exception 'Pending seller listing not found'; end if;
end;
$review_listing$;

create or replace function public.review_buy_request(p_id bigint, p_approved boolean, p_message text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $review_buy_request$
begin
  if not private.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if not p_approved and nullif(trim(p_message), '') is null then
    raise exception 'A rejection message is required';
  end if;
  update public.buy_requests
  set status = case when p_approved then 'approved' else 'rejected' end,
      review_message = case when p_approved then null else trim(p_message) end,
      reviewed_by = (select auth.uid()), reviewed_at = now()
  where id = p_id and status = 'pending';
  if not found then raise exception 'Pending buyer request not found'; end if;
end;
$review_buy_request$;

revoke all on function public.review_listing(bigint, boolean, text) from public, anon;
revoke all on function public.review_buy_request(bigint, boolean, text) from public, anon;
grant execute on function public.review_listing(bigint, boolean, text) to authenticated;
grant execute on function public.review_buy_request(bigint, boolean, text) to authenticated;

alter table public.profiles enable row level security;
alter table public.website_accounts enable row level security;
alter table public.website_account_drafts enable row level security;
alter table public.listings enable row level security;
alter table public.buy_requests enable row level security;
revoke all on public.website_accounts from anon, authenticated;
grant all on public.website_accounts to service_role;
revoke all on public.website_account_drafts from anon, authenticated;
grant all on public.website_account_drafts to service_role;
create index if not exists listings_website_user_id_idx on public.listings (website_user_id);
create index if not exists buy_requests_website_user_id_idx on public.buy_requests (website_user_id);
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
revoke all on public.listings from anon, authenticated;
grant select, insert, update, delete on public.listings to authenticated;
revoke all on public.buy_requests from anon, authenticated;
grant select, insert, update, delete on public.buy_requests to authenticated;
grant all privileges on public.listings, public.buy_requests to service_role;

drop policy if exists "Users can view profiles" on public.profiles;
drop policy if exists "Users can insert profile" on public.profiles;
drop policy if exists "Users can update profile" on public.profiles;
drop policy if exists "Users and admins can view profiles" on public.profiles;
create policy "Users and admins can view profiles" on public.profiles for select to authenticated
using ((select auth.uid()) = id or (select private.is_admin()));

drop policy if exists "Users can manage their listings" on public.listings;
drop policy if exists "Anyone can read active listings" on public.listings;
drop policy if exists "Public can read approved listings" on public.listings;
drop policy if exists "Owners can read their listings" on public.listings;
drop policy if exists "Admins can read all listings" on public.listings;
drop policy if exists "Owners can submit listings" on public.listings;
drop policy if exists "Owners can edit returned listings" on public.listings;
drop policy if exists "Owners can delete returned listings" on public.listings;
create policy "Public can read approved listings" on public.listings for select to anon, authenticated
using (status = 'approved' and is_active = true and (select private.is_website_account_active(website_user_id)));
create policy "Owners can read their listings" on public.listings for select to authenticated
using ((select auth.uid()) = user_id);
create policy "Admins can read all listings" on public.listings for select to authenticated
using ((select private.is_admin()));
create policy "Owners can submit listings" on public.listings for insert to authenticated
with check ((select auth.uid()) = user_id and status = 'pending' and review_message is null and reviewed_by is null and reviewed_at is null);
create policy "Owners can edit returned listings" on public.listings for update to authenticated
using ((select auth.uid()) = user_id and status in ('pending', 'rejected'))
with check ((select auth.uid()) = user_id and status = 'pending' and review_message is null and reviewed_by is null and reviewed_at is null);
create policy "Owners can delete returned listings" on public.listings for delete to authenticated
using ((select auth.uid()) = user_id and status in ('pending', 'rejected'));

drop policy if exists "Users can manage their buy requests" on public.buy_requests;
drop policy if exists "Anyone can read active buy requests" on public.buy_requests;
drop policy if exists "Public can read approved buy requests" on public.buy_requests;
drop policy if exists "Owners can read their buy requests" on public.buy_requests;
drop policy if exists "Admins can read all buy requests" on public.buy_requests;
drop policy if exists "Owners can submit buy requests" on public.buy_requests;
drop policy if exists "Owners can edit returned buy requests" on public.buy_requests;
drop policy if exists "Owners can delete returned buy requests" on public.buy_requests;
create policy "Public can read approved buy requests" on public.buy_requests for select to anon, authenticated
using (status = 'approved' and is_active = true and (select private.is_website_account_active(website_user_id)));
create policy "Owners can read their buy requests" on public.buy_requests for select to authenticated
using ((select auth.uid()) = user_id);
create policy "Admins can read all buy requests" on public.buy_requests for select to authenticated
using ((select private.is_admin()));
create policy "Owners can submit buy requests" on public.buy_requests for insert to authenticated
with check ((select auth.uid()) = user_id and status = 'pending' and review_message is null and reviewed_by is null and reviewed_at is null);
create policy "Owners can edit returned buy requests" on public.buy_requests for update to authenticated
using ((select auth.uid()) = user_id and status in ('pending', 'rejected'))
with check ((select auth.uid()) = user_id and status = 'pending' and review_message is null and reviewed_by is null and reviewed_at is null);
create policy "Owners can delete returned buy requests" on public.buy_requests for delete to authenticated
using ((select auth.uid()) = user_id and status in ('pending', 'rejected'));

create or replace view public.marketplace_listings
with (security_barrier = true)
as
select listing.id, listing.mineral_name, listing.weight, listing.unit, listing.price, listing.currency,
  listing.country, listing.region, listing.district, listing.image_path, listing.status, listing.created_at, listing.is_active,
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

create or replace view public.marketplace_buy_requests
with (security_barrier = true)
as
select request.id, request.mineral_name, request.weight, request.unit, request.color,
  request.shape, request.quality, request.offer, request.currency, request.location,
  request.status, request.created_at, request.is_active
from public.buy_requests as request
where request.status = 'approved' and request.is_active = true
  and (
    request.website_user_id is null
    or exists (
      select 1 from public.website_accounts as account
      where account.id = request.website_user_id and account.is_active = true
    )
  );

grant select on public.marketplace_listings, public.marketplace_buy_requests to anon, authenticated;

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('mineral-images', 'mineral-images', false, array['image/png', 'image/jpeg'], 5242880)
on conflict (id) do update set public = false, allowed_mime_types = excluded.allowed_mime_types, file_size_limit = excluded.file_size_limit;

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('stone-certificates', 'stone-certificates', false, array['application/pdf', 'image/jpeg'], 10485760)
on conflict (id) do update set public = false, allowed_mime_types = excluded.allowed_mime_types, file_size_limit = excluded.file_size_limit;

drop policy if exists "Owners upload mineral images" on storage.objects;
drop policy if exists "Owners and reviewers read mineral images" on storage.objects;
drop policy if exists "Public can read approved mineral images" on storage.objects;
create policy "Owners upload mineral images" on storage.objects for insert to authenticated
with check (bucket_id = 'mineral-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Owners and reviewers read mineral images" on storage.objects for select to authenticated
using (
  bucket_id = 'mineral-images'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select private.is_admin())
    or exists (select 1 from public.marketplace_listings where image_path = name)
  )
);
create policy "Public can read approved mineral images" on storage.objects for select to anon
using (
  bucket_id = 'mineral-images'
  and exists (select 1 from public.marketplace_listings where image_path = name)
);