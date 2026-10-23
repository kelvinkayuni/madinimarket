do $live_refresh$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) then
    raise exception 'The supabase_realtime publication does not exist. Enable Supabase Realtime before running this migration.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'listings'
  ) then
    alter publication supabase_realtime add table public.listings;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'buy_requests'
  ) then
    alter publication supabase_realtime add table public.buy_requests;
  end if;
end;
$live_refresh$;
