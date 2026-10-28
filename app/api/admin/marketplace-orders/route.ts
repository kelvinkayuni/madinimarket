import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

type Body = Record<string, unknown>;

const PAYOUT_RECEIPT_BUCKET = "marketplace-seller-payout-receipts";
const MAX_PAYOUT_RECEIPT_BYTES = 4 * 1024 * 1024;

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validReceiptSignature(type: string, bytes: Buffer) {
  if (type === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return false;
}

async function readBody(request: Request): Promise<Body | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? body as Body : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const admin = await getAdminClient(request);
  if (!admin) return NextResponse.json({ error: "Administrator access required." }, { status: 401 });
  const searchParams = new URL(request.url).searchParams;
  if (searchParams.get("summary") === "1") {
    const { count, error } = await admin.from("marketplace_orders")
      .select("id", { count: "exact", head: true })
      .eq("payment_status", "payment_submitted");
    if (error) {
      console.error("Admin could not load pending marketplace payment count", error);
      return NextResponse.json({ error: "Could not load pending payment count." }, { status: 503 });
    }
    return NextResponse.json({ pendingPaymentCount: count ?? 0 }, { headers: { "Cache-Control": "no-store" } });
  }
  const filters = new Set([
    "needs_action", "active", "payment_submitted", "awaiting_sellers", "awaiting_payment",
    "delivery_due", "disputes", "payout_due", "refund_due", "history", "all",
  ]);
  const requestedFilter = searchParams.get("filter") ?? "needs_action";
  if (!filters.has(requestedFilter)) {
    return NextResponse.json({ error: "Choose a valid marketplace order filter." }, { status: 400 });
  }
  const page = Number(searchParams.get("page") ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 40_000) {
    return NextResponse.json({ error: "Choose a valid marketplace order page." }, { status: 400 });
  }
  const search = (searchParams.get("search") ?? "").trim().replace(/[%_,()\\]/g, "").slice(0, 80);
  const pageSize = 25;
  const offset = (page - 1) * pageSize;
  const { data: queue, error: queueError } = await admin.rpc("admin_marketplace_order_queue", {
    p_filter: requestedFilter,
    p_search: search,
    p_offset: offset,
    p_limit: pageSize,
  });
  if (queueError) {
    console.error("Admin could not query marketplace order queue", queueError);
    return NextResponse.json({ error: "Could not load marketplace order queue. Run supabase/marketplace-admin-order-queue.sql in Supabase and retry." }, { status: 503 });
  }
  const queueRows = queue as { order_id: string | null; total_count: number | string; action_priority: number }[] | null;
  const totalCount = Number(queueRows?.[0]?.total_count ?? 0);
  const orderIds = (queueRows ?? []).map((row) => row.order_id).filter((id): id is string => typeof id === "string");
  if (!orderIds.length) {
    return NextResponse.json({ orders: [], totalCount, page, pageSize }, { headers: { "Cache-Control": "no-store" } });
  }
  const { data, error } = await admin.from("marketplace_orders")
    .select("*, items:marketplace_order_items(*)").in("id", orderIds);
  if (error) {
    console.error("Admin could not load marketplace orders", error);
    return NextResponse.json({ error: "Could not load marketplace orders." }, { status: 503 });
  }
  try {
    const ordersById = new Map((data ?? []).map((order) => [order.id, order]));
    const signedOrders = await Promise.all(orderIds.map(async (id) => {
      const order = ordersById.get(id);
      if (!order) return null;
      const paymentProof = order.payment_proof_path
        ? await admin.storage.from("marketplace-payment-proofs").createSignedUrl(order.payment_proof_path, 10 * 60)
        : null;
      if (paymentProof?.error) throw paymentProof.error;
      const items = await Promise.all((order.items ?? []).map(async (item: Record<string, unknown> & { payout_receipt_path?: string | null }) => {
        const { payout_receipt_path: receiptPath, ...safeItem } = item;
        if (!receiptPath) return safeItem;
        const { data: receipt, error: receiptError } = await admin.storage.from(PAYOUT_RECEIPT_BUCKET)
          .createSignedUrl(receiptPath, 10 * 60);
        if (receiptError) throw receiptError;
        return { ...safeItem, payout_receipt_url: receipt.signedUrl };
      }));
      return {
        ...order,
        ...(paymentProof ? { payment_proof_url: paymentProof.data.signedUrl } : {}),
        items,
      };
    }));
    const orders = signedOrders.filter((order) => order !== null);
    return NextResponse.json({ orders, totalCount, page, pageSize }, { headers: { "Cache-Control": "no-store" } });
  } catch (proofError) {
    console.error("Admin could not create signed marketplace order document links", proofError);
    return NextResponse.json({ error: "Could not load private order documents." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const admin = await getAdminClient(request);
  if (!admin) return NextResponse.json({ error: "Administrator access required." }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Submit a payout reference and receipt file." }, { status: 400 });
  }
  const itemId = text(form.get("itemId"), 60);
  const reference = text(form.get("reference"), 120);
  const file = form.get("receipt");
  if (!/^[0-9a-f-]{36}$/i.test(itemId) || reference.length < 3 || !(file instanceof File)) {
    return NextResponse.json({ error: "Enter the payout reference and attach its receipt." }, { status: 400 });
  }
  if (file.size < 1 || file.size > MAX_PAYOUT_RECEIPT_BYTES) {
    return NextResponse.json({ error: "The payout receipt must be a non-empty PDF, JPEG, or PNG up to 4 MB." }, { status: 400 });
  }

  const extensionByType: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
  };
  const extension = extensionByType[file.type];
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!extension || !validReceiptSignature(file.type, bytes)) {
    return NextResponse.json({ error: "The payout receipt must be a valid PDF, JPEG, or PNG file." }, { status: 400 });
  }

  const service = createSupabaseAdminClient();
  const { data: item, error: itemError } = await service.from("marketplace_order_items")
    .select("id, seller_id").eq("id", itemId).eq("status", "payout_due").maybeSingle();
  if (itemError) {
    console.error("Could not verify seller payout before receipt upload", itemError);
    return NextResponse.json({ error: "Could not verify the seller payout." }, { status: 503 });
  }
  if (!item || !item.seller_id) {
    return NextResponse.json({ error: "This seller payout is not due or has no seller account." }, { status: 409 });
  }

  const receiptPath = `${item.seller_id}/${itemId}/${randomUUID()}.${extension}`;
  const { error: uploadError } = await service.storage.from(PAYOUT_RECEIPT_BUCKET).upload(receiptPath, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) {
    console.error("Could not store seller payout receipt", uploadError);
    return NextResponse.json({ error: "Could not securely upload the payout receipt. Please retry." }, { status: 503 });
  }

  const { data: updated, error: updateError } = await service.from("marketplace_order_items").update({
    status: "payout_paid",
    payout_paid_at: new Date().toISOString(),
    payout_reference: reference,
    payout_receipt_path: receiptPath,
  }).eq("id", itemId).eq("status", "payout_due").select("id").maybeSingle();
  if (updateError || !updated) {
    const { error: cleanupError } = await service.storage.from(PAYOUT_RECEIPT_BUCKET).remove([receiptPath]);
    if (cleanupError) console.error("Could not remove unassociated seller payout receipt", cleanupError);
    if (updateError) {
      console.error("Could not record seller payout and receipt", updateError);
      return NextResponse.json({ error: "Could not record the seller payout. Please retry." }, { status: 503 });
    }
    return NextResponse.json({ error: "This seller payout is no longer due." }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const admin = await getAdminClient(request);
  if (!admin) return NextResponse.json({ error: "Administrator access required." }, { status: 401 });
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const action = text(body.action, 40);
  const orderId = text(body.orderId, 60);
  const itemId = text(body.itemId, 60);
  if (action !== "verify_payment" && !/^[0-9a-f-]{36}$/i.test(itemId)) {
    return NextResponse.json({ error: "Choose a valid order item." }, { status: 400 });
  }

  try {
    const service = createSupabaseAdminClient();
    const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    const { data: { user } } = token ? await service.auth.getUser(token) : { data: { user: null } };
    if (!user) return NextResponse.json({ error: "Administrator session expired." }, { status: 401 });

    if (action === "verify_payment") {
      if (!/^[0-9a-f-]{36}$/i.test(orderId)) return NextResponse.json({ error: "Choose a valid order." }, { status: 400 });
      const { data: order, error: orderError } = await service.from("marketplace_orders")
        .select("id, payment_status")
        .eq("id", orderId).maybeSingle();
      if (orderError) throw orderError;
      if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
      const { error: verifyError } = await service.rpc("verify_marketplace_order_payment", {
        p_order_id: order.id,
        p_admin_id: user.id,
      });
      if (verifyError) {
        if (verifyError.code === "P0002" || verifyError.code === "22023") {
          return NextResponse.json({ error: verifyError.message }, { status: 409 });
        }
        throw verifyError;
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "mark_delivered") {
      const { data: item, error: itemError } = await service.from("marketplace_order_items")
        .select("id, status, shipping_carrier, tracking_number")
        .eq("id", itemId)
        .in("status", ["paid", "shipped"])
        .maybeSingle();
      if (itemError) throw itemError;
      if (!item) return NextResponse.json({ error: "This item is no longer awaiting carrier delivery confirmation." }, { status: 409 });
      if (!item.shipping_carrier?.trim() || !item.tracking_number?.trim()) {
        return NextResponse.json({ error: "The seller must provide both a carrier and tracking number before delivery can be confirmed." }, { status: 409 });
      }

      const { data, error } = await service.from("marketplace_order_items").update({
        status: "delivered",
        delivered_at: new Date().toISOString(),
      }).eq("id", itemId).in("status", ["paid", "shipped"])
        .eq("shipping_carrier", item.shipping_carrier).eq("tracking_number", item.tracking_number)
        .select("id, order_id").maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "The order changed while confirming delivery. Refresh the orders panel and try again." }, { status: 409 });
      return NextResponse.json({ ok: true });
    }

    if (action === "resolve_dispute") {
      const outcome = text(body.outcome, 20);
      if (!["seller", "buyer"].includes(outcome)) return NextResponse.json({ error: "Choose a dispute outcome." }, { status: 400 });
      const { data, error } = await service.from("marketplace_order_items").update({
        status: outcome === "seller" ? "payout_due" : "refund_due",
        dispute_resolution: outcome,
        dispute_resolved_at: new Date().toISOString(),
      }).eq("id", itemId).eq("status", "disputed").select("id").maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "This item does not have an open dispute." }, { status: 409 });
      return NextResponse.json({ ok: true });
    }

    if (action === "mark_refunded") {
      const reference = text(body.reference, 120);
      if (reference.length < 3) return NextResponse.json({ error: "Enter the refund transaction reference." }, { status: 400 });
      const { data, error } = await service.from("marketplace_order_items").update({
        status: "refunded",
        refund_reference: reference,
      }).eq("id", itemId).eq("status", "refund_due").select("id").maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "This refund is not awaiting a recorded transfer." }, { status: 409 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown admin action." }, { status: 400 });
  } catch (error) {
    console.error("Admin marketplace order action failed", error);
    return NextResponse.json({ error: "The order action could not be completed." }, { status: 503 });
  }
}
