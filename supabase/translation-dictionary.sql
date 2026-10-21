create table if not exists public.translation_pairs (
  id uuid primary key default gen_random_uuid(),
  english_phrase text not null check (char_length(btrim(english_phrase)) between 1 and 120),
  swahili_phrase text not null check (char_length(btrim(swahili_phrase)) between 1 and 120),
  created_at timestamptz not null default now()
);

create unique index if not exists translation_pairs_english_phrase_unique
  on public.translation_pairs (lower(btrim(english_phrase)));

alter table public.translation_pairs enable row level security;
revoke all on public.translation_pairs from anon, authenticated;
grant select on public.translation_pairs to anon, authenticated;
grant all on public.translation_pairs to service_role;

drop policy if exists "Anyone can read translation pairs" on public.translation_pairs;
create policy "Anyone can read translation pairs" on public.translation_pairs
  for select to anon, authenticated using (true);
