import { NextResponse } from "next/server";

import { getWebsiteAccountId } from "@/lib/website-session";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { sendPendingSellerAvailabilityEmails } from "@/lib/marketplace-availability-email";

type Body = Record<string, unknown>;

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function readBody(request: Request): Promise<Body | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? body as Body : null;
  } catch {
    return null;
  }
}

async function sellerItemWithReceipt<T extends { payout_receipt_path?: string | null }>(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  item: T,
) {
  const { payout_receipt_path: receiptPath, ...safeItem } = item;
  if (!receiptPath) return safeItem;
  const { data, error } = await admin.storage.from("marketplace-seller-payout-receipts")
    .createSignedUrl(receiptPath, 10 * 60);
  if (error) {
    console.error("Could not create seller payout receipt link", error);
    throw error;
  }
  return { ...safeItem, payout_receipt_url: data.signedUrl };
}

export async function GET(request: Request) {
  const accountId = await getWebsiteAccountId(request);
  if (!accountId) return NextResponse.json({ error: "Sign in to view your cart and orders." }, { status: 401 });

  try {
    const admin = createSupabaseAdminClient();
    const url = new URL(request.url);
    const historyType = url.searchParams.get("history");
    if (historyType === "buyer" || historyType === "seller") {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const pageSize = historyType === "buyer" ? 50 : 100;
      if (!Number.isSafeInteger(offset) || offset < 0) {
        return NextResponse.json({ error: "Invalid order history page." }, { status: 400 });
      }
      if (historyType === "buyer") {
        const { data: orders, error } = await admin.from("marketplace_orders")
          .select("*, items:marketplace_order_items(*)")
          .eq("buyer_id", accountId)
          .order("created_at", { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (error) {
          console.error("Failed to load buyer order history", error);
          return NextResponse.json({ error: "Could not load buyer order history." }, { status: 503 });
        }
        const safeOrders = (orders ?? []).map((order) => ({
          ...order,
          items: ((order.items ?? []) as Record<string, unknown>[]).map((item) => Object.fromEntries(
            Object.entries(item).filter(([key]) => ![
              "seller_email", "seller_id", "payment_proof_path", "payout_receipt_path",
              "availability_email_sent_at", "availability_expired_at",
              "seller_availability_timeout_email_sent_at", "dispatch_email_sent_at",
            ].includes(key)),
          )),
        }));
        return NextResponse.json({ buyerOrders: safeOrders, hasMore: safeOrders.length === pageSize });
      }

      const { data: items, error } = await admin.from("marketplace_order_items")
        .select("*, order:marketplace_orders!inner(id, control_number, payment_status, payment_deadline, currency, created_at, buyer_name, buyer_phone, delivery_country, delivery_region, delivery_district, delivery_address)")
        .eq("seller_id", accountId)
        .order("created_at", { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) {
        console.error("Failed to load seller order history", error);
        return NextResponse.json({ error: "Could not load seller order history." }, { status: 503 });
      }
      const safeItems = await Promise.all((items ?? []).map(async (item) => {
        const order = Array.isArray(item.order) ? item.order[0] : item.order;
        const canSeeDelivery = ["paid", "shipped", "delivered", "disputed", "payout_due", "payout_paid", "refund_due", "refunded"].includes(item.status);
        return {
          ...await sellerItemWithReceipt(admin, item),
          order: order ? {
            id: order.id,
            control_number: order.control_number,
            payment_status: order.payment_status,
            payment_deadline: order.payment_deadline,
            currency: order.currency,
            created_at: order.created_at,
            ...(canSeeDelivery ? {
              buyer_name: order.buyer_name,
              buyer_phone: order.buyer_phone,
              delivery_country: order.delivery_country,
              delivery_region: order.delivery_region,
              delivery_district: order.delivery_district,
              delivery_address: order.delivery_address,
            } : {}),
          } : null,
        };
      }));
      return NextResponse.json({ sellerItems: safeItems, hasMore: safeItems.length === pageSize });
    }

    const [
      { data: profile, error: profileError },
      { data: cart, error: cartError },
      { data: buyerOrders, error: buyerOrdersError },
      { data: sellerItems, error: sellerItemsError },
      { data: buyerOrderStates, error: buyerOrderStatesError },
      { data: sellerOrderStates, error: sellerOrderStatesError },
      { count: sellingCount, error: sellingCountError },
      { count: buyingCount, error: buyingCountError },
      { count: privateOffersCount, error: privateOffersCountError },
      { data: activeSubscription, error: activeSubscriptionError },
      { data: marketplaceSettings, error: marketplaceSettingsError },
    ] = await Promise.all([
      admin.from("website_accounts").select("id, display_name, email, phone, delivery_country, delivery_region, delivery_district, delivery_address, is_active").eq("id", accountId).single(),
      admin.from("marketplace_cart_items").select("id, listing_id, created_at, listing:listings(id, mineral_name, listing_type, weight, unit, price, seller_price, platform_fee_amount, currency, image_path, website_user_id, seller_name, status, is_active, marketplace_state)").eq("buyer_id", accountId).order("created_at"),
      admin.from("marketplace_orders").select("*, items:marketplace_order_items(*)").eq("buyer_id", accountId).order("created_at", { ascending: false }).limit(50),
      admin.from("marketplace_order_items").select("*, order:marketplace_orders!inner(id, control_number, payment_status, payment_deadline, currency, created_at, buyer_name, buyer_phone, delivery_country, delivery_region, delivery_district, delivery_address)").eq("seller_id", accountId).order("created_at", { ascending: false }).limit(100),
      admin.from("marketplace_orders").select("id, payment_status, items:marketplace_order_items(status)").eq("buyer_id", accountId),
      admin.from("marketplace_order_items").select("order_id, status").eq("seller_id", accountId),
      admin.from("listings").select("id", { count: "exact", head: true }).eq("website_user_id", accountId).eq("status", "approved").eq("is_active", true),
      admin.from("buy_requests").select("id", { count: "exact", head: true }).eq("website_user_id", accountId).eq("status", "approved").eq("is_active", true),
      admin.from("marketplace_private_offer_threads").select("id", { count: "exact", head: true })
        .or(`buyer_id.eq.${accountId},seller_id.eq.${accountId}`),
      admin.from("account_subscriptions").select("id").eq("website_user_id", accountId).eq("status", "active").lte("starts_at", new Date().toISOString()).gt("expires_at", new Date().toISOString()).limit(1).maybeSingle(),
      admin.from("marketplace_settings").select("payment_methods, payment_instructions").eq("id", true).single(),
    ]);
    if (profileError || cartError || buyerOrdersError || sellerItemsError || buyerOrderStatesError || sellerOrderStatesError || sellingCountError || buyingCountError || privateOffersCountError || activeSubscriptionError || marketplaceSettingsError) {
      console.error("Failed to load commerce account data", profileError ?? cartError ?? buyerOrdersError ?? sellerItemsError ?? buyerOrderStatesError ?? sellerOrderStatesError ?? sellingCountError ?? buyingCountError ?? privateOffersCountError ?? activeSubscriptionError ?? marketplaceSettingsError);
      return NextResponse.json({ error: "Could not load your cart and orders." }, { status: 503 });
    }

    const completedItemStatuses = new Set(["unavailable", "payout_paid", "refunded", "expired", "cancelled"]);
    const closedPaymentStatuses = new Set(["expired", "cancelled"]);
    const buyerOpenOrderIds = new Set((buyerOrderStates ?? []).filter((order) => {
      if (closedPaymentStatuses.has(order.payment_status)) return false;
      const items = Array.isArray(order.items) ? order.items : [];
      return order.payment_status !== "paid" || items.length === 0 || items.some((item) => !completedItemStatuses.has(item.status));
    }).map((order) => order.id));
    const sellerOpenOrderIds = new Set((sellerOrderStates ?? [])
      .filter((item) => !completedItemStatuses.has(item.status))
      .map((item) => item.order_id));
    const buyerHistoryCount = (buyerOrderStates ?? []).length - buyerOpenOrderIds.size;
    const sellerHistoryItemCount = (sellerOrderStates ?? []).filter((item) => completedItemStatuses.has(item.status)).length;

    const safeSellerItems = await Promise.all((sellerItems ?? []).map(async (item) => {
      const order = Array.isArray(item.order) ? item.order[0] : item.order;
      const canSeeDelivery = ["paid", "shipped", "delivered", "disputed", "payout_due", "payout_paid", "refund_due", "refunded"].includes(item.status);
      return {
        ...await sellerItemWithReceipt(admin, item),
        order: order ? {
          id: order.id,
          control_number: order.control_number,
          payment_status: order.payment_status,
          payment_deadline: order.payment_deadline,
          currency: order.currency,
          created_at: order.created_at,
          ...(canSeeDelivery ? {
            buyer_name: order.buyer_name,
            buyer_phone: order.buyer_phone,
            delivery_country: order.delivery_country,
            delivery_region: order.delivery_region,
            delivery_district: order.delivery_district,
            delivery_address: order.delivery_address,
          } : {}),
        } : null,
      };
    }));
    const safeBuyerOrders = (buyerOrders ?? []).map((order) => ({
        ...order,
        items: ((order.items ?? []) as Record<string, unknown>[]).map((item) => Object.fromEntries(
          Object.entries(item).filter(([key]) => ![
            "seller_email", "seller_id", "payment_proof_path", "payout_receipt_path",
            "availability_email_sent_at", "availability_expired_at",
            "seller_availability_timeout_email_sent_at", "dispatch_email_sent_at",
          ].includes(key)),
        )),
    }));

    return NextResponse.json({
        profile,
        cartItems: cart ?? [],
        buyerOrders: safeBuyerOrders,
        buyerOrdersHasMore: (buyerOrders ?? []).length === 50,
        sellerItems: safeSellerItems,
        sellerItemsHasMore: (sellerItems ?? []).length === 100,
        sellerOpenOrdersCount: sellerOpenOrderIds.size,
        buyerOpenOrdersCount: buyerOpenOrderIds.size,
        buyerHistoryCount,
        sellerHistoryItemCount,
      privateOffersCount: privateOffersCount ?? 0,
      sellingCount: profile.is_active && activeSubscription ? sellingCount ?? 0 : 0,
      buyingCount: profile.is_active && activeSubscription ? buyingCount ?? 0 : 0,
      paymentMethods: marketplaceSettings.payment_methods,
      paymentInstructions: marketplaceSettings.payment_instructions.trim(),
    });
  } catch (error) {
    console.error("Commerce account request failed", error);
    return NextResponse.json({ error: "Could not load your cart and orders." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const accountId = await getWebsiteAccountId(request);
  if (!accountId) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const action = text(body.action, 40);

  try {
    const admin = createSupabaseAdminClient();
    if (action === "add_to_cart") {
      const listingId = Number(body.listingId);
      if (!Number.isSafeInteger(listingId) || listingId < 1) return NextResponse.json({ error: "Choose a valid listing." }, { status: 400 });
      const { data: listing, error: listingError } = await admin.from("listings")
        .select("id, website_user_id, currency, status, is_active, marketplace_state")
        .eq("id", listingId).maybeSingle();
      if (listingError) throw listingError;
      if (!listing || !listing.is_active || listing.status !== "approved" || listing.marketplace_state !== "available" || !listing.website_user_id) {
        return NextResponse.json({ error: "This listing is not available for checkout." }, { status: 409 });
      }
      if (listing.website_user_id === accountId) return NextResponse.json({ error: "You cannot buy your own listing." }, { status: 400 });
      const { data: sellerAccount, error: sellerAccountError } = await admin.from("website_accounts")
        .select("is_active").eq("id", listing.website_user_id).maybeSingle();
      if (sellerAccountError) throw sellerAccountError;
      if (!sellerAccount?.is_active) return NextResponse.json({ error: "This seller account is not available for checkout." }, { status: 409 });
      const { data: existingCart, error: existingError } = await admin.from("marketplace_cart_items")
        .select("listing_id, listing:listings(currency)").eq("buyer_id", accountId);
      if (existingError) throw existingError;
      if ((existingCart ?? []).some((item) => {
        const joined = Array.isArray(item.listing) ? item.listing[0] : item.listing;
        return joined?.currency !== listing.currency;
      })) return NextResponse.json({ error: "Keep each order in one currency. Remove the other-currency items first." }, { status: 409 });
      const { error } = await admin.from("marketplace_cart_items").upsert(
        { buyer_id: accountId, listing_id: listingId },
        { onConflict: "buyer_id,listing_id", ignoreDuplicates: true },
      );
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "remove_from_cart") {
      const cartItemId = text(body.cartItemId, 60);
      if (!/^[0-9a-f-]{36}$/i.test(cartItemId)) return NextResponse.json({ error: "Choose a valid cart item." }, { status: 400 });
      const { error } = await admin.from("marketplace_cart_items").delete().eq("id", cartItemId).eq("buyer_id", accountId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "delete_expired_order") {
      const orderId = text(body.orderId, 36);
      if (!/^[0-9a-f-]{36}$/i.test(orderId)) return NextResponse.json({ error: "Choose a valid expired order." }, { status: 400 });
      const { data: order, error: orderError } = await admin.from("marketplace_orders")
        .select("id, payment_status").eq("id", orderId).eq("buyer_id", accountId).maybeSingle();
      if (orderError) throw orderError;
      if (!order) return NextResponse.json({ error: "This order could not be found in your account." }, { status: 404 });
      if (order.payment_status !== "expired") {
        return NextResponse.json({ error: "Only expired orders can be deleted." }, { status: 409 });
      }
      const { error: itemsError } = await admin.from("marketplace_order_items").delete().eq("order_id", orderId);
      if (itemsError) throw itemsError;
      const { data: deletedOrder, error: deleteError } = await admin.from("marketplace_orders")
        .delete().eq("id", orderId).eq("buyer_id", accountId).eq("payment_status", "expired")
        .select("id").maybeSingle();
      if (deleteError) throw deleteError;
      if (!deletedOrder) return NextResponse.json({ error: "This expired order has already been deleted." }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    if (action === "checkout") {
      const { data: buyer, error: buyerError } = await admin.from("website_accounts")
        .select("display_name, email, phone").eq("id", accountId).single();
      if (buyerError) throw buyerError;
      const { data: createdOrder, error: createError } = await admin.rpc("create_marketplace_order", {
        p_buyer_id: accountId,
        p_buyer_name: text(body.buyerName, 120),
        p_buyer_email: buyer.email,
        p_buyer_phone: text(body.buyerPhone, 40),
        p_delivery_country: text(body.country, 100),
        p_delivery_region: text(body.region, 100),
        p_delivery_district: text(body.district, 100),
        p_delivery_address: text(body.address, 300),
      });
      if (createError) {
        if (createError.code === "22023" || createError.code === "42501") {
          return NextResponse.json({ error: createError.message }, { status: 400 });
        }
        throw createError;
      }
      if (!createdOrder || !buyer) throw new Error("Order creation returned incomplete data.");
      try {
        const notificationResult = await sendPendingSellerAvailabilityEmails(createdOrder.id);
        if (notificationResult.emailFailures > 0) {
          console.error(`Seller availability emails for order ${createdOrder.control_number} had ${notificationResult.emailFailures} failure(s); the order cron will retry.`);
        }
      } catch (notificationError) {
        console.error(`Could not send immediate seller availability emails for order ${createdOrder.control_number}; the order cron will retry.`, notificationError);
      }
      return NextResponse.json({ order: { id: createdOrder.id, control_number: createdOrder.control_number } }, { status: 201 });
    }

    if (action === "seller_availability") {
      const itemId = text(body.itemId, 60);
      if (!/^[0-9a-f-]{36}$/i.test(itemId) || typeof body.available !== "boolean") {
        return NextResponse.json({ error: "Choose Available or Unavailable." }, { status: 400 });
      }
      const { data, error } = await admin.rpc("respond_to_marketplace_order_item", {
        p_order_item_id: itemId,
        p_seller_id: accountId,
        p_available: body.available,
      });
      if (error) {
        if (error.code === "P0002" || error.code === "22023") return NextResponse.json({ error: error.message }, { status: 409 });
        throw error;
      }
      return NextResponse.json({ ok: true, finalized: data?.finalized ?? false, paymentStatus: data?.payment_status });
    }

    if (action === "relist_unavailable") {
      const itemId = text(body.itemId, 60);
      if (!/^[0-9a-f-]{36}$/i.test(itemId)) return NextResponse.json({ error: "Choose a valid unavailable order item." }, { status: 400 });
      const { data: orderItem, error: itemError } = await admin.from("marketplace_order_items")
        .select("listing_id")
        .eq("id", itemId)
        .eq("seller_id", accountId)
        .in("status", ["unavailable", "refunded"])
        .maybeSingle();
      if (itemError) throw itemError;
      if (!orderItem?.listing_id) return NextResponse.json({ error: "This unavailable mineral cannot be relisted." }, { status: 409 });

      const now = new Date().toISOString();
      const { data: subscription, error: subscriptionError } = await admin.from("account_subscriptions")
        .select("id")
        .eq("website_user_id", accountId)
        .eq("status", "active")
        .lte("starts_at", now)
        .gt("expires_at", now)
        .limit(1)
        .maybeSingle();
      if (subscriptionError) throw subscriptionError;
      if (!subscription) return NextResponse.json({ error: "An active seller subscription is required before relisting this mineral." }, { status: 403 });

      const { data: listing, error: listingError } = await admin.from("listings")
        .update({ marketplace_state: "available", is_active: true })
        .eq("id", orderItem.listing_id)
        .eq("website_user_id", accountId)
        .eq("status", "approved")
        .eq("marketplace_state", "seller_unavailable")
        .eq("is_active", false)
        .select("id")
        .maybeSingle();
      if (listingError) throw listingError;
      if (!listing) return NextResponse.json({ error: "This mineral has changed status and cannot be relisted. Refresh your orders and try again." }, { status: 409 });
      return NextResponse.json({ ok: true });
    }

    if (action === "seller_dispatch") {
      const itemId = text(body.itemId, 60);
      const carrier = text(body.carrier, 80);
      const trackingNumber = text(body.trackingNumber, 120);
      if (!/^[0-9a-f-]{36}$/i.test(itemId) || !carrier || !trackingNumber) {
        return NextResponse.json({ error: "Enter the delivery carrier and tracking number." }, { status: 400 });
      }
      const { data, error } = await admin.from("marketplace_order_items").update({
        status: "shipped",
        shipped_at: new Date().toISOString(),
        shipping_carrier: carrier,
        tracking_number: trackingNumber,
      }).eq("id", itemId).eq("seller_id", accountId).eq("status", "paid")
        .select("id").maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "This order item is not ready to dispatch." }, { status: 409 });
      return NextResponse.json({ ok: true });
    }

    if (action === "confirm_receipt" || action === "dispute_delivery") {
      const itemId = text(body.itemId, 60);
      if (!/^[0-9a-f-]{36}$/i.test(itemId)) return NextResponse.json({ error: "Invalid order item." }, { status: 400 });
      if (action === "confirm_receipt") {
        const { data: buyerOrders, error: buyerOrdersError } = await admin.from("marketplace_orders")
          .select("id").eq("buyer_id", accountId);
        if (buyerOrdersError) throw buyerOrdersError;
        const { data, error } = await admin.from("marketplace_order_items").update({
          status: "payout_due",
          buyer_received_at: new Date().toISOString(),
          payout_due_at: new Date().toISOString(),
        }).eq("id", itemId).eq("status", "delivered")
          .in("order_id", (buyerOrders ?? []).map((order) => order.id))
          .select("id").maybeSingle();
        if (error) throw error;
        if (!data) return NextResponse.json({ error: "Only the buyer can confirm an item marked delivered." }, { status: 409 });
      } else {
        const reason = text(body.reason, 500);
        if (reason.length < 10) return NextResponse.json({ error: "Please explain the delivery issue (at least 10 characters)." }, { status: 400 });
        const { data: orders, error: ordersError } = await admin.from("marketplace_orders").select("id").eq("buyer_id", accountId);
        if (ordersError) throw ordersError;
        const { data, error } = await admin.from("marketplace_order_items").update({
          status: "disputed",
          disputed_at: new Date().toISOString(),
          dispute_reason: reason,
        }).eq("id", itemId).in("status", ["shipped", "delivered", "payout_due"])
          .in("order_id", (orders ?? []).map((order) => order.id)).select("id").maybeSingle();
        if (error) throw error;
        if (!data) return NextResponse.json({ error: "This item cannot be disputed in its current state." }, { status: 409 });
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown commerce action." }, { status: 400 });
  } catch (error) {
    console.error("Commerce action failed", error);
    return NextResponse.json({ error: "The request could not be completed. Please try again." }, { status: 503 });
  }
}
