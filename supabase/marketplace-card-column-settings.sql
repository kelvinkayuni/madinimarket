alter table public.marketplace_settings
  add column if not exists seller_cards_per_column integer not null default 4
    check (seller_cards_per_column >= 1),
  add column if not exists buyer_cards_per_column integer not null default 4
    check (buyer_cards_per_column >= 1);
