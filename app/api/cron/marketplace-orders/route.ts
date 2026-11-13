import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { sendGmailEmail } from "@/lib/gmail";
import { sendPendingSellerAvailabilityEmails } from "@/lib/marketplace-availability-email";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getPublicAppUrl } from "@/lib/public-app-url";

export const maxDuration = 300;

function isAuthorized(request: Request) {
  const configuredSecret = process.env.CRON_SECRET;
  const suppliedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!configuredSecret || !suppliedSecret) return false;
  const expected = Buffer.from(configuredSecret);
  const received = Buffer.from(suppliedSecret);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function escapeHtml(value: string) {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const admin = createSupabaseAdminClient();
    const { data: processed, error: processError } = await admin.rpc("process_marketplace_orders");
    if (processError) throw processError;
    const { data: processedPrivateOffers, error: privateOfferProcessError } = await admin.rpc("process_marketplace_private_offer_checkouts");
    if (privateOfferProcessError) throw privateOfferProcessError;
    let sentCount = 0;
    let emailFailures = 0;

    const offerClaimCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: pendingPrivateOffers, error: pendingPrivateOffersError } = await admin.from("marketplace_private_offers")
      .select("id, thread_id, mineral_name, total_price, currency")
      .eq("status", "pending")
      .is("buyer_offer_email_sent_at", null)
      .or(`buyer_offer_email_claimed_at.is.null,buyer_offer_email_claimed_at.lt.${offerClaimCutoff}`)
      .order("created_at")
      .limit(10);
    if (pendingPrivateOffersError) throw pendingPrivateOffersError;

    for (const offer of pendingPrivateOffers ?? []) {
      const claimedAt = new Date().toISOString();
      const { data: claimedOffer, error: claimError } = await admin.from("marketplace_private_offers")
        .update({ buyer_offer_email_claimed_at: claimedAt })
        .eq("id", offer.id)
        .eq("status", "pending")
        .is("buyer_offer_email_sent_at", null)
        .or(`buyer_offer_email_claimed_at.is.null,buyer_offer_email_claimed_at.lt.${offerClaimCutoff}`)
        .select("id")
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimedOffer) continue;

      try {
        const { data: thread, error: threadError } = await admin.from("marketplace_private_offer_threads")
          .select("buyer_id, seller_id")
          .eq("id", offer.thread_id)
          .maybeSingle();
        if (threadError) throw threadError;
        if (!thread) throw new Error("The private-offer thread no longer exists.");

        const { data: accounts, error: accountsError } = await admin.from("website_accounts")
          .select("id, email, username, display_name")
          .in("id", [thread.buyer_id, thread.seller_id]);
        if (accountsError) throw accountsError;
        const buyer = (accounts ?? []).find((account) => account.id === thread.buyer_id);
        const seller = (accounts ?? []).find((account) => account.id === thread.seller_id);
        if (!buyer?.email) throw new Error("The buyer email address is unavailable.");

        const signInUrl = new URL("/", getPublicAppUrl());
        signInUrl.searchParams.set("signin", "1");
        signInUrl.searchParams.set("returnTo", "orders");
        await sendGmailEmail({
          to: buyer.email,
          subject: `New private mineral offer from ${seller?.username ?? "a Madinimarket seller"}`,
          text: `Hello ${buyer.display_name ?? "buyer"},\n\n${seller?.username ?? "A seller"} has sent you a private offer for ${offer.mineral_name}. The total price is ${offer.currency} ${Number(offer.total_price).toLocaleString()}.\n\nSign in to review the mineral details and certificate (if provided), then accept or decline the offer. Accepting does not charge you; you will still confirm checkout details and submit payment proof for admin verification.\n\n${signInUrl.toString()}\n\nMadinimarket`,
        });
        const { error: sentUpdateError } = await admin.from("marketplace_private_offers")
          .update({
            buyer_offer_email_sent_at: new Date().toISOString(),
            buyer_offer_email_claimed_at: null,
          })
          .eq("id", offer.id)
          .eq("buyer_offer_email_claimed_at", claimedAt)
          .is("buyer_offer_email_sent_at", null);
        if (sentUpdateError) throw sentUpdateError;
        sentCount += 1;
      } catch (error) {
        emailFailures += 1;
        console.error(`Private offer notification failed for offer ${offer.id}`, error);
        const { error: releaseError } = await admin.from("marketplace_private_offers")
          .update({ buyer_offer_email_claimed_at: null })
          .eq("id", offer.id)
          .eq("buyer_offer_email_claimed_at", claimedAt)
          .is("buyer_offer_email_sent_at", null);
        if (releaseError) console.error("Could not release failed private offer email claim for retry.", releaseError);
      }
    }

    const availabilityNotifications = await sendPendingSellerAvailabilityEmails();
    sentCount += availabilityNotifications.sentCount;
    emailFailures += availabilityNotifications.emailFailures;

    const { data: expiredAvailabilityItems, error: expiredAvailabilityError } = await admin.from("marketplace_order_items")
      .select("id, seller_email, mineral_name, order:marketplace_orders!inner(control_number, seller_response_deadline)")
      .eq("status", "expired")
      .not("availability_expired_at", "is", null)
      .is("seller_availability_timeout_email_sent_at", null)
      .limit(5);
    if (expiredAvailabilityError) throw expiredAvailabilityError;
    for (const item of expiredAvailabilityItems ?? []) {
      const order = Array.isArray(item.order) ? item.order[0] : item.order;
      const responseDeadline = order.seller_response_deadline
        ? new Date(order.seller_response_deadline).toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam" })
        : "the seller response deadline";
      try {
        await sendGmailEmail({
          to: item.seller_email,
          subject: `Availability request expired for order ${order.control_number}`,
          text: `The availability response deadline (${responseDeadline} Tanzania time) passed for ${item.mineral_name} in order ${order.control_number}. This order item was cancelled for the buyer, and the listing has been released back to the public market for other buyers.\n\nMadinimarket`,
        });
        const { error } = await admin.from("marketplace_order_items")
          .update({ seller_availability_timeout_email_sent_at: new Date().toISOString() })
          .eq("id", item.id)
          .is("seller_availability_timeout_email_sent_at", null);
        if (error) throw error;
        sentCount += 1;
      } catch (error) {
        emailFailures += 1;
        console.error(`Availability timeout notification failed for order item ${item.id}`, error);
      }
    }

    const [sellerUnavailableBuyerItems, sellerTimeoutBuyerItems] = await Promise.all([
      admin.from("marketplace_order_items")
        .select("id, status, mineral_name, availability_expired_at, order:marketplace_orders!inner(control_number, buyer_email, buyer_name, payment_status)")
        .eq("status", "unavailable")
        .is("buyer_availability_result_email_sent_at", null)
        .limit(20),
      admin.from("marketplace_order_items")
        .select("id, status, mineral_name, availability_expired_at, order:marketplace_orders!inner(control_number, buyer_email, buyer_name, payment_status)")
        .eq("status", "expired")
        .not("availability_expired_at", "is", null)
        .is("buyer_availability_result_email_sent_at", null)
        .limit(20),
    ]);
    if (sellerUnavailableBuyerItems.error) throw sellerUnavailableBuyerItems.error;
    if (sellerTimeoutBuyerItems.error) throw sellerTimeoutBuyerItems.error;
    const buyerAvailabilityItems = [
      ...(sellerUnavailableBuyerItems.data ?? []),
      ...(sellerTimeoutBuyerItems.data ?? []),
    ];
    const reclaimBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    for (const item of buyerAvailabilityItems) {
      const order = Array.isArray(item.order) ? item.order[0] : item.order;
      if (!order) {
        emailFailures += 1;
        console.error(`Buyer availability result email has no parent order for item ${item.id}`);
        continue;
      }
      const claimedAt = new Date().toISOString();
      const { data: claimedItem, error: claimError } = await admin.from("marketplace_order_items")
        .update({ buyer_availability_result_email_claimed_at: claimedAt })
        .eq("id", item.id)
        .is("buyer_availability_result_email_sent_at", null)
        .or(`buyer_availability_result_email_claimed_at.is.null,buyer_availability_result_email_claimed_at.lt.${reclaimBefore}`)
        .select("id")
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimedItem) continue;

      const isUnavailable = item.status === "unavailable" && !item.availability_expired_at;
      const statusText = isUnavailable
        ? "The seller confirmed that this mineral is unavailable, so it has been removed from the public market."
        : "The seller did not respond before the deadline. This item has been cancelled for you and released back to the market for other buyers.";
      const orderNextStep = order.payment_status === "awaiting_payment"
        ? "You can proceed with payment for the other confirmed items shown in My orders."
        : order.payment_status === "cancelled"
          ? "No items in this order were confirmed, so the order is cancelled."
          : "Any other items in this order will be updated as their sellers respond.";
      try {
        await sendGmailEmail({
          to: order.buyer_email,
          subject: `Availability update for ${item.mineral_name} · order ${order.control_number}`,
          text: `Hello ${order.buyer_name},\n\n${statusText}\n\nNo payment is due for this item. ${orderNextStep}\n\nView your order history in My orders.\n\nMadinimarket`,
        });
        const { error: sentUpdateError } = await admin.from("marketplace_order_items")
          .update({
            buyer_availability_result_email_sent_at: new Date().toISOString(),
            buyer_availability_result_email_claimed_at: null,
          })
          .eq("id", item.id)
          .eq("buyer_availability_result_email_claimed_at", claimedAt)
          .is("buyer_availability_result_email_sent_at", null);
        if (sentUpdateError) throw sentUpdateError;
        sentCount += 1;
      } catch (error) {
        emailFailures += 1;
        console.error(`Buyer availability result email failed for order item ${item.id}`, error);
        const { error: releaseError } = await admin.from("marketplace_order_items")
          .update({ buyer_availability_result_email_claimed_at: null })
          .eq("id", item.id)
          .eq("buyer_availability_result_email_claimed_at", claimedAt)
          .is("buyer_availability_result_email_sent_at", null);
        if (releaseError) console.error("Could not release failed buyer availability email claim for retry.", releaseError);
      }
    }

    const { data: paymentReadyOrders, error: paymentReadyError } = await admin.from("marketplace_orders")
      .select("id, control_number, buyer_email, buyer_name, payment_deadline")
      .eq("payment_status", "awaiting_payment").is("payment_ready_email_sent_at", null).limit(5);
    if (paymentReadyError) throw paymentReadyError;
    for (const order of paymentReadyOrders ?? []) {
      try {
        const paymentDeadline = order.payment_deadline
          ? new Date(order.payment_deadline).toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam" })
          : "the deadline shown in My orders";
        await sendGmailEmail({
          to: order.buyer_email,
          subject: `Your order ${order.control_number} is ready for payment`,
          text: `Hello ${order.buyer_name},\n\nOrder ${order.control_number} is ready for payment. Its items are reserved until ${paymentDeadline} Tanzania time. Sign in to My orders and submit your payment reference before then.\n\nMadinimarket`,
        });
        const { error } = await admin.from("marketplace_orders")
          .update({ payment_ready_email_sent_at: new Date().toISOString() }).eq("id", order.id).is("payment_ready_email_sent_at", null);
        if (error) throw error;
        sentCount += 1;
      } catch (error) {
        emailFailures += 1;
        console.error(`Payment-ready notification failed for order ${order.id}`, error);
      }
    }

    const { data: paidOrders, error: paidOrdersError } = await admin.from("marketplace_orders")
      .select("id, control_number, buyer_email, buyer_name")
      .eq("payment_status", "paid").is("buyer_payment_verified_email_sent_at", null).limit(5);
    if (paidOrdersError) throw paidOrdersError;
    for (const order of paidOrders ?? []) {
      try {
        await sendGmailEmail({
          to: order.buyer_email,
          subject: `Payment verified for order ${order.control_number}`,
          text: `Hello ${order.buyer_name},\n\nYour payment for order ${order.control_number} has been verified. Sellers have been asked to dispatch your available items. Follow shipping information in My orders.\n\nMadinimarket`,
        });
        const { error } = await admin.from("marketplace_orders")
          .update({ buyer_payment_verified_email_sent_at: new Date().toISOString() }).eq("id", order.id).is("buyer_payment_verified_email_sent_at", null);
        if (error) throw error;
        sentCount += 1;
      } catch (error) {
        emailFailures += 1;
        console.error(`Payment verification email failed for order ${order.id}`, error);
      }
    }

    const { data: expiredOrders, error: expiredError } = await admin.from("marketplace_orders")
      .select("id, control_number, buyer_email, buyer_name")
      .eq("payment_status", "expired").is("buyer_expired_email_sent_at", null).limit(5);
    if (expiredError) throw expiredError;
    for (const order of expiredOrders ?? []) {
      try {
        await sendGmailEmail({
          to: order.buyer_email,
          subject: `Payment window closed for order ${order.control_number}`,
          text: `Hello ${order.buyer_name},\n\nThe two-hour payment window for order ${order.control_number} has ended. The order is expired and unpaid items have been released back to the market. Add the minerals to a new order if they are still available.\n\nMadinimarket`,
        });
        const { error } = await admin.from("marketplace_orders")
          .update({ buyer_expired_email_sent_at: new Date().toISOString() }).eq("id", order.id).is("buyer_expired_email_sent_at", null);
        if (error) throw error;
        sentCount += 1;
      } catch (error) {
        emailFailures += 1;
        console.error(`Expired order email failed for order ${order.id}`, error);
      }
    }

    const cleanupCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: expiredOrdersForCleanup, error: cleanupQueryError } = await admin.from("marketplace_orders")
      .select("id")
      .eq("payment_status", "expired")
      .lte("payment_deadline", cleanupCutoff)
      .limit(100);
    if (cleanupQueryError) throw cleanupQueryError;
    for (const order of expiredOrdersForCleanup ?? []) {
      const { error: itemDeleteError } = await admin.from("marketplace_order_items")
        .delete().eq("order_id", order.id);
      if (itemDeleteError) throw itemDeleteError;
      const { error: orderDeleteError } = await admin.from("marketplace_orders")
        .delete().eq("id", order.id).eq("payment_status", "expired")
        .lte("payment_deadline", cleanupCutoff);
      if (orderDeleteError) throw orderDeleteError;
    }

    const { data: dispatchItems, error: dispatchError } = await admin.from("marketplace_order_items")
      .select("id, order_id, seller_id, seller_email, mineral_name, weight, unit, seller_amount, currency, order:marketplace_orders!inner(control_number, buyer_name, buyer_phone, delivery_country, delivery_region, delivery_district, delivery_address)")
      .eq("status", "paid").is("dispatch_email_sent_at", null).limit(5);
    if (dispatchError) throw dispatchError;
    const handledDispatchGroups = new Set<string>();
    for (const item of dispatchItems ?? []) {
      const groupKey = JSON.stringify([item.order_id, item.seller_id ?? item.seller_email.toLowerCase(), item.seller_email.toLowerCase()]);
      if (handledDispatchGroups.has(groupKey)) continue;
      handledDispatchGroups.add(groupKey);

      let dispatchGroupQuery = admin.from("marketplace_order_items")
        .select("id, order_id, seller_id, seller_email, mineral_name, weight, unit, seller_amount, currency, order:marketplace_orders!inner(control_number, buyer_name, buyer_phone, delivery_country, delivery_region, delivery_district, delivery_address)")
        .eq("order_id", item.order_id)
        .eq("seller_email", item.seller_email)
        .eq("status", "paid")
        .is("dispatch_email_sent_at", null);
      dispatchGroupQuery = item.seller_id
        ? dispatchGroupQuery.eq("seller_id", item.seller_id)
        : dispatchGroupQuery.is("seller_id", null);
      const { data: dispatchGroupItems, error: dispatchGroupError } = await dispatchGroupQuery;
      if (dispatchGroupError) {
        emailFailures += 1;
        console.error(`Could not load dispatch items for order ${item.order_id} and seller ${item.seller_id ?? item.seller_email}`, dispatchGroupError);
        continue;
      }
      if (!dispatchGroupItems?.length) continue;

      const order = Array.isArray(dispatchGroupItems[0].order) ? dispatchGroupItems[0].order[0] : dispatchGroupItems[0].order;
      if (!order) {
        emailFailures += 1;
        console.error(`Dispatch notification has no parent order for order ${item.order_id}`);
        continue;
      }
      const orderItemLines = dispatchGroupItems.map((groupItem) =>
        `- ${groupItem.mineral_name} (${groupItem.weight} ${groupItem.unit}) — seller payout ${groupItem.currency} ${Number(groupItem.seller_amount).toLocaleString()}`,
      );
      const dispatchTotals = new Map<string, number>();
      for (const groupItem of dispatchGroupItems) {
        dispatchTotals.set(groupItem.currency, (dispatchTotals.get(groupItem.currency) ?? 0) + Number(groupItem.seller_amount));
      }
      const dispatchTotalsText = [...dispatchTotals].map(([currency, amount]) => `${currency} ${amount.toLocaleString()}`).join(" · ");
      const deliveryAddress = [order.delivery_address, order.delivery_district, order.delivery_region, order.delivery_country].filter(Boolean).join(", ");
      const itemIds = dispatchGroupItems.map((groupItem) => groupItem.id);
      try {
        await sendGmailEmail({
          to: item.seller_email,
          subject: `Payment verified: dispatch order ${order.control_number}`,
          text: `Payment for order ${order.control_number} is verified. Dispatch all the following items and record courier tracking in My orders:\n${orderItemLines.join("\n")}\n\nBuyer: ${order.buyer_name}\nPhone: ${order.buyer_phone}\nDelivery: ${deliveryAddress}\nTotal seller payout (excluding Madinimarket fee): ${dispatchTotalsText}\n\nThe buyer email is intentionally not included. Sign in at ${getPublicAppUrl()}.`,
          html: `<p>Payment for order <strong>${escapeHtml(order.control_number)}</strong> is verified. Dispatch all the following items and record courier tracking in My orders:</p><ul>${dispatchGroupItems.map((groupItem) => `<li>${escapeHtml(groupItem.mineral_name)} (${escapeHtml(String(groupItem.weight))} ${escapeHtml(groupItem.unit)}) — seller payout ${escapeHtml(groupItem.currency)} ${Number(groupItem.seller_amount).toLocaleString()}</li>`).join("")}</ul><p><strong>Buyer:</strong> ${escapeHtml(order.buyer_name)}<br><strong>Phone:</strong> ${escapeHtml(order.buyer_phone ?? "")}<br><strong>Delivery:</strong> ${escapeHtml(deliveryAddress)}</p><p><strong>Total seller payout (excluding Madinimarket fee):</strong> ${escapeHtml(dispatchTotalsText)}</p><p>The buyer email is intentionally not included. <a href="${escapeHtml(getPublicAppUrl().toString())}">Sign in to Madinimarket</a>.</p>`,
        });
        const { error } = await admin.from("marketplace_order_items")
          .update({ dispatch_email_sent_at: new Date().toISOString() }).in("id", itemIds).is("dispatch_email_sent_at", null);
        if (error) throw error;
        sentCount += 1;
      } catch (error) {
        emailFailures += 1;
        console.error(`Dispatch notification failed for order ${order.control_number} and seller ${item.seller_id ?? item.seller_email}`, error);
      }
    }

    const { data: shippedItems, error: shippedError } = await admin.from("marketplace_order_items")
      .select("id, order_id, seller_id, shipping_carrier, tracking_number, order:marketplace_orders!inner(control_number, buyer_email, buyer_name)")
      .eq("status", "shipped").is("buyer_shipped_email_sent_at", null).limit(5);
    if (shippedError) throw shippedError;
    const notifiedShipments = new Set<string>();
    for (const item of shippedItems ?? []) {
      const shipmentKey = item.shipping_carrier && item.tracking_number
        ? JSON.stringify([item.order_id, item.seller_id, item.shipping_carrier, item.tracking_number])
        : item.id;
      if (notifiedShipments.has(shipmentKey)) continue;
      notifiedShipments.add(shipmentKey);
      const order = Array.isArray(item.order) ? item.order[0] : item.order;
      try {
        await sendGmailEmail({
          to: order.buyer_email,
          subject: `A shipment from order ${order.control_number} has been sent`,
          text: `Hello ${order.buyer_name},\n\nA shipment from order ${order.control_number} has been sent via ${item.shipping_carrier ?? "the seller's carrier"}${item.tracking_number ? ` (tracking ${item.tracking_number})` : ""}. Sign in to My orders to follow the status and confirm receipt after the administrator confirms carrier delivery.\n\nMadinimarket`,
        });
        const { error } = item.shipping_carrier && item.tracking_number && item.seller_id
          ? await admin.from("marketplace_order_items").update({ buyer_shipped_email_sent_at: new Date().toISOString() })
            .eq("order_id", item.order_id).eq("seller_id", item.seller_id)
            .eq("shipping_carrier", item.shipping_carrier).eq("tracking_number", item.tracking_number)
            .eq("status", "shipped").is("buyer_shipped_email_sent_at", null)
          : item.shipping_carrier && item.tracking_number
            ? await admin.from("marketplace_order_items").update({ buyer_shipped_email_sent_at: new Date().toISOString() })
              .eq("order_id", item.order_id).is("seller_id", null)
              .eq("shipping_carrier", item.shipping_carrier).eq("tracking_number", item.tracking_number)
              .eq("status", "shipped").is("buyer_shipped_email_sent_at", null)
            : await admin.from("marketplace_order_items").update({ buyer_shipped_email_sent_at: new Date().toISOString() })
              .eq("id", item.id).eq("status", "shipped").is("buyer_shipped_email_sent_at", null);
        if (error) throw error;
        sentCount += 1;
      } catch (error) {
        emailFailures += 1;
        console.error(`Shipment notification failed for order item ${item.id}`, error);
      }
    }

    const { data: deliveredItems, error: deliveredError } = await admin.from("marketplace_order_items")
      .select("id, order_id, seller_id, shipping_carrier, tracking_number, order:marketplace_orders!inner(control_number, buyer_email, buyer_name)")
      .eq("status", "delivered").is("buyer_delivered_email_sent_at", null).limit(5);
    if (deliveredError) throw deliveredError;
    const notifiedDeliveredShipments = new Set<string>();
    for (const item of deliveredItems ?? []) {
      const shipmentKey = item.shipping_carrier && item.tracking_number
        ? JSON.stringify([item.order_id, item.seller_id, item.shipping_carrier, item.tracking_number])
        : item.id;
      if (notifiedDeliveredShipments.has(shipmentKey)) continue;
      notifiedDeliveredShipments.add(shipmentKey);
      const order = Array.isArray(item.order) ? item.order[0] : item.order;
      try {
        await sendGmailEmail({
          to: order.buyer_email,
          subject: `Delivery recorded for a shipment from order ${order.control_number}`,
          text: `Hello ${order.buyer_name},\n\nCarrier delivery was confirmed for a shipment from order ${order.control_number}. Sign in to My orders to confirm receipt for this tracking number or open an item-level dispute. If you do not confirm or dispute, seller payout becomes due seven days after delivery confirmation.\n\nMadinimarket`,
        });
        const { error } = item.shipping_carrier && item.tracking_number && item.seller_id
          ? await admin.from("marketplace_order_items").update({ buyer_delivered_email_sent_at: new Date().toISOString() })
            .eq("order_id", item.order_id).eq("seller_id", item.seller_id)
            .eq("shipping_carrier", item.shipping_carrier).eq("tracking_number", item.tracking_number)
            .eq("status", "delivered").is("buyer_delivered_email_sent_at", null)
          : item.shipping_carrier && item.tracking_number
            ? await admin.from("marketplace_order_items").update({ buyer_delivered_email_sent_at: new Date().toISOString() })
              .eq("order_id", item.order_id).is("seller_id", null)
              .eq("shipping_carrier", item.shipping_carrier).eq("tracking_number", item.tracking_number)
              .eq("status", "delivered").is("buyer_delivered_email_sent_at", null)
            : await admin.from("marketplace_order_items").update({ buyer_delivered_email_sent_at: new Date().toISOString() })
              .eq("id", item.id).eq("status", "delivered").is("buyer_delivered_email_sent_at", null);
        if (error) throw error;
        sentCount += 1;
      } catch (error) {
        emailFailures += 1;
        console.error(`Delivery notification failed for order item ${item.id}`, error);
      }
    }

    const { data: payoutDueItems, error: payoutDueError } = await admin.from("marketplace_order_items")
      .select("id, order_id, seller_id, seller_email, mineral_name, weight, unit, seller_amount, currency, order:marketplace_orders!inner(control_number)")
      .eq("status", "payout_due").is("payout_due_email_sent_at", null).limit(5);
    if (payoutDueError) throw payoutDueError;
    const handledPayoutGroups = new Set<string>();
    for (const item of payoutDueItems ?? []) {
      const groupKey = JSON.stringify([item.order_id, item.seller_id ?? item.seller_email.toLowerCase(), item.seller_email.toLowerCase()]);
      if (handledPayoutGroups.has(groupKey)) continue;
      handledPayoutGroups.add(groupKey);

      let payoutGroupQuery = admin.from("marketplace_order_items")
        .select("id, order_id, seller_id, seller_email, mineral_name, weight, unit, seller_amount, currency, order:marketplace_orders!inner(control_number)")
        .eq("order_id", item.order_id)
        .eq("seller_email", item.seller_email)
        .eq("status", "payout_due")
        .is("payout_due_email_sent_at", null);
      payoutGroupQuery = item.seller_id
        ? payoutGroupQuery.eq("seller_id", item.seller_id)
        : payoutGroupQuery.is("seller_id", null);
      const { data: payoutGroupItems, error: payoutGroupError } = await payoutGroupQuery;
      if (payoutGroupError) {
        emailFailures += 1;
        console.error(`Could not load payout items for order ${item.order_id} and seller ${item.seller_id ?? item.seller_email}`, payoutGroupError);
        continue;
      }
      if (!payoutGroupItems?.length) continue;

      const order = Array.isArray(payoutGroupItems[0].order) ? payoutGroupItems[0].order[0] : payoutGroupItems[0].order;
      if (!order) {
        emailFailures += 1;
        console.error(`Payout notification has no parent order for order ${item.order_id}`);
        continue;
      }
      const payoutLinesText = payoutGroupItems.map((groupItem) =>
        `- ${groupItem.mineral_name} (${groupItem.weight} ${groupItem.unit}): ${groupItem.currency} ${Number(groupItem.seller_amount).toLocaleString()}`,
      );
      const payoutTotals = new Map<string, number>();
      for (const groupItem of payoutGroupItems) {
        payoutTotals.set(groupItem.currency, (payoutTotals.get(groupItem.currency) ?? 0) + Number(groupItem.seller_amount));
      }
      const payoutTotalsText = [...payoutTotals].map(([currency, amount]) => `${currency} ${amount.toLocaleString()}`).join(" · ");
      const itemIds = payoutGroupItems.map((groupItem) => groupItem.id);
      try {
        await sendGmailEmail({
          to: item.seller_email,
          subject: `Seller payout due for order ${order.control_number}`,
          text: `Seller payout for the following items in order ${order.control_number} is due:\n${payoutLinesText.join("\n")}\n\nTotal payout due (excluding the Madinimarket fee): ${payoutTotalsText}\n\nThe administrator will transfer it outside the app and record the transaction reference.\n\nMadinimarket`,
          html: `<p>Seller payout for the following items in order <strong>${escapeHtml(order.control_number)}</strong> is due:</p><ul>${payoutGroupItems.map((groupItem) => `<li>${escapeHtml(groupItem.mineral_name)} (${escapeHtml(String(groupItem.weight))} ${escapeHtml(groupItem.unit)}): ${escapeHtml(groupItem.currency)} ${Number(groupItem.seller_amount).toLocaleString()}</li>`).join("")}</ul><p><strong>Total payout due (excluding the Madinimarket fee):</strong> ${escapeHtml(payoutTotalsText)}</p><p>The administrator will transfer it outside the app and record the transaction reference.</p><p>Madinimarket</p>`,
        });
        const { error } = await admin.from("marketplace_order_items")
          .update({ payout_due_email_sent_at: new Date().toISOString() }).in("id", itemIds).is("payout_due_email_sent_at", null);
        if (error) throw error;
        sentCount += 1;
      } catch (error) {
        emailFailures += 1;
        console.error(`Payout notification failed for order ${order.control_number} and seller ${item.seller_id ?? item.seller_email}`, error);
      }
    }

    return NextResponse.json({ ok: true, processed, processedPrivateOffers, sentCount, emailFailures }, { status: emailFailures ? 503 : 200 });
  } catch (error) {
    console.error("Marketplace order cron failed", error);
    return NextResponse.json({ error: "Marketplace order processing failed." }, { status: 503 });
  }
}
