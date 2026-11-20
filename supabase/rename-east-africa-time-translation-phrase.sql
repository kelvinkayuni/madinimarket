begin;

update public.translation_pairs as current_pair
set english_phrase = 'East Africa time'
where lower(btrim(current_pair.english_phrase)) = lower('Tanzania time')
  and not exists (
    select 1
    from public.translation_pairs as target_pair
    where target_pair.id <> current_pair.id
      and lower(btrim(target_pair.english_phrase)) = lower('East Africa time')
  );

do $$
begin
  if exists (
    select 1
    from public.translation_pairs
    where lower(btrim(english_phrase)) = lower('Tanzania time')
  ) and exists (
    select 1
    from public.translation_pairs
    where lower(btrim(english_phrase)) = lower('East Africa time')
  ) then
    raise notice 'Skipped translation rename because East Africa time already has a translation.';
  end if;
end $$;

commit;
