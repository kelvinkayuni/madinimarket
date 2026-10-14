create table if not exists public.website_account_certificates (
  id uuid primary key default gen_random_uuid(),
  website_user_id uuid not null references public.website_accounts (id) on delete cascade,
  kind text not null check (kind in ('dealer', 'broker')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_message text,
  file_name text not null,
  file_path text not null unique,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (website_user_id, kind)
);

alter table public.website_account_certificates enable row level security;
revoke all on public.website_account_certificates from anon, authenticated;
grant all on public.website_account_certificates to service_role;

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('account-certificates', 'account-certificates', false, array['application/pdf', 'image/jpeg', 'image/png'], 10485760)
on conflict (id) do update
set public = false, allowed_mime_types = excluded.allowed_mime_types, file_size_limit = excluded.file_size_limit;

create index if not exists website_account_certificates_status_idx
  on public.website_account_certificates (status, created_at);