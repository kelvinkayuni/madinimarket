alter table public.marketplace_settings
  add column if not exists homepage_headline_speed_seconds integer not null default 36
    check (homepage_headline_speed_seconds between 10 and 120);
