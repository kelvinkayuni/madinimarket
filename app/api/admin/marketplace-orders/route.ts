import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";
import { marketplacePayoutGroupKey } from "@/lib/marketplace-payouts";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getStaffAccess } from "@/lib/staff-auth";
import { ownsStaffTaskClaim } from "@/lib/staff-task-claims";

type Body = Record<string, unknown>;
type OrderQueueItem = {
  id: string;
  seller_id: string | null;
  mineral_name: string;
  weight: number | string;
  unit: string;
  status: string;
  dispute_reason: string | null;
  seller_amount: number | string;
  total_price: number | string;
  currency: string;
  refund_reference: string | null;
};

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
  const staffAccess = await getStaffAccess(request);
  const admin = await getAdminClient(request, ["marketplace_orders", "delivery_confirmation", "order_disputes", "buyer_refunds"]);
  if (!admin) return NextResponse.json({ error: "Administrator access required." }, { status: 401 });
  const canProcessOrders = !staffAccess || staffAccess.permissions.includes("marketplace_orders");
  const canResolveDisputes = !staffAccess || staffAccess.permissions.includes("order_disputes");
  const canRecordRefunds = !staffAccess || staffAccess.permissions.includes("buyer_refunds");
  const searchParams = new URL(request.url).searchParams;
  if (searchParams.get("summary") === "1") {
    if (!canProcessOrders) return NextResponse.json({ error: "Marketplace order processing access is required." }, { status: 403 });
    const { data, error } = await admin.rpc("admin_marketplace_order_queue", {
      p_filter: staffAccess ? "processing" : "needs_action",
      p_search: "",
      p_offset: 0,
      p_limit: 1,
    });
    if (error) {
      console.error("Admin could not load marketplace orders needing action", error);
      return NextResponse.json({ error: "Could not load marketplace orders needing action." }, { status: 503 });
    }
    const queueRows = data as { total_count: number | string }[] | null;
    const marketplaceOrdersNeedingAction = Number(queueRows?.[0]?.total_count ?? 0);
    if (!Number.isSafeInteger(marketplaceOrdersNeedingAction) || marketplaceOrdersNeedingAction < 0) {
      console.error("Admin received invalid marketplace orders needing action count", { marketplaceOrdersNeedingAction });
      return NextResponse.json({ error: "Could not load marketplace orders needing action." }, { status: 503 });
    }
    return NextResponse.json(
      { marketplaceOrdersNeedingAction },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const filters = new Set([
    "processing", "needs_action", "active", "payment_submitted", "awaiting_sellers", "awaiting_payment",
    "delivery_due", "receipt_confirmation", "disputes", "payout_due", "refund_due", "completed", "history", "all",
  ]);
  const requestedFilter = searchParams.get("filter") ?? "needs_action";
  if (!filters.has(requestedFilter)) {
    return NextResponse.json({ error: "Choose a valid marketplace order filter." }, { status: 400 });
  }
  const hasFilterAccess = requestedFilter === "processing"
    ? canProcessOrders
    : requestedFilter === "disputes"
      ? canResolveDisputes
      : requestedFilter === "refund_due"
        ? canRecordRefunds
        : !staffAccess;
  if (!hasFilterAccess) {
    return NextResponse.json({ error: "You do not have access to this marketplace order queue." }, { status: 403 });
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
    return NextResponse.json({ error: "Could not load marketplace order queue. Run or update the marketplace order queue SQL in Supabase and retry." }, { status: 503 });
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
      if (staffAccess && !canProcessOrders) {
        const orderItems = (order.items ?? []) as OrderQueueItem[];
        const relevantItems = orderItems.filter((item) => requestedFilter === "disputes"
          ? item.status === "disputed"
          : item.status === "refund_due");
        const items = relevantItems.map((item) => requestedFilter === "disputes"
          ? {
            id: item.id,
            seller_id: item.seller_id,
            mineral_name: item.mineral_name,
            weight: item.weight,
            unit: item.unit,
            status: item.status,
            dispute_reason: item.dispute_reason,
            seller_amount: item.seller_amount,
            total_price: item.total_price,
            currency: item.currency,
          }
          : {
            id: item.id,
            mineral_name: item.mineral_name,
            weight: item.weight,
            unit: item.unit,
            status: item.status,
            total_price: item.total_price,
            currency: item.currency,
            refund_reference: canRecordRefunds ? item.refund_reference : null,
          });
        return {
          id: order.id,
          control_number: order.control_number,
          created_at: order.created_at,
          items,
        };
      }
      const paymentProof = canProcessOrders && order.payment_proof_path
        ? await admin.storage.from("marketplace-payment-proofs").createSignedUrl(order.payment_proof_path, 10 * 60)
        : null;
      if (paymentProof?.error) throw paymentProof.error;
      const orderItems = (order.items ?? []) as (Record<string, unknown> & {
        order_id: string;
        seller_id: string | null;
        status: string;
        payout_receipt_path?: string | null;
      })[];
      const selectedItems = staffAccess && requestedFilter === "processing" && order.payment_status !== "payment_submitted"
        ? orderItems.filter((item) => item.status === "payout_due")
        : orderItems;
      const items = await Promise.all(selectedItems.map(async (item) => {
        const {
          payout_receipt_path: receiptPath,
          payout_bank_name: payoutBankName,
          payout_bank_account_number: payoutBankAccountNumber,
          payout_bank_account_holder_name: payoutBankAccountHolderName,
          payout_bank_snapshot_at: payoutBankSnapshotAt,
          payout_reference: payoutReference,
          refund_reference: refundReference,
          ...safeItem
        } = item;
        const payout_group_key = marketplacePayoutGroupKey(item.order_id, item.seller_id, receiptPath ?? null);
        if (!canProcessOrders) {
          return {
            ...safeItem,
            payout_group_key,
            payout_bank_name: null,
            payout_bank_account_number: null,
            payout_bank_account_holder_name: null,
            payout_bank_snapshot_at: null,
            payout_reference: null,
            refund_reference: canRecordRefunds ? refundReference : null,
          };
        }
        if (!receiptPath) return { ...safeItem, payout_group_key, payout_bank_name: payoutBankName, payout_bank_account_number: payoutBankAccountNumber, payout_bank_account_holder_name: payoutBankAccountHolderName, payout_bank_snapshot_at: payoutBankSnapshotAt, payout_reference: payoutReference, refund_reference: canRecordRefunds ? refundReference : null };
        const { data: receipt, error: receiptError } = await admin.storage.from(PAYOUT_RECEIPT_BUCKET)
          .createSignedUrl(receiptPath, 10 * 60);
        if (receiptError) throw receiptError;
        return { ...safeItem, payout_group_key, payout_bank_name: payoutBankName, payout_bank_account_number: payoutBankAccountNumber, payout_bank_account_holder_name: payoutBankAccountHolderName, payout_bank_snapshot_at: payoutBankSnapshotAt, payout_reference: payoutReference, payout_receipt_url: receipt.signedUrl, refund_reference: canRecordRefunds ? refundReference : null };
      }));
      const {
        payment_proof_path: paymentProofPath,
        payment_reference: paymentReference,
        payment_note: paymentNote,
        ...safeOrder
      } = order;
      return {
        ...safeOrder,
        ...(canProcessOrders ? {
          payment_proof_path: paymentProofPath,
          payment_reference: paymentReference,
          payment_note: paymentNote,
          ...(paymentProof ? { payment_proof_url: paymentProof.data.signedUrl } : {}),
        } : { payment_reference: null, payment_note: null, payment_proof_url: null }),
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
  const staffAccess = await getStaffAccess(request);
  const admin = await getAdminClient(request, "marketplace_orders");
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
  if (staffAccess) {
    try {
      if (!await ownsStaffTaskClaim(admin, staffAccess.staffId, "marketplace_payout", itemId)) {
        return NextResponse.json({ error: "Claim this payout before recording it. Another staff member may already be handling it." }, { status: 409 });
      }
    } catch (error) {
      console.error("Could not verify the staff payout task claim.", error);
      return NextResponse.json({ error: "Could not verify task ownership." }, { status: 503 });
    }
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
    .select("id, order_id, seller_id, shipping_carrier, tracking_number, payout_bank_name, payout_bank_account_number, payout_bank_account_holder_name")
    .eq("id", itemId).eq("status", "payout_due").maybeSingle();
  if (itemError) {
    console.error("Could not verify seller payout before receipt upload", itemError);
    return NextResponse.json({ error: "Could not verify the seller payout." }, { status: 503 });
  }
  if (!item || !item.seller_id) {
    return NextResponse.json({ error: "This seller payout is not due or has no seller account." }, { status: 409 });
  }

  let payoutGroupQuery = service.from("marketplace_order_items")
    .select("id, payout_bank_name, payout_bank_account_number, payout_bank_account_holder_name")
    .eq("order_id", item.order_id)
    .eq("seller_id", item.seller_id)
    .eq("status", "payout_due");
  if (item.shipping_carrier?.trim() && item.tracking_number?.trim()) {
    payoutGroupQuery = payoutGroupQuery
      .eq("shipping_carrier", item.shipping_carrier)
      .eq("tracking_number", item.tracking_number);
  } else {
    payoutGroupQuery = payoutGroupQuery.eq("id", item.id);
  }
  payoutGroupQuery = item.payout_bank_name === null
    ? payoutGroupQuery.is("payout_bank_name", null)
    : payoutGroupQuery.eq("payout_bank_name", item.payout_bank_name);
  payoutGroupQuery = item.payout_bank_account_number === null
    ? payoutGroupQuery.is("payout_bank_account_number", null)
    : payoutGroupQuery.eq("payout_bank_account_number", item.payout_bank_account_number);
  payoutGroupQuery = item.payout_bank_account_holder_name === null
    ? payoutGroupQuery.is("payout_bank_account_holder_name", null)
    : payoutGroupQuery.eq("payout_bank_account_holder_name", item.payout_bank_account_holder_name);
  const { data: payoutItems, error: payoutItemsError } = await payoutGroupQuery;
  if (payoutItemsError) {
    console.error("Could not verify items in seller payout batch", payoutItemsError);
    return NextResponse.json({ error: "Could not verify the items in this seller payout." }, { status: 503 });
  }
  if (!payoutItems?.length) {
    return NextResponse.json({ error: "No items in this shipment are awaiting payout." }, { status: 409 });
  }
  const receiptPath = `${item.seller_id}/${item.order_id}/${randomUUID()}.${extension}`;
  const { error: uploadError } = await service.storage.from(PAYOUT_RECEIPT_BUCKET).upload(receiptPath, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) {
    console.error("Could not store seller payout receipt", uploadError);
    return NextResponse.json({ error: "Could not securely upload the payout receipt. Please retry." }, { status: 503 });
  }

  let payoutUpdate = service.from("marketplace_order_items").update({
    status: "payout_paid",
    payout_paid_at: new Date().toISOString(),
    payout_reference: reference,
    payout_receipt_path: receiptPath,
  }).eq("order_id", item.order_id).eq("seller_id", item.seller_id).eq("status", "payout_due");
  if (item.shipping_carrier?.trim() && item.tracking_number?.trim()) {
    payoutUpdate = payoutUpdate
      .eq("shipping_carrier", item.shipping_carrier)
      .eq("tracking_number", item.tracking_number);
  } else {
    payoutUpdate = payoutUpdate.eq("id", item.id);
  }
  payoutUpdate = item.payout_bank_name === null
    ? payoutUpdate.is("payout_bank_name", null)
    : payoutUpdate.eq("payout_bank_name", item.payout_bank_name);
  payoutUpdate = item.payout_bank_account_number === null
    ? payoutUpdate.is("payout_bank_account_number", null)
    : payoutUpdate.eq("payout_bank_account_number", item.payout_bank_account_number);
  payoutUpdate = item.payout_bank_account_holder_name === null
    ? payoutUpdate.is("payout_bank_account_holder_name", null)
    : payoutUpdate.eq("payout_bank_account_holder_name", item.payout_bank_account_holder_name);
  const { data: updated, error: updateError } = await payoutUpdate.select("id");
  if (updateError || !updated?.length) {
    const { error: cleanupError } = await service.storage.from(PAYOUT_RECEIPT_BUCKET).remove([receiptPath]);
    if (cleanupError) console.error("Could not remove unassociated seller payout receipt", cleanupError);
    if (updateError) {
      console.error("Could not record seller payout and receipt", updateError);
      return NextResponse.json({ error: "Could not record the seller payout. Please retry." }, { status: 503 });
    }
    return NextResponse.json({ error: "These seller payouts are no longer due." }, { status: 409 });
  }
  if (staffAccess) {
    const { error: auditError } = await admin.from("staff_audit_log").insert({
      actor_user_id: staffAccess.userId,
      staff_member_id: staffAccess.staffId,
      action: "record_seller_payout",
      entity_type: "marketplace_order_item",
      entity_id: itemId,
      details: { items_updated: updated.length },
    });
    if (auditError) {
      console.error("Seller payout recorded, but the staff audit entry could not be saved.", auditError);
      return NextResponse.json({ error: "The payout was recorded, but its audit record could not be saved. Contact the owner administrator." }, { status: 503 });
    }
  }
  return NextResponse.json({ ok: true, itemCount: updated.length });
}

export async function PATCH(request: Request) {
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const action = text(body.action, 40);
  const orderId = text(body.orderId, 60);
  const itemId = text(body.itemId, 60);
  const staffAccess = await getStaffAccess(request);
  const permission = action === "verify_payment"
    ? "marketplace_orders"
    : action === "mark_delivered"
      ? "delivery_confirmation"
      : action === "resolve_dispute"
        ? "order_disputes"
        : action === "mark_refunded"
          ? "buyer_refunds"
        : null;
  const admin = permission ? await getAdminClient(request, permission) : await getAdminClient(request);
  if (!admin) return NextResponse.json({ error: "Administrator or assigned staff access required." }, { status: 403 });
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
      if (staffAccess && !await ownsStaffTaskClaim(service, staffAccess.staffId, "marketplace_order", orderId)) {
        return NextResponse.json({ error: "Claim this payment verification before handling it." }, { status: 409 });
      }
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
      if (staffAccess) {
        const { error: auditError } = await service.from("staff_audit_log").insert({
          actor_user_id: staffAccess.userId,
          staff_member_id: staffAccess.staffId,
          action: "verify_order_payment",
          entity_type: "marketplace_order",
          entity_id: order.id,
        });
        if (auditError) {
          console.error("Order payment verified, but the staff audit entry could not be saved.", auditError);
          return NextResponse.json({ error: "Payment was verified, but its audit record could not be saved. Contact the owner administrator." }, { status: 503 });
        }
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "mark_delivered") {
      if (staffAccess && !await ownsStaffTaskClaim(service, staffAccess.staffId, "marketplace_delivery", itemId)) {
        return NextResponse.json({ error: "Claim this delivery task before handling it." }, { status: 409 });
      }
      const { data, error } = staffAccess
        ? await service.rpc("staff_confirm_marketplace_order_delivery", {
          p_staff_user_id: staffAccess.userId,
          p_order_item_id: itemId,
        })
        : await service.rpc("confirm_marketplace_order_shipment_delivery", { p_order_item_id: itemId });
      if (error) {
        if (error.code === "P0002" || error.code === "22023") return NextResponse.json({ error: error.message }, { status: 409 });
        throw error;
      }
      if (!data) return NextResponse.json({ error: "This shipment is no longer awaiting carrier delivery confirmation." }, { status: 409 });
      return NextResponse.json({ ok: true });
    }

    if (action === "resolve_dispute") {
      if (staffAccess && !await ownsStaffTaskClaim(service, staffAccess.staffId, "marketplace_dispute", itemId)) {
        return NextResponse.json({ error: "Claim this dispute before handling it." }, { status: 409 });
      }
      const outcome = text(body.outcome, 20);
      if (!["seller", "buyer"].includes(outcome)) return NextResponse.json({ error: "Choose a dispute outcome." }, { status: 400 });
      const { data, error } = await service.from("marketplace_order_items").update({
        status: outcome === "seller" ? "payout_due" : "refund_due",
        dispute_resolution: outcome,
        dispute_resolved_at: new Date().toISOString(),
      }).eq("id", itemId).eq("status", "disputed").select("id").maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "This item does not have an open dispute." }, { status: 409 });
      if (staffAccess) {
        const { error: auditError } = await service.from("staff_audit_log").insert({
          actor_user_id: staffAccess.userId,
          staff_member_id: staffAccess.staffId,
          action: "resolve_marketplace_dispute",
          entity_type: "marketplace_order_item",
          entity_id: itemId,
          details: { outcome },
        });
        if (auditError) {
          console.error("Dispute resolved, but the staff audit entry could not be saved.", auditError);
          return NextResponse.json({ error: "The dispute was resolved, but its audit record could not be saved. Contact the owner administrator." }, { status: 503 });
        }
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "mark_refunded") {
      if (staffAccess && !await ownsStaffTaskClaim(service, staffAccess.staffId, "buyer_refund", itemId)) {
        return NextResponse.json({ error: "Claim this buyer refund before recording it." }, { status: 409 });
      }
      const reference = text(body.reference, 120);
      if (reference.length < 3) return NextResponse.json({ error: "Enter the refund transaction reference." }, { status: 400 });
      const { data, error } = await service.from("marketplace_order_items").update({
        status: "refunded",
        refund_reference: reference,
      }).eq("id", itemId).eq("status", "refund_due").select("id").maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "This refund is not awaiting a recorded transfer." }, { status: 409 });
      if (staffAccess) {
        const { error: auditError } = await service.from("staff_audit_log").insert({
          actor_user_id: staffAccess.userId,
          staff_member_id: staffAccess.staffId,
          action: "record_buyer_refund",
          entity_type: "marketplace_order_item",
          entity_id: itemId,
        });
        if (auditError) {
          console.error("Buyer refund recorded, but the staff audit entry could not be saved.", auditError);
          return NextResponse.json({ error: "The refund was recorded, but its audit record could not be saved. Contact the owner administrator." }, { status: 503 });
        }
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown admin action." }, { status: 400 });
  } catch (error) {
    console.error("Admin marketplace order action failed", error);
    return NextResponse.json({ error: "The order action could not be completed." }, { status: 503 });
  }
}
