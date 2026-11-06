drop policy if exists "Public can read approved mineral images" on storage.objects;
create policy "Public can read approved mineral images" on storage.objects for select to anon, authenticated
using (
  bucket_id = 'mineral-images'
  and exists (
    select 1
    from public.marketplace_listings
    where image_path = name
      or image_gallery_paths @> array[name]::text[]
  )
);
