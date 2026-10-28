alter table public.marketplace_settings
  add column if not exists non_admin_sign_in_disabled boolean not null default false;

update public.marketplace_settings
set non_admin_sign_in_disabled = false
where id = true and non_admin_sign_in_disabled is null;
