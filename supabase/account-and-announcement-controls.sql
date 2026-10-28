alter table public.marketplace_settings
  add column if not exists account_creation_disabled boolean not null default false,
  add column if not exists homepage_announcement text not null default ''
    check (char_length(homepage_announcement) <= 500),
  add column if not exists non_admin_sign_in_disabled boolean not null default false;

update public.marketplace_settings
set account_creation_disabled = false
where id = true and account_creation_disabled is null;

update public.marketplace_settings
set homepage_announcement = ''
where id = true and homepage_announcement is null;

update public.marketplace_settings
set non_admin_sign_in_disabled = false
where id = true and non_admin_sign_in_disabled is null;
