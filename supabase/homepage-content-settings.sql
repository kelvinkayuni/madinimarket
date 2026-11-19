alter table public.marketplace_settings
  add column if not exists swahili_enabled boolean not null default true,
  add column if not exists homepage_headline_font_size integer not null default 49
    check (homepage_headline_font_size between 24 and 72),
  add column if not exists welcome_hero_hidden boolean not null default false,
  add column if not exists welcome_hero_settings jsonb not null default
    '{"eyebrow":"","headline":"","description":"","sellLabel":"","requestLabel":"","backgroundColor":"#112e26","overlayColor":"#112e26","overlayOpacity":92,"headingColor":"#fffdf6","bodyColor":"#d0ddd4","accentColor":"#d8c99e","buttonColor":"#d2ee77","buttonTextColor":"#18382e","fontFamily":"serif","fontWeight":500,"desktopFontSize":72,"mobileFontSize":46,"heightMode":"default","mobileActionsPosition":"top","actionsHorizontalPosition":0,"slides":[]}'::jsonb;

alter table public.marketplace_settings
  alter column welcome_hero_settings set default
    '{"eyebrow":"","headline":"","description":"","sellLabel":"","requestLabel":"","backgroundColor":"#112e26","overlayColor":"#112e26","overlayOpacity":92,"headingColor":"#fffdf6","bodyColor":"#d0ddd4","accentColor":"#d8c99e","buttonColor":"#d2ee77","buttonTextColor":"#18382e","fontFamily":"serif","fontWeight":500,"desktopFontSize":72,"mobileFontSize":46,"heightMode":"default","mobileActionsPosition":"top","actionsHorizontalPosition":0,"slides":[]}'::jsonb;

update public.marketplace_settings
set welcome_hero_settings =
  '{"eyebrow":"","headline":"","description":"","sellLabel":"","requestLabel":"","backgroundColor":"#112e26","overlayColor":"#112e26","overlayOpacity":92,"headingColor":"#fffdf6","bodyColor":"#d0ddd4","accentColor":"#d8c99e","buttonColor":"#d2ee77","buttonTextColor":"#18382e","fontFamily":"serif","fontWeight":500,"desktopFontSize":72,"mobileFontSize":46,"heightMode":"default","actionsHorizontalPosition":0,"slides":[]}'::jsonb
where welcome_hero_settings =
  '{"eyebrow":"TANZANIA AND BEYOND","headline":"Discover the stones that move us.","description":"Explore mineral listings, connect with people looking to buy, and find your place in Tanzania’s mineral market.","exploreLabel":"Explore minerals","requestLabel":"Post a request","backgroundColor":"#112e26","overlayColor":"#112e26","overlayOpacity":92,"headingColor":"#fffdf6","bodyColor":"#d0ddd4","accentColor":"#d8c99e","buttonColor":"#d2ee77","buttonTextColor":"#18382e","fontFamily":"serif","fontWeight":500,"desktopFontSize":72,"mobileFontSize":46,"slides":[]}'::jsonb;

update public.marketplace_settings
set welcome_hero_settings = jsonb_set(welcome_hero_settings, '{heightMode}', '"default"'::jsonb, true)
where not (welcome_hero_settings ? 'heightMode');

update public.marketplace_settings
set welcome_hero_settings = (welcome_hero_settings - 'exploreLabel') ||
  jsonb_build_object(
    'sellLabel',
    case
      when welcome_hero_settings->>'exploreLabel' = 'Explore minerals' then 'Sell a mineral'
      else welcome_hero_settings->>'exploreLabel'
    end
  )
where welcome_hero_settings ? 'exploreLabel'
  and not (welcome_hero_settings ? 'sellLabel');

update public.marketplace_settings
set welcome_hero_settings = jsonb_set(welcome_hero_settings, '{mobileActionsPosition}', '"top"'::jsonb, true)
where welcome_hero_settings->>'mobileActionsPosition' is null;

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('homepage-hero', 'homepage-hero', true, array['image/jpeg'], 1258291)
on conflict (id) do update
set public = true, allowed_mime_types = excluded.allowed_mime_types, file_size_limit = excluded.file_size_limit;

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
