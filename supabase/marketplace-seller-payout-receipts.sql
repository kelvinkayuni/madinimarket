alter table public.marketplace_order_items
  add column if not exists payout_receipt_path text;

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values (
  'marketplace-seller-payout-receipts',
  'marketplace-seller-payout-receipts',
  false,
  array['application/pdf', 'image/jpeg', 'image/png'],
  4194304
)
on conflict (id) do update set
  public = false,
  allowed_mime_types = excluded.allowed_mime_types,
  file_size_limit = excluded.file_size_limit;
