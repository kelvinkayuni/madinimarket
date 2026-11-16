create or replace function public.broadcast_account_creation_setting_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform realtime.send(
    payload := jsonb_build_object('type', 'account_creation_setting_changed'),
    event := 'account_creation_setting_changed',
    topic := 'site-content-account-creation',
    private := false
  );
  return new;
end;
$$;

revoke all on function public.broadcast_account_creation_setting_change()
  from public, anon, authenticated;
grant execute on function public.broadcast_account_creation_setting_change()
  to service_role;

drop trigger if exists broadcast_account_creation_setting_change
  on public.marketplace_settings;

create trigger broadcast_account_creation_setting_change
  after update of account_creation_disabled on public.marketplace_settings
  for each row
  when (old.account_creation_disabled is distinct from new.account_creation_disabled)
  execute function public.broadcast_account_creation_setting_change();
