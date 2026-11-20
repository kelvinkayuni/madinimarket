alter table public.marketplace_settings
  add column if not exists swahili_enabled boolean not null default true,
  add column if not exists homepage_headline_font_size integer not null default 49
    check (homepage_headline_font_size between 24 and 72),
  add column if not exists welcome_hero_hidden boolean not null default false,
  add column if not exists welcome_hero_settings jsonb not null default
    '{"eyebrow":"","headline":"","description":"","sellLabel":"","requestLabel":"","exploreLinkLabel":"","buyerBrowseLinkLabel":"","backgroundColor":"#112e26","overlayColor":"#112e26","overlayOpacity":92,"headingColor":"#fffdf6","bodyColor":"#d0ddd4","accentColor":"#d8c99e","buttonColor":"#d2ee77","buttonTextColor":"#18382e","fontFamily":"serif","fontWeight":500,"desktopFontSize":72,"mobileFontSize":46,"heightMode":"default","desktopCopyHorizontalPosition":0,"desktopCopyVerticalPosition":0,"mobileCopyHorizontalPosition":0,"mobileCopyVerticalPosition":0,"desktopActionsHorizontalPosition":0,"desktopActionsVerticalPosition":85,"mobileActionsHorizontalPosition":0,"mobileActionsVerticalPosition":85,"desktopLinksHorizontalPosition":0,"desktopLinksVerticalPosition":100,"mobileLinksHorizontalPosition":0,"mobileLinksVerticalPosition":100,"publicHeaderPosition":0,"publicHeaderScale":100,"slides":[]}'::jsonb;

alter table public.marketplace_settings
  alter column welcome_hero_settings set default
    '{"eyebrow":"","headline":"","description":"","sellLabel":"","requestLabel":"","exploreLinkLabel":"","buyerBrowseLinkLabel":"","backgroundColor":"#112e26","overlayColor":"#112e26","overlayOpacity":92,"headingColor":"#fffdf6","bodyColor":"#d0ddd4","accentColor":"#d8c99e","buttonColor":"#d2ee77","buttonTextColor":"#18382e","fontFamily":"serif","fontWeight":500,"desktopFontSize":72,"mobileFontSize":46,"heightMode":"default","desktopCopyHorizontalPosition":0,"desktopCopyVerticalPosition":0,"mobileCopyHorizontalPosition":0,"mobileCopyVerticalPosition":0,"desktopActionsHorizontalPosition":0,"desktopActionsVerticalPosition":85,"mobileActionsHorizontalPosition":0,"mobileActionsVerticalPosition":85,"desktopLinksHorizontalPosition":0,"desktopLinksVerticalPosition":100,"mobileLinksHorizontalPosition":0,"mobileLinksVerticalPosition":100,"publicHeaderPosition":0,"publicHeaderScale":100,"slides":[]}'::jsonb;

update public.marketplace_settings
set welcome_hero_settings =
  '{"eyebrow":"","headline":"","description":"","sellLabel":"","requestLabel":"","backgroundColor":"#112e26","overlayColor":"#112e26","overlayOpacity":92,"headingColor":"#fffdf6","bodyColor":"#d0ddd4","accentColor":"#d8c99e","buttonColor":"#d2ee77","buttonTextColor":"#18382e","fontFamily":"serif","fontWeight":500,"desktopFontSize":72,"mobileFontSize":46,"heightMode":"default","actionsHorizontalPosition":0,"publicHeaderPosition":0,"publicHeaderScale":100,"slides":[]}'::jsonb
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

update public.marketplace_settings
set welcome_hero_settings = welcome_hero_settings || jsonb_build_object(
  'exploreLinkLabel', case
    when welcome_hero_settings->>'exploreLinkLabel' is null or welcome_hero_settings->>'exploreLinkLabel' = 'Explore minerals'
      then '""'::jsonb
    else welcome_hero_settings->'exploreLinkLabel'
  end,
  'buyerBrowseLinkLabel', case
    when welcome_hero_settings->>'buyerBrowseLinkLabel' is null or welcome_hero_settings->>'buyerBrowseLinkLabel' = 'Or browse what buyers are looking for'
      then '""'::jsonb
    else welcome_hero_settings->'buyerBrowseLinkLabel'
  end,
  'desktopCopyHorizontalPosition', coalesce(nullif(welcome_hero_settings->'desktopCopyHorizontalPosition', 'null'::jsonb), '0'::jsonb),
  'desktopCopyVerticalPosition', coalesce(nullif(welcome_hero_settings->'desktopCopyVerticalPosition', 'null'::jsonb), '0'::jsonb),
  'mobileCopyHorizontalPosition', coalesce(nullif(welcome_hero_settings->'mobileCopyHorizontalPosition', 'null'::jsonb), '0'::jsonb),
  'mobileCopyVerticalPosition', coalesce(nullif(welcome_hero_settings->'mobileCopyVerticalPosition', 'null'::jsonb), '0'::jsonb),
  'desktopActionsHorizontalPosition', coalesce(nullif(welcome_hero_settings->'desktopActionsHorizontalPosition', 'null'::jsonb), nullif(welcome_hero_settings->'actionsHorizontalPosition', 'null'::jsonb), '0'::jsonb),
  'desktopActionsVerticalPosition', coalesce(
    nullif(welcome_hero_settings->'desktopActionsVerticalPosition', 'null'::jsonb),
    case welcome_hero_settings->>'desktopActionsPosition'
      when 'middle' then '50'::jsonb
      when 'bottom' then '100'::jsonb
      else '85'::jsonb
    end
  ),
  'mobileActionsHorizontalPosition', coalesce(nullif(welcome_hero_settings->'mobileActionsHorizontalPosition', 'null'::jsonb), nullif(welcome_hero_settings->'actionsHorizontalPosition', 'null'::jsonb), '0'::jsonb),
  'mobileActionsVerticalPosition', coalesce(
    nullif(welcome_hero_settings->'mobileActionsVerticalPosition', 'null'::jsonb),
    case welcome_hero_settings->>'mobileActionsPosition'
      when 'middle' then '75'::jsonb
      when 'bottom' then '100'::jsonb
      else '85'::jsonb
    end
  ),
  'desktopLinksHorizontalPosition', coalesce(nullif(welcome_hero_settings->'desktopLinksHorizontalPosition', 'null'::jsonb), '0'::jsonb),
  'desktopLinksVerticalPosition', coalesce(nullif(welcome_hero_settings->'desktopLinksVerticalPosition', 'null'::jsonb), '100'::jsonb),
  'mobileLinksHorizontalPosition', coalesce(nullif(welcome_hero_settings->'mobileLinksHorizontalPosition', 'null'::jsonb), '0'::jsonb),
  'mobileLinksVerticalPosition', coalesce(nullif(welcome_hero_settings->'mobileLinksVerticalPosition', 'null'::jsonb), '100'::jsonb),
  'publicHeaderPosition', coalesce(
    nullif(welcome_hero_settings->'publicHeaderPosition', 'null'::jsonb),
    case
      when welcome_hero_settings->>'publicHeaderHorizontalPosition' ~ '^(5[0-9]|[6-9][0-9]|100)$'
        then to_jsonb(((welcome_hero_settings->>'publicHeaderHorizontalPosition')::integer - 50) * 2)
      else '0'::jsonb
    end
  ),
  'publicHeaderScale', coalesce(nullif(welcome_hero_settings->'publicHeaderScale', 'null'::jsonb), '100'::jsonb)
)
where welcome_hero_settings->>'exploreLinkLabel' is null
   or welcome_hero_settings->>'buyerBrowseLinkLabel' is null
   or welcome_hero_settings->>'exploreLinkLabel' = 'Explore minerals'
   or welcome_hero_settings->>'buyerBrowseLinkLabel' = 'Or browse what buyers are looking for'
   or welcome_hero_settings->>'desktopCopyHorizontalPosition' is null
   or welcome_hero_settings->>'desktopCopyVerticalPosition' is null
   or welcome_hero_settings->>'mobileCopyHorizontalPosition' is null
   or welcome_hero_settings->>'mobileCopyVerticalPosition' is null
   or welcome_hero_settings->>'desktopActionsHorizontalPosition' is null
   or welcome_hero_settings->>'desktopActionsVerticalPosition' is null
   or welcome_hero_settings->>'mobileActionsHorizontalPosition' is null
   or welcome_hero_settings->>'mobileActionsVerticalPosition' is null
   or welcome_hero_settings->>'desktopLinksHorizontalPosition' is null
   or welcome_hero_settings->>'desktopLinksVerticalPosition' is null
   or welcome_hero_settings->>'mobileLinksHorizontalPosition' is null
   or welcome_hero_settings->>'mobileLinksVerticalPosition' is null
   or welcome_hero_settings->>'publicHeaderPosition' is null
   or welcome_hero_settings->>'publicHeaderScale' is null;

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('homepage-hero', 'homepage-hero', true, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'], 20000000)
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
