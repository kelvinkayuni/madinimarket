alter table public.marketplace_settings
  add column if not exists swahili_enabled boolean not null default true,
  add column if not exists homepage_headline_font_size integer not null default 49
    check (homepage_headline_font_size between 24 and 72);

create table if not exists public.homepage_headlines (
  id uuid primary key default gen_random_uuid(),
  main_phrase text not null default '' check (char_length(btrim(main_phrase)) <= 120),
  accent_phrase text not null default '' check (char_length(btrim(accent_phrase)) <= 120),
  created_at timestamptz not null default now(),
  constraint homepage_headlines_phrase_required check (
    char_length(btrim(main_phrase)) > 0 or char_length(btrim(accent_phrase)) > 0
  )
);

alter table public.homepage_headlines enable row level security;
revoke all on public.homepage_headlines from public, anon, authenticated;
grant all on public.homepage_headlines to service_role;
