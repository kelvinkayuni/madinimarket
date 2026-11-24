alter table public.translation_pairs
  drop constraint if exists translation_pairs_english_phrase_check,
  drop constraint if exists translation_pairs_swahili_phrase_check;

alter table public.translation_pairs
  add constraint translation_pairs_english_phrase_check
    check (char_length(btrim(english_phrase)) between 1 and 1000),
  add constraint translation_pairs_swahili_phrase_check
    check (char_length(btrim(swahili_phrase)) between 1 and 1000);

notify pgrst, 'reload schema';
