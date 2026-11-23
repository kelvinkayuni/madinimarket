alter table public.website_accounts
  add column if not exists nin text
    check (nin is null or nin ~ '^[0-9]{20}$');

comment on column public.website_accounts.nin is
  'Sensitive Tanzanian NIDA NIN; returned only to admins through the admin accounts API.';
