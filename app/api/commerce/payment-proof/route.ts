import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getWebsiteAccountId } from "@/lib/website-session";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const MAX_PROOF_BYTES = 10 * 1024 * 1024;

function validSignature(type: string, bytes: Buffer) {
  if (type === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return false;
}

export async function POST(request: Request) {
  const buyerId = await getWebsiteAccountId(request);
  if (!buyerId) return NextResponse.json({ error: "Sign in to submit payment proof." }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Submit valid payment details and proof." }, { status: 400 });
  }
  const orderId = String(form.get("orderId") ?? "").trim();
  const reference = String(form.get("reference") ?? "").trim().slice(0, 120);
  const note = String(form.get("note") ?? "").trim().slice(0, 500);
  const file = form.get("proof");
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || reference.length < 3 || !(file instanceof File)) {
    return NextResponse.json({ error: "Enter the payment transaction reference and attach a payment receipt." }, { status: 400 });
  }
  if (file.size < 1 || file.size > MAX_PROOF_BYTES) {
    return NextResponse.json({ error: "Payment proof must be a non-empty PDF, JPEG, or PNG up to 10 MB." }, { status: 400 });
  }

  const extensionByType: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
  };
  const extension = extensionByType[file.type];
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!extension || !validSignature(file.type, bytes)) {
    return NextResponse.json({ error: "Payment proof must be a valid PDF, JPEG, or PNG file." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: order, error: orderError } = await admin.from("marketplace_orders")
    .select("id, payment_status, payment_deadline").eq("id", orderId).eq("buyer_id", buyerId).maybeSingle();
  if (orderError) {
    console.error("Could not verify payment order before proof upload", orderError);
    return NextResponse.json({ error: "Could not verify the order." }, { status: 503 });
  }
  if (!order || order.payment_status !== "awaiting_payment" || !order.payment_deadline || Date.parse(order.payment_deadline) <= Date.now()) {
    return NextResponse.json({ error: "The payment window has closed or this order is no longer awaiting payment." }, { status: 409 });
  }

  const proofPath = `${buyerId}/${orderId}/${randomUUID()}.${extension}`;
  const { error: uploadError } = await admin.storage.from("marketplace-payment-proofs").upload(proofPath, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) {
    console.error("Could not store payment proof", uploadError);
    return NextResponse.json({ error: "Could not securely upload payment proof. Please retry." }, { status: 503 });
  }

  const { error: submitError } = await admin.rpc("submit_marketplace_order_payment", {
    p_order_id: orderId,
    p_buyer_id: buyerId,
    p_reference: reference,
    p_note: note,
    p_proof_path: proofPath,
  });
  if (submitError) {
    const { error: cleanupError } = await admin.storage.from("marketplace-payment-proofs").remove([proofPath]);
    if (cleanupError) console.error("Could not remove unassociated payment proof after submission failed", cleanupError);
    if (submitError.code === "P0002" || submitError.code === "22023") {
      return NextResponse.json({ error: submitError.message }, { status: 409 });
    }
    console.error("Could not submit marketplace payment proof", submitError);
    return NextResponse.json({ error: "Could not submit payment proof. Please retry." }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
