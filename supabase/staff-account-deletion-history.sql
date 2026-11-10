alter table public.staff_audit_log
  add column if not exists staff_employee_code text,
  add column if not exists staff_full_name text;

update public.staff_audit_log as audit
set staff_employee_code = staff.employee_code,
    staff_full_name = staff.full_name
from public.staff_members as staff
where audit.staff_member_id = staff.id
  and (audit.staff_employee_code is null or audit.staff_full_name is null);

create or replace function public.capture_staff_audit_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $capture_staff_audit_identity$
begin
  if new.staff_member_id is not null then
    select staff.employee_code, staff.full_name
    into new.staff_employee_code, new.staff_full_name
    from public.staff_members as staff
    where staff.id = new.staff_member_id;
  end if;
  return new;
end;
$capture_staff_audit_identity$;

drop trigger if exists capture_staff_audit_identity on public.staff_audit_log;
create trigger capture_staff_audit_identity
before insert on public.staff_audit_log
for each row execute function public.capture_staff_audit_identity();
