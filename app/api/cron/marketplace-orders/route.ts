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

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const admin = createSupabaseAdminClient();
    const { data: processed, error: processError } = await admin.rpc("process_marketplace_orders");
    if (processError) throw processError;
    let sentCount = 0;
    let emailFailures = 0;

    const availabilityNotifications = await sendPendingSellerAvailabilityEmails();
    sentCount += availabilityNotifications.sentCount;
    emailFailures += availabilityNotifications.emailFailures;

    const { data: expiredAvailabilityItems, error: expiredAvailabilityError } = await admin.from("marketplace_order_items")
      .select("id, seller_email, mineral_name, order:marketplace_orders!inner(control_number, seller_response_deadline)")
      .eq("status", "unavailable")
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
          subject: `Mineral hidden after no availability response for order ${order.control_number}`,
          text: `The availability response deadline (${responseDeadline} Tanzania time) passed for ${item.mineral_name} in order ${order.control_number}. This mineral has been hidden from the public market. If you confirm that it is in stock, sign in to My orders and choose Confirm stock and relist.\n\nMadinimarket`,
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
          text: `Hello ${order.buyer_name},\n\nSeller responses are complete for order ${order.control_number}. Unavailable items have been removed. Sign in to My orders and submit your payment reference by ${paymentDeadline} Tanzania time.\n\nMadinimarket`,
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

    const { data: unavailableOrders, error: unavailableError } = await admin.from("marketplace_orders")
      .select("id, control_number, buyer_email, buyer_name")
      .eq("payment_status", "cancelled").is("buyer_unavailable_email_sent_at", null).limit(5);
    if (unavailableError) throw unavailableError;
    for (const order of unavailableOrders ?? []) {
      try {
        await sendGmailEmail({
          to: order.buyer_email,
          subject: `No items available for order ${order.control_number}`,
          text: `Hello ${order.buyer_name},\n\nThe seller response period ended for order ${order.control_number}, and no items were available. The order is closed; your cart items were released back to the market. No payment is due.\n\nMadinimarket`,
        });
        const { error } = await admin.from("marketplace_orders")
          .update({ buyer_unavailable_email_sent_at: new Date().toISOString() }).eq("id", order.id).is("buyer_unavailable_email_sent_at", null);
        if (error) throw error;
        sentCount += 1;
      } catch (error) {
        emailFailures += 1;
        console.error(`Unavailable order email failed for order ${order.id}`, error);
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
      .select("id, seller_email, mineral_name, weight, unit, seller_amount, currency, order:marketplace_orders!inner(control_number, buyer_name, buyer_phone, delivery_country, delivery_region, delivery_district, delivery_address)")
      .eq("status", "paid").is("dispatch_email_sent_at", null).limit(5);
    if (dispatchError) throw dispatchError;
    for (const item of dispatchItems ?? []) {
      const order = Array.isArray(item.order) ? item.order[0] : item.order;
      try {
        await sendGmailEmail({
          to: item.seller_email,
          subject: `Payment verified: dispatch order ${order.control_number}`,
          text: `Payment for order ${order.control_number} is verified. Dispatch ${item.mineral_name} (${item.weight} ${item.unit}) and record courier tracking in My orders.\n\nBuyer: ${order.buyer_name}\nPhone: ${order.buyer_phone}\nDelivery: ${order.delivery_address}, ${order.delivery_district}, ${order.delivery_region}, ${order.delivery_country}\nSeller payout (excluding Madinimarket fee): ${item.currency} ${Number(item.seller_amount).toLocaleString()}\n\nThe buyer email is intentionally not included. Sign in at ${getPublicAppUrl()}.`,
        });
        const { error } = await admin.from("marketplace_order_items")
          .update({ dispatch_email_sent_at: new Date().toISOString() }).eq("id", item.id).is("dispatch_email_sent_at", null);
        if (error) throw error;
        sentCount += 1;
      } catch (error) {
        emailFailures += 1;
        console.error(`Dispatch notification failed for order item ${item.id}`, error);
      }
    }

    const { data: shippedItems, error: shippedError } = await admin.from("marketplace_order_items")
      .select("id, shipping_carrier, tracking_number, order:marketplace_orders!inner(control_number, buyer_email, buyer_name)")
      .eq("status", "shipped").is("buyer_shipped_email_sent_at", null).limit(5);
    if (shippedError) throw shippedError;
    for (const item of shippedItems ?? []) {
      const order = Array.isArray(item.order) ? item.order[0] : item.order;
      try {
        await sendGmailEmail({
          to: order.buyer_email,
          subject: `A mineral from order ${order.control_number} has been sent`,
          text: `Hello ${order.buyer_name},\n\nAn item in order ${order.control_number} has been sent via ${item.shipping_carrier ?? "the seller's carrier"}${item.tracking_number ? ` (tracking ${item.tracking_number})` : ""}. Sign in to My orders to follow the status and confirm receipt after the administrator confirms carrier delivery.\n\nMadinimarket`,
        });
        const { error } = await admin.from("marketplace_order_items")
          .update({ buyer_shipped_email_sent_at: new Date().toISOString() }).eq("id", item.id).is("buyer_shipped_email_sent_at", null);
        if (error) throw error;
        sentCount += 1;
      } catch (error) {
        emailFailures += 1;
        console.error(`Shipment notification failed for order item ${item.id}`, error);
      }
    }

    const { data: deliveredItems, error: deliveredError } = await admin.from("marketplace_order_items")
      .select("id, order:marketplace_orders!inner(control_number, buyer_email, buyer_name)")
      .eq("status", "delivered").is("buyer_delivered_email_sent_at", null).limit(5);
    if (deliveredError) throw deliveredError;
    for (const item of deliveredItems ?? []) {
      const order = Array.isArray(item.order) ? item.order[0] : item.order;
      try {
        await sendGmailEmail({
          to: order.buyer_email,
          subject: `Delivery recorded for order ${order.control_number}`,
          text: `Hello ${order.buyer_name},\n\nCarrier delivery was confirmed for an item in order ${order.control_number}. Sign in to My orders to confirm receipt or open a dispute. If you do not confirm or dispute, seller payout becomes due seven days after delivery confirmation.\n\nMadinimarket`,
        });
        const { error } = await admin.from("marketplace_order_items")
          .update({ buyer_delivered_email_sent_at: new Date().toISOString() }).eq("id", item.id).is("buyer_delivered_email_sent_at", null);
        if (error) throw error;
        sentCount += 1;
      } catch (error) {
        emailFailures += 1;
        console.error(`Delivery notification failed for order item ${item.id}`, error);
      }
    }

    const { data: payoutDueItems, error: payoutDueError } = await admin.from("marketplace_order_items")
      .select("id, seller_email, seller_amount, currency, order:marketplace_orders!inner(control_number)")
      .eq("status", "payout_due").is("payout_due_email_sent_at", null).limit(5);
    if (payoutDueError) throw payoutDueError;
    for (const item of payoutDueItems ?? []) {
      const order = Array.isArray(item.order) ? item.order[0] : item.order;
      try {
        await sendGmailEmail({
          to: item.seller_email,
          subject: `Seller payout due for order ${order.control_number}`,
          text: `Seller payout for your item in order ${order.control_number} is due. The amount excludes the Madinimarket fee: ${item.currency} ${Number(item.seller_amount).toLocaleString()}. The administrator will transfer it outside the app and record the transaction reference.\n\nMadinimarket`,
        });
        const { error } = await admin.from("marketplace_order_items")
          .update({ payout_due_email_sent_at: new Date().toISOString() }).eq("id", item.id).is("payout_due_email_sent_at", null);
        if (error) throw error;
        sentCount += 1;
      } catch (error) {
        emailFailures += 1;
        console.error(`Payout notification failed for order item ${item.id}`, error);
      }
    }

    return NextResponse.json({ ok: true, processed, sentCount, emailFailures }, { status: emailFailures ? 503 : 200 });
  } catch (error) {
    console.error("Marketplace order cron failed", error);
    return NextResponse.json({ error: "Marketplace order processing failed." }, { status: 503 });
  }
}
