alter table public.marketplace_settings
  add column if not exists seller_cards_per_column integer not null default 4
    check (seller_cards_per_column >= 1),
  add column if not exists buyer_cards_per_column integer not null default 4
    check (buyer_cards_per_column >= 1),
  add column if not exists marketplace_card_appearance jsonb not null default
    '{"seller":{"alignment":"spread","titleColor":null,"titleDesktopSize":null,"titlePhoneSize":null,"priceColor":null,"priceDesktopSize":null,"pricePhoneSize":null,"detailsColor":null,"detailsDesktopSize":null,"detailsPhoneSize":null},"buyer":{"alignment":"spread","titleColor":null,"titleDesktopSize":null,"titlePhoneSize":null,"priceColor":null,"priceDesktopSize":null,"pricePhoneSize":null,"detailsColor":null,"detailsDesktopSize":null,"detailsPhoneSize":null}}'::jsonb;
