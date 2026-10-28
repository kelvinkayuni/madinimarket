alter table public.marketplace_private_offers
  add column if not exists certificate_path text,
  add column if not exists certificate_file_name text,
  add column if not exists certificate_content_type text,
  add column if not exists decline_reason text,
  add column if not exists decline_explanation text,
  add column if not exists declined_at timestamptz;

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values (
  'private-offer-certificates',
  'private-offer-certificates',
  false,
  array['application/pdf', 'image/jpeg', 'image/png'],
  10485760
)
on conflict (id) do update set
  public = false,
  allowed_mime_types = excluded.allowed_mime_types,
  file_size_limit = excluded.file_size_limit;

notify pgrst, 'reload schema';
