alter table public.website_accounts
  add column if not exists bank_name text,
  add column if not exists bank_account_number text,
  add column if not exists bank_account_holder_name text,
  add column if not exists bank_info_added_at timestamptz,
  add column if not exists bank_info_updated_at timestamptz,
  add column if not exists bank_info_edit_unlocked boolean not null default false;

alter table public.website_accounts
  drop constraint if exists website_accounts_bank_information_check;

alter table public.website_accounts
  add constraint website_accounts_bank_information_check check (
    (
      bank_name is null
      and bank_account_number is null
      and bank_account_holder_name is null
      and bank_info_added_at is null
      and bank_info_updated_at is null
    )
    or (
      bank_name is not null and char_length(bank_name) between 1 and 120
      and bank_account_number is not null and char_length(bank_account_number) between 4 and 64
      and bank_account_holder_name is not null and char_length(bank_account_holder_name) between 1 and 120
      and bank_info_added_at is not null
      and bank_info_updated_at is not null
    )
  );

alter table public.marketplace_order_items
  add column if not exists payout_bank_name text,
  add column if not exists payout_bank_account_number text,
  add column if not exists payout_bank_account_holder_name text,
  add column if not exists payout_bank_snapshot_at timestamptz;

create or replace function public.save_website_account_bank_information(
  p_account_id uuid,
  p_bank_name text,
  p_bank_account_number text,
  p_bank_account_holder_name text
)
returns table (
  bank_name text,
  bank_account_number text,
  bank_account_holder_name text,
  bank_info_added_at timestamptz,
  bank_info_updated_at timestamptz,
  bank_info_edit_unlocked boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_account public.website_accounts%rowtype;
begin
  select * into current_account
  from public.website_accounts
  where id = p_account_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ACCOUNT_NOT_FOUND';
  end if;

  if current_account.bank_info_added_at is not null
    and not current_account.bank_info_edit_unlocked
    and current_account.bank_info_updated_at > now() - interval '6 months'
  then
    raise exception using errcode = 'P0001', message = 'BANK_INFORMATION_LOCKED';
  end if;

  update public.website_accounts as account
  set bank_name = p_bank_name,
      bank_account_number = p_bank_account_number,
      bank_account_holder_name = p_bank_account_holder_name,
      bank_info_added_at = coalesce(account.bank_info_added_at, now()),
      bank_info_updated_at = now(),
      bank_info_edit_unlocked = false
  where account.id = p_account_id
  returning * into current_account;

  update public.marketplace_order_items as item
  set payout_bank_name = current_account.bank_name,
      payout_bank_account_number = current_account.bank_account_number,
      payout_bank_account_holder_name = current_account.bank_account_holder_name,
      payout_bank_snapshot_at = now()
  where item.seller_id = current_account.id
    and item.status = 'payout_due'
    and item.payout_bank_name is null
    and item.payout_bank_account_number is null
    and item.payout_bank_account_holder_name is null;

  return query select
    current_account.bank_name,
    current_account.bank_account_number,
    current_account.bank_account_holder_name,
    current_account.bank_info_added_at,
    current_account.bank_info_updated_at,
    current_account.bank_info_edit_unlocked;
end;
$$;

revoke all on function public.save_website_account_bank_information(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.save_website_account_bank_information(uuid, text, text, text) to service_role;

create or replace function public.snapshot_marketplace_payout_bank_information()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'payout_due'
    and (tg_op = 'INSERT' or old.status is distinct from new.status)
  then
    new.payout_bank_name = null;
    new.payout_bank_account_number = null;
    new.payout_bank_account_holder_name = null;
    new.payout_bank_snapshot_at = null;

    if new.seller_id is not null then
      select
        account.bank_name,
        account.bank_account_number,
        account.bank_account_holder_name
      into
        new.payout_bank_name,
        new.payout_bank_account_number,
        new.payout_bank_account_holder_name
      from public.website_accounts as account
      where account.id = new.seller_id;
    end if;

    if new.payout_bank_name is not null
      and new.payout_bank_account_number is not null
      and new.payout_bank_account_holder_name is not null
    then
      new.payout_bank_snapshot_at = now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists marketplace_order_items_payout_bank_snapshot on public.marketplace_order_items;
create trigger marketplace_order_items_payout_bank_snapshot
before insert or update of status on public.marketplace_order_items
for each row execute function public.snapshot_marketplace_payout_bank_information();

revoke all on function public.snapshot_marketplace_payout_bank_information() from public, anon, authenticated;

update public.marketplace_order_items as item
set payout_bank_name = account.bank_name,
    payout_bank_account_number = account.bank_account_number,
    payout_bank_account_holder_name = account.bank_account_holder_name,
    payout_bank_snapshot_at = now()
from public.website_accounts as account
where item.status = 'payout_due'
  and item.payout_bank_name is null
  and item.payout_bank_account_number is null
  and item.payout_bank_account_holder_name is null
  and item.seller_id = account.id
  and account.bank_name is not null
  and account.bank_account_number is not null
  and account.bank_account_holder_name is not null;
