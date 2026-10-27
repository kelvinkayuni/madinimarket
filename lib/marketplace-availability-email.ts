import "server-only";

import { sendGmailEmail } from "@/lib/gmail";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

type AvailabilityItem = {
  id: string;
  order_id: string;
  seller_id: string | null;
  seller_email: string;
  mineral_name: string;
  weight: number | string;
  unit: string;
  total_price: number | string;
  currency: string;
  order: { control_number: string } | { control_number: string }[] | null;
};

function getSellerSignInUrl() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://www.madinimarket.co.tz";
  const url = new URL("/", baseUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("The configured Madinimarket URL must use HTTP or HTTPS.");
  }
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    url.hostname = "www.madinimarket.co.tz";
    url.protocol = "https:";
    url.port = "";
  }
  url.searchParams.set("signin", "1");
  url.searchParams.set("returnTo", "orders");
  return url.toString();
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

export async function sendPendingSellerAvailabilityEmails(orderId?: string) {
  const admin = createSupabaseAdminClient();
  const now = new Date();
  const reclaimBefore = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const signInUrl = getSellerSignInUrl();

  let itemsQuery = admin.from("marketplace_order_items")
    .select("id, order_id, seller_id, seller_email, mineral_name, weight, unit, total_price, currency, order:marketplace_orders!inner(control_number)")
    .eq("status", "awaiting_seller")
    .is("availability_email_sent_at", null)
    .or(`availability_email_claimed_at.is.null,availability_email_claimed_at.lt.${reclaimBefore}`)
    .order("created_at")
    .limit(orderId ? 1000 : 20);
  if (orderId) itemsQuery = itemsQuery.eq("order_id", orderId);

  const { data: pendingItems, error: pendingItemsError } = await itemsQuery;
  if (pendingItemsError) throw pendingItemsError;

  const sellerGroups = new Map<string, AvailabilityItem[]>();
  for (const item of (pendingItems ?? []) as AvailabilityItem[]) {
    const groupKey = `${item.order_id}:${item.seller_id ?? item.seller_email.toLowerCase()}`;
    sellerGroups.set(groupKey, [...(sellerGroups.get(groupKey) ?? []), item]);
  }

  let sentCount = 0;
  let emailFailures = 0;
  for (const [sellerId, sellerItems] of sellerGroups) {
    const claimedAt = new Date().toISOString();
    const { data: claimedRows, error: claimError } = await admin.from("marketplace_order_items")
      .update({ availability_email_claimed_at: claimedAt })
      .in("id", sellerItems.map((item) => item.id))
      .eq("status", "awaiting_seller")
      .is("availability_email_sent_at", null)
      .or(`availability_email_claimed_at.is.null,availability_email_claimed_at.lt.${reclaimBefore}`)
      .select("id");
    if (claimError) {
      emailFailures += 1;
      console.error(`Could not claim seller availability email for ${sellerId}`, claimError);
      continue;
    }

    const claimedIds = new Set((claimedRows ?? []).map((item) => item.id as string));
    const claimedSellerItems = sellerItems.filter((item) => claimedIds.has(item.id));
    if (!claimedSellerItems.length) continue;

    const firstItem = claimedSellerItems[0];
    const order = Array.isArray(firstItem.order) ? firstItem.order[0] : firstItem.order;
    const orderItemsText = claimedSellerItems.map((item) =>
      `- ${item.mineral_name}: ${item.weight} ${item.unit} - ${item.currency} ${Number(item.total_price).toLocaleString()}`,
    ).join("\n");
    const orderItemsHtml = claimedSellerItems.map((item) =>
      `<li>${escapeHtml(item.mineral_name)}: ${escapeHtml(String(item.weight))} ${escapeHtml(item.unit)} - ${escapeHtml(item.currency)} ${Number(item.total_price).toLocaleString()}</li>`,
    ).join("");
    const itemIds = claimedSellerItems.map((item) => item.id);

    try {
      await sendGmailEmail({
        to: firstItem.seller_email,
        subject: `Please confirm availability for order ${order?.control_number ?? ""}`,
        text: `Please sign in to confirm the availability of the following mineral${claimedSellerItems.length === 1 ? "" : "s"} within 6 hours.\n\nOrder: ${order?.control_number ?? "New order"}\n${orderItemsText}\n\nSign in to Madinimarket: ${signInUrl}\n\nAfter signing in, your Orders dashboard will open to the seller requests.`,
        html: `<p>Please sign in to confirm the availability of the following mineral${claimedSellerItems.length === 1 ? "" : "s"} within 6 hours.</p><p><strong>Order:</strong> ${escapeHtml(order?.control_number ?? "New order")}</p><ul>${orderItemsHtml}</ul><p><a href="${escapeHtml(signInUrl)}">Sign in to Madinimarket and open your Orders dashboard</a></p>`,
      });

      const { error: sentUpdateError } = await admin.from("marketplace_order_items")
        .update({ availability_email_sent_at: new Date().toISOString(), availability_email_claimed_at: null })
        .in("id", itemIds)
        .eq("availability_email_claimed_at", claimedAt)
        .is("availability_email_sent_at", null);
      if (sentUpdateError) throw sentUpdateError;
      sentCount += 1;
    } catch (error) {
      emailFailures += 1;
      console.error(`Seller availability notification failed for order ${order?.control_number ?? "unknown"} and seller ${sellerId}`, error);
      const { error: releaseError } = await admin.from("marketplace_order_items")
        .update({ availability_email_claimed_at: null })
        .in("id", itemIds)
        .eq("availability_email_claimed_at", claimedAt)
        .is("availability_email_sent_at", null);
      if (releaseError) console.error("Could not release failed seller availability email claims for retry.", releaseError);
    }
  }

  return { sentCount, emailFailures };
}
