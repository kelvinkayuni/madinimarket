begin;

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('homepage-hero', 'homepage-hero', true, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'], 20000000)
on conflict (id) do update
set public = true, allowed_mime_types = excluded.allowed_mime_types, file_size_limit = excluded.file_size_limit;

commit;
