create table if not exists public.marketplace_settings (
  id boolean primary key default true check (id),
  usd_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.marketplace_settings (id, usd_enabled)
values (true, true)
on conflict (id) do nothing;

alter table public.marketplace_settings enable row level security;
revoke all on public.marketplace_settings from anon, authenticated;
grant all privileges on public.marketplace_settings to service_role;

create or replace function public.enforce_marketplace_currency_setting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $enforce_currency$
declare
  usd_is_enabled boolean;
begin
  if new.currency = 'USD' then
    select settings.usd_enabled
      into usd_is_enabled
      from public.marketplace_settings as settings
      where settings.id = true;
    if not coalesce(usd_is_enabled, false) then
      raise exception 'USD currency is currently disabled by the marketplace administrator'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$enforce_currency$;

revoke all on function public.enforce_marketplace_currency_setting() from public, anon, authenticated;

drop trigger if exists enforce_listing_currency_setting on public.listings;
create trigger enforce_listing_currency_setting
before insert or update of currency on public.listings
for each row execute function public.enforce_marketplace_currency_setting();

drop trigger if exists enforce_buy_request_currency_setting on public.buy_requests;
create trigger enforce_buy_request_currency_setting
before insert or update of currency on public.buy_requests
for each row execute function public.enforce_marketplace_currency_setting();
