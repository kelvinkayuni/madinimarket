alter table public.marketplace_settings
  add column if not exists account_creation_disabled boolean not null default false,
  add column if not exists homepage_announcement text not null default ''
    check (char_length(homepage_announcement) <= 500);

update public.marketplace_settings
set account_creation_disabled = false
where id = true and account_creation_disabled is null;

update public.marketplace_settings
set homepage_announcement = ''
where id = true and homepage_announcement is null;
