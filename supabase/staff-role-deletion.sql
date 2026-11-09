alter table public.staff_member_roles
  drop constraint if exists staff_member_roles_role_id_fkey;

alter table public.staff_member_roles
  add constraint staff_member_roles_role_id_fkey
  foreign key (role_id)
  references public.staff_roles (id)
  on delete restrict;

create or replace function public.delete_unassigned_staff_role(
  p_role_id bigint,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $delete_unassigned_staff_role$
declare
  selected_role public.staff_roles%rowtype;
begin
  select * into selected_role
  from public.staff_roles
  where id = p_role_id
  for update;
  if not found then
    raise exception 'Staff role not found.' using errcode = 'P0002';
  end if;

  begin
    delete from public.staff_roles where id = p_role_id;
  exception when foreign_key_violation then
    raise exception 'This role is assigned to staff and cannot be deleted.' using errcode = '23503';
  end;

  insert into public.staff_audit_log (
    actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_actor_user_id, 'staff_role_deleted', 'staff_role', p_role_id::text,
    jsonb_build_object('name', selected_role.name, 'permissions', selected_role.permissions)
  );
end;
$delete_unassigned_staff_role$;

revoke all on function public.delete_unassigned_staff_role(bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_unassigned_staff_role(bigint, uuid)
  to service_role;

notify pgrst, 'reload schema';
