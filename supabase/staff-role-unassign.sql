create or replace function public.replace_staff_role_assignments(
  p_staff_member_id bigint,
  p_role_ids bigint[],
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $replace_staff_role_assignments$
declare
  selected_count integer;
begin
  p_role_ids := coalesce(p_role_ids, '{}'::bigint[]);

  perform 1 from public.staff_members where id = p_staff_member_id for update;
  if not found then
    raise exception 'Staff member not found.' using errcode = 'P0002';
  end if;

  select count(*) into selected_count
  from public.staff_roles
  where id = any(p_role_ids);
  if selected_count <> cardinality(p_role_ids) then
    raise exception 'One or more selected roles are no longer available.' using errcode = '22023';
  end if;

  delete from public.staff_member_roles where staff_member_id = p_staff_member_id;
  insert into public.staff_member_roles (staff_member_id, role_id, assigned_by)
  select p_staff_member_id, selected_role_id, p_actor_user_id
  from unnest(p_role_ids) as selected_role_id;

  insert into public.staff_audit_log (
    actor_user_id, staff_member_id, action, entity_type, entity_id, details
  ) values (
    p_actor_user_id, p_staff_member_id, 'staff_roles_updated',
    'staff_member', p_staff_member_id::text,
    jsonb_build_object('role_ids', p_role_ids)
  );
end;
$replace_staff_role_assignments$;

revoke all on function public.replace_staff_role_assignments(bigint, bigint[], uuid)
  from public, anon, authenticated;
grant execute on function public.replace_staff_role_assignments(bigint, bigint[], uuid)
  to service_role;

notify pgrst, 'reload schema';
