alter table public.marketplace_orders
  add column if not exists buyer_history_hidden_at timestamptz;

alter table public.marketplace_order_items
  add column if not exists seller_history_hidden_at timestamptz;

notify pgrst, 'reload schema';
