begin;

with phrase_changes(old_phrase, new_phrase) as (
  values
    ('WANTED', 'NEEDED'),
    ('Buyers looking', 'Buyer requests'),
    ('WANTED BY THE COMMUNITY', 'MARKET DEMAND')
)
update public.translation_pairs as current_pair
set english_phrase = phrase_changes.new_phrase
from phrase_changes
where lower(btrim(current_pair.english_phrase)) = lower(phrase_changes.old_phrase)
  and not exists (
    select 1
    from public.translation_pairs as target_pair
    where target_pair.id <> current_pair.id
      and lower(btrim(target_pair.english_phrase)) = lower(phrase_changes.new_phrase)
  );

do $$
declare
  skipped_phrases text;
begin
  select string_agg(changes.old_phrase || ' -> ' || changes.new_phrase, ', ')
  into skipped_phrases
  from (values
    ('WANTED', 'NEEDED'),
    ('Buyers looking', 'Buyer requests'),
    ('WANTED BY THE COMMUNITY', 'MARKET DEMAND')
  ) as changes(old_phrase, new_phrase)
  where exists (
    select 1
    from public.translation_pairs as old_pair
    where lower(btrim(old_pair.english_phrase)) = lower(changes.old_phrase)
  )
    and exists (
      select 1
      from public.translation_pairs as new_pair
      where lower(btrim(new_pair.english_phrase)) = lower(changes.new_phrase)
    );

  if skipped_phrases is not null then
    raise notice 'Skipped translation renames because target phrases already have translations: %', skipped_phrases;
  end if;
end $$;

commit;
