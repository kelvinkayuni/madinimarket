create table if not exists public.website_password_resets (
  account_id uuid primary key references public.website_accounts (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  requested_at timestamptz not null default now()
);

alter table public.website_accounts
  add column if not exists session_version integer not null default 0;

alter table public.website_password_resets enable row level security;
revoke all on public.website_password_resets from public, anon, authenticated;
grant all on public.website_password_resets to service_role;

create or replace function public.issue_website_password_reset(
  p_account_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  previous_request timestamptz;
begin
  perform 1
  from public.website_accounts
  where id = p_account_id and is_active
  for update;

  if not found then
    return false;
  end if;

  select requested_at into previous_request
  from public.website_password_resets
  where account_id = p_account_id
  for update;

  if previous_request is not null and previous_request > now() - interval '1 minute' then
    return false;
  end if;

  insert into public.website_password_resets (account_id, token_hash, expires_at, requested_at)
  values (p_account_id, p_token_hash, p_expires_at, now())
  on conflict (account_id) do update
  set token_hash = excluded.token_hash,
      expires_at = excluded.expires_at,
      requested_at = excluded.requested_at;

  return true;
end;
$$;

create or replace function public.complete_website_password_reset(
  p_token_hash text,
  p_password_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reset_account_id uuid;
begin
  select account_id into reset_account_id
  from public.website_password_resets
  where token_hash = p_token_hash
    and expires_at > now();

  if reset_account_id is null then
    return false;
  end if;

  perform 1
  from public.website_accounts
  where id = reset_account_id and is_active
  for update;

  if not found then
    return false;
  end if;

  delete from public.website_password_resets
  where token_hash = p_token_hash and account_id = reset_account_id;

  if not found then
    return false;
  end if;

  update public.website_accounts
  set password_hash = p_password_hash,
      session_version = session_version + 1
  where id = reset_account_id and is_active;

  if not found then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.issue_website_password_reset(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_website_password_reset(text, text) from public, anon, authenticated;
grant execute on function public.issue_website_password_reset(uuid, text, timestamptz) to service_role;
grant execute on function public.complete_website_password_reset(text, text) to service_role;
