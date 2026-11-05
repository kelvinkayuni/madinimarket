create or replace function private.lock_marketplace_cart_listing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $lock_marketplace_cart_listing$
declare
  selected_listing public.listings%rowtype;
begin
  select * into selected_listing
  from public.listings
  where id = new.listing_id
  for update;

  if not found or selected_listing.status <> 'approved'
    or selected_listing.is_active is not true
    or selected_listing.marketplace_state is distinct from 'available' then
    raise exception 'This mineral is no longer available to add to a cart.'
      using errcode = '22023';
  end if;

  return new;
end;
$lock_marketplace_cart_listing$;

revoke all on function private.lock_marketplace_cart_listing() from public, anon, authenticated;
drop trigger if exists lock_marketplace_cart_listing on public.marketplace_cart_items;
create trigger lock_marketplace_cart_listing
before insert or update of listing_id on public.marketplace_cart_items
for each row execute function private.lock_marketplace_cart_listing();

create or replace function public.manage_marketplace_user_post(
  p_website_user_id uuid,
  p_kind text,
  p_post_id bigint,
  p_action text,
  p_price numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $manage_marketplace_user_post$
declare
  listing_row public.listings%rowtype;
  request_row public.buy_requests%rowtype;
  fee_amount numeric;
  rounded_price numeric;
begin
  if p_website_user_id is null or p_kind is null or p_kind not in ('seller', 'buyer')
    or p_action is null or p_action not in ('delete', 'update_price')
    or p_post_id is null or p_post_id < 1 then
    raise exception 'Invalid marketplace post details.' using errcode = '22023';
  end if;
  if p_action = 'update_price' and (p_price is null or p_price <= 0) then
    raise exception 'Enter a price greater than zero.' using errcode = '22023';
  end if;

  if p_kind = 'seller' then
    select * into listing_row
    from public.listings
    where id = p_post_id and website_user_id = p_website_user_id
    for update;
    if not found then
      raise exception 'This mineral post no longer exists or does not belong to your account.'
        using errcode = 'P0002';
    end if;

    if p_action = 'update_price' and listing_row.status <> 'approved' then
      raise exception 'Only an approved market listing can have its price changed.'
        using errcode = '22023';
    end if;

    if exists (select 1 from public.marketplace_cart_items where listing_id = p_post_id) then
      raise exception 'This mineral is in a buyer cart. It cannot be changed or deleted until it is removed from the cart.'
        using errcode = '22023';
    end if;
    if exists (select 1 from public.marketplace_order_items where listing_id = p_post_id) then
      raise exception 'This mineral is linked to an order and cannot be changed or deleted.'
        using errcode = '22023';
    end if;

    if listing_row.status = 'approved' then
      if listing_row.is_active is not true or listing_row.marketplace_state is distinct from 'available' then
        raise exception 'This mineral is reserved or unavailable, so it cannot be changed or deleted.'
          using errcode = '22023';
      end if;
    elsif listing_row.status not in ('pending', 'rejected') then
      raise exception 'This mineral post can no longer be changed or deleted.'
        using errcode = '22023';
    end if;

    if p_action = 'delete' then
      delete from public.listings
      where id = p_post_id and website_user_id = p_website_user_id;
      return jsonb_build_object(
        'deleted', true,
        'image_path', listing_row.image_path,
        'stone_certificate_path', listing_row.stone_certificate_path
      );
    end if;

    rounded_price := round(p_price, case when listing_row.currency = 'TZS' then 0 else 2 end);
    if rounded_price <= 0 or rounded_price > 999999999999.99 then
      raise exception 'Enter a price within the supported range.'
        using errcode = '22023';
    end if;
    fee_amount := round(rounded_price * listing_row.platform_fee_rate, case when listing_row.currency = 'TZS' then 0 else 2 end);
    if rounded_price + fee_amount > 999999999999.99 then
      raise exception 'Enter a price within the supported range.'
        using errcode = '22023';
    end if;
    update public.listings
    set seller_price = rounded_price,
        platform_fee_amount = fee_amount,
        price = rounded_price + fee_amount
    where id = p_post_id and website_user_id = p_website_user_id;

    return jsonb_build_object(
      'deleted', false,
      'seller_price', rounded_price,
      'platform_fee_rate', listing_row.platform_fee_rate,
      'platform_fee_amount', fee_amount,
      'price', rounded_price + fee_amount
    );
  end if;

  select * into request_row
  from public.buy_requests
  where id = p_post_id and website_user_id = p_website_user_id
  for update;
  if not found then
    raise exception 'This buyer request no longer exists or does not belong to your account.'
      using errcode = 'P0002';
  end if;

  if exists (select 1 from public.marketplace_private_offer_threads where request_id = p_post_id) then
    raise exception 'A seller has already started a private offer for this request. It cannot be changed or deleted.'
      using errcode = '22023';
  end if;
  if p_action = 'update_price' and request_row.status <> 'approved' then
    raise exception 'Only an approved market request can have its price changed.'
      using errcode = '22023';
  end if;

  if request_row.status <> 'approved' and request_row.status not in ('pending', 'rejected') then
    raise exception 'This buyer request can no longer be changed or deleted.'
      using errcode = '22023';
  end if;

  if p_action = 'delete' then
    delete from public.buy_requests
    where id = p_post_id and website_user_id = p_website_user_id;
    return jsonb_build_object('deleted', true);
  end if;

  rounded_price := round(p_price, case when request_row.currency = 'TZS' then 0 else 2 end);
  if rounded_price <= 0 or rounded_price > 999999999999.99 then
    raise exception 'Enter a price within the supported range.'
      using errcode = '22023';
  end if;
  update public.buy_requests
  set offer = rounded_price
  where id = p_post_id and website_user_id = p_website_user_id;

  return jsonb_build_object('deleted', false, 'offer', rounded_price);
end;
$manage_marketplace_user_post$;

revoke all on function public.manage_marketplace_user_post(uuid, text, bigint, text, numeric) from public, anon, authenticated;
grant execute on function public.manage_marketplace_user_post(uuid, text, bigint, text, numeric) to service_role;
