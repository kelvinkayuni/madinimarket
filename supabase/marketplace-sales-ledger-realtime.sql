do $marketplace_sales_ledger_realtime$
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
      and tablename = 'marketplace_orders'
  ) then
    alter publication supabase_realtime add table public.marketplace_orders;
  end if;
end;
$marketplace_sales_ledger_realtime$;

grant select on public.marketplace_orders to authenticated;

drop policy if exists "Admins can view marketplace order realtime updates"
  on public.marketplace_orders;

create policy "Admins can view marketplace order realtime updates"
  on public.marketplace_orders
  for select
  to authenticated
  using ((select private.is_admin()));
