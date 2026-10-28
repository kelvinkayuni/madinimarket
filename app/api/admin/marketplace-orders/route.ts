import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

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

export async function GET(request: Request) {
  const admin = await getAdminClient(request);
  if (!admin) return NextResponse.json({ error: "Administrator access required." }, { status: 401 });
  if (new URL(request.url).searchParams.get("summary") === "1") {
    const { count, error } = await admin.from("marketplace_orders")
      .select("id", { count: "exact", head: true })
      .eq("payment_status", "payment_submitted");
    if (error) {
      console.error("Admin could not load pending marketplace payment count", error);
      return NextResponse.json({ error: "Could not load pending payment count." }, { status: 503 });
    }
    return NextResponse.json({ pendingPaymentCount: count ?? 0 }, { headers: { "Cache-Control": "no-store" } });
  }
  const { data, error } = await admin.from("marketplace_orders")
    .select("*, items:marketplace_order_items(*)").order("created_at", { ascending: false }).limit(200);
  if (error) {
    console.error("Admin could not load marketplace orders", error);
    return NextResponse.json({ error: "Could not load marketplace orders." }, { status: 503 });
  }
  try {
    const orders = await Promise.all((data ?? []).map(async (order) => {
      if (!order.payment_proof_path) return order;
      const { data: proof, error: proofError } = await admin.storage.from("marketplace-payment-proofs")
        .createSignedUrl(order.payment_proof_path, 10 * 60);
      if (proofError) throw proofError;
      return { ...order, payment_proof_url: proof.signedUrl };
    }));
    return NextResponse.json({ orders });
  } catch (proofError) {
    console.error("Admin could not create signed payment proof links", proofError);
    return NextResponse.json({ error: "Could not load private payment proof documents." }, { status: 503 });
  }
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

    if (action === "mark_payout_paid") {
      const reference = text(body.reference, 120);
      if (reference.length < 3) return NextResponse.json({ error: "Enter the payout transaction reference." }, { status: 400 });
      const { data, error } = await service.from("marketplace_order_items").update({
        status: "payout_paid",
        payout_paid_at: new Date().toISOString(),
        payout_reference: reference,
      }).eq("id", itemId).eq("status", "payout_due").select("id").maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "This seller payout is not yet due." }, { status: 409 });
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
