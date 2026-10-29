alter table public.marketplace_private_offer_threads
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.website_accounts (id) on delete set null,
  add column if not exists close_reason text,
  add column if not exists buyer_deleted_at timestamptz,
  add column if not exists seller_deleted_at timestamptz;

create index if not exists marketplace_private_offer_threads_closed_deleted_idx
  on public.marketplace_private_offer_threads (state, buyer_deleted_at, seller_deleted_at, updated_at desc);
