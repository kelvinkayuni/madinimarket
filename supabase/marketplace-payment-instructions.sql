alter table public.marketplace_settings
  add column if not exists payment_instructions text not null default '',
  add column if not exists payment_instructions_updated_at timestamptz,
  add column if not exists payment_instructions_updated_by uuid references public.profiles (id) on delete set null;

alter table public.marketplace_settings
  drop constraint if exists marketplace_settings_payment_instructions_length_check;

alter table public.marketplace_settings
  add constraint marketplace_settings_payment_instructions_length_check
    check (char_length(payment_instructions) <= 5000);

insert into public.marketplace_settings (id, payment_instructions)
values (true, '')
on conflict (id) do nothing;

create or replace function public.update_marketplace_payment_instructions(
  p_instructions text,
  p_admin_id uuid,
  p_confirm_update_existing boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $update_marketplace_payment_instructions$
declare
  settings public.marketplace_settings%rowtype;
  awaiting_orders integer;
begin
  if p_instructions is null
    or char_length(p_instructions) > 5000
    or p_admin_id is null
    or p_confirm_update_existing is null then
    raise exception 'Enter payment instructions no longer than 5,000 characters.' using errcode = '22023';
  end if;

  select * into settings
  from public.marketplace_settings
  where id = true
  for update;
  if not found then
    raise exception 'Marketplace settings are not configured.' using errcode = 'P0002';
  end if;

  select count(*)::integer into awaiting_orders
  from public.marketplace_orders
  where payment_status = 'awaiting_payment';

  if awaiting_orders > 0 and not p_confirm_update_existing then
    return jsonb_build_object(
      'confirmation_required', true,
      'awaiting_payment_order_count', awaiting_orders
    );
  end if;

  update public.marketplace_settings
  set payment_instructions = btrim(p_instructions),
      payment_instructions_updated_at = now(),
      payment_instructions_updated_by = p_admin_id,
      updated_at = now()
  where id = true
  returning * into settings;

  return jsonb_build_object(
    'payment_instructions', settings.payment_instructions,
    'payment_instructions_updated_at', settings.payment_instructions_updated_at,
    'affected_order_count', awaiting_orders
  );
end;
$update_marketplace_payment_instructions$;

revoke all on function public.update_marketplace_payment_instructions(text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.update_marketplace_payment_instructions(text, uuid, boolean) to service_role;

notify pgrst, 'reload schema';
