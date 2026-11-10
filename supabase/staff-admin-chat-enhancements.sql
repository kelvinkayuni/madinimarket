alter table public.staff_admin_conversations
  add column if not exists last_read_by_admin timestamptz not null default now(),
  add column if not exists last_read_by_staff timestamptz not null default now(),
  add column if not exists admin_cleared_at timestamptz,
  add column if not exists staff_cleared_at timestamptz;

alter table public.staff_admin_messages
  add column if not exists seen_by_admin_at timestamptz,
  add column if not exists seen_by_staff_at timestamptz,
  add column if not exists reply_to_message_id uuid references public.staff_admin_messages(id) on delete set null,
  add column if not exists reply_to_sender_type text check (reply_to_sender_type in ('staff', 'admin')),
  add column if not exists reply_to_message text;

alter table public.staff_admin_messages
  drop constraint if exists staff_admin_messages_reply_snapshot_check;
alter table public.staff_admin_messages
  add constraint staff_admin_messages_reply_snapshot_check check (
    (reply_to_sender_type is null and reply_to_message is null)
    or (reply_to_sender_type is not null and reply_to_message is not null)
  );

create index if not exists staff_admin_messages_unread_count_idx
  on public.staff_admin_messages(conversation_id, sender_type, created_at);

create table if not exists public.staff_admin_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.staff_admin_messages(id) on delete cascade,
  file_name text not null,
  file_path text not null unique,
  file_type text not null check (file_type in (
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )),
  file_size integer not null check (file_size between 1 and 10485760),
  created_at timestamptz not null default now()
);

create index if not exists staff_admin_attachments_message_idx
  on public.staff_admin_attachments(message_id);

alter table public.staff_admin_attachments enable row level security;
revoke all on public.staff_admin_attachments from anon, authenticated;
grant all on public.staff_admin_attachments to service_role;

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values (
  'staff-admin-attachments',
  'staff-admin-attachments',
  false,
  array[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ],
  10485760
)
on conflict (id) do update set
  public = false,
  allowed_mime_types = excluded.allowed_mime_types,
  file_size_limit = excluded.file_size_limit;
