create extension if not exists "pgcrypto";

create table if not exists public.support_threads (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique,
  website_user_id uuid not null references public.website_accounts(id) on delete cascade,
  category text not null check (category in ('Account','Subscription','Payment','Product listing','Order','Other')),
  subject text not null check (char_length(subject) between 3 and 160),
  status text not null default 'open' check (status in ('open','admin_replied','pending_user','resolved')),
  internal_note text not null default '',
  unread_by_admin boolean not null default true,
  unread_by_user boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_threads(id) on delete cascade,
  sender_type text not null check (sender_type in ('user','admin')),
  sender_id text,
  message text not null check (char_length(message) between 1 and 5000),
  created_at timestamptz not null default now()
);

create table if not exists public.support_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.support_messages(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  file_type text not null,
  file_size integer not null check (file_size between 1 and 4194304),
  created_at timestamptz not null default now()
);

create index if not exists support_threads_user_updated_idx on public.support_threads(website_user_id, updated_at desc);
create index if not exists support_threads_status_updated_idx on public.support_threads(status, updated_at desc);
create index if not exists support_messages_thread_created_idx on public.support_messages(thread_id, created_at asc);
create index if not exists support_attachments_message_idx on public.support_attachments(message_id);

alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_attachments enable row level security;

revoke all on public.support_threads from anon, authenticated;
revoke all on public.support_messages from anon, authenticated;
revoke all on public.support_attachments from anon, authenticated;
grant all on public.support_threads to service_role;
grant all on public.support_messages to service_role;
grant all on public.support_attachments to service_role;

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('support-attachments', 'support-attachments', false,
  array['application/pdf','image/jpeg','image/png'], 4194304)
on conflict (id) do update set
  public = false,
  allowed_mime_types = excluded.allowed_mime_types,
  file_size_limit = excluded.file_size_limit;
