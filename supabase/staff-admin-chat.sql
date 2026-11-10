create table if not exists public.staff_admin_conversations (
  id uuid primary key default gen_random_uuid(),
  staff_member_id bigint not null unique references public.staff_members(id) on delete cascade,
  unread_by_admin boolean not null default false,
  unread_by_staff boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists public.staff_admin_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.staff_admin_conversations(id) on delete cascade,
  sender_type text not null check (sender_type in ('staff', 'admin')),
  sender_staff_member_id bigint,
  message text not null check (char_length(message) between 1 and 5000),
  created_at timestamptz not null default now(),
  check (
    (sender_type = 'staff' and sender_staff_member_id is not null)
    or (sender_type = 'admin' and sender_staff_member_id is null)
  )
);

create index if not exists staff_admin_conversations_updated_idx
  on public.staff_admin_conversations(last_message_at desc);
create index if not exists staff_admin_messages_conversation_created_idx
  on public.staff_admin_messages(conversation_id, created_at asc);

alter table public.staff_admin_conversations enable row level security;
alter table public.staff_admin_messages enable row level security;
revoke all on public.staff_admin_conversations, public.staff_admin_messages from anon, authenticated;
grant all on public.staff_admin_conversations, public.staff_admin_messages to service_role;
