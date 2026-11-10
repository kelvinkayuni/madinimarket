alter table public.staff_members
  alter column employee_code drop expression,
  alter column employee_code set not null;

create table if not exists public.staff_employee_code_reservations (
  employee_code text primary key,
  reserved_at timestamptz not null default now(),
  constraint staff_employee_code_reservations_format
    check (employee_code ~ '^MMSA-[0-9]+$')
);

alter table public.staff_employee_code_reservations enable row level security;
revoke all on public.staff_employee_code_reservations from public, anon, authenticated;
grant all on public.staff_employee_code_reservations to service_role;

insert into public.staff_employee_code_reservations (employee_code)
select employee_code
from public.staff_members
on conflict (employee_code) do nothing;

insert into public.staff_employee_code_reservations (employee_code)
select distinct staff_employee_code
from public.staff_audit_log
where staff_employee_code ~ '^MMSA-[0-9]+$'
on conflict (employee_code) do nothing;

insert into public.staff_employee_code_reservations (employee_code)
select distinct username
from public.profiles
where username ~ '^MMSA-[0-9]+$'
on conflict (employee_code) do nothing;

create or replace function public.reserve_staff_employee_code()
returns text
language plpgsql
security definer
set search_path = ''
as $reserve_staff_employee_code$
declare
  candidate text;
  reserved_code text;
begin
  loop
    select 'MMSA-' || available.code::text into candidate
    from pg_catalog.generate_series(1000, 9999) as available(code)
    where not exists (
      select 1
      from public.staff_employee_code_reservations as reservation
      where reservation.employee_code = 'MMSA-' || available.code::text
    )
      and not exists (
        select 1
        from public.profiles as profile
        where profile.username = 'MMSA-' || available.code::text
      )
      and not exists (
        select 1
        from public.staff_members as staff
        where staff.employee_code = 'MMSA-' || available.code::text
      )
    order by pg_catalog.random()
    limit 1;

    if candidate is null then
      raise exception 'No unused four-digit staff usernames remain.';
    end if;

    reserved_code := null;
    insert into public.staff_employee_code_reservations (employee_code)
    values (candidate)
    on conflict (employee_code) do nothing
    returning employee_code into reserved_code;

    if reserved_code is not null then
      return reserved_code;
    end if;
  end loop;
end;
$reserve_staff_employee_code$;

revoke all on function public.reserve_staff_employee_code() from public, anon, authenticated;
grant execute on function public.reserve_staff_employee_code() to service_role;
