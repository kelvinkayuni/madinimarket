import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const MAX_INSTRUCTIONS_LENGTH = 5000;
const MAX_PAYMENT_METHODS = 10;

type PaymentMethod = { method: string; accountNumber: string };

export async function GET(request: Request) {
  const authorized = await getAdminClient(request);
  if (!authorized) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const admin = createSupabaseAdminClient();
    const [{ data, error }, { count, error: countError }] = await Promise.all([
      admin.from("marketplace_settings")
        .select("payment_methods, payment_instructions, payment_instructions_updated_at")
        .eq("id", true)
        .single(),
      admin.from("marketplace_orders")
        .select("id", { count: "exact", head: true })
        .eq("payment_status", "awaiting_payment"),
    ]);
    if (error) throw error;
    if (countError) throw countError;
    return NextResponse.json({
      paymentMethods: data.payment_methods,
      instructions: data.payment_instructions,
      updatedAt: data.payment_instructions_updated_at,
      awaitingPaymentOrderCount: count ?? 0,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load marketplace payment instructions.", error);
    return NextResponse.json({ error: "Could not load payment instructions. Confirm the payment instructions SQL setup has been run." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const authorized = await getAdminClient(request);
  if (!authorized) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { data: { user }, error: userError } = await authorized.auth.getUser(token);
  if (userError || !user) return NextResponse.json({ error: "Admin session expired." }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter valid payment instructions." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Enter valid payment instructions." }, { status: 400 });
  }
  const values = body as Record<string, unknown>;
  if (typeof values.instructions !== "string" || values.instructions.length > MAX_INSTRUCTIONS_LENGTH) {
    return NextResponse.json({ error: `Payment instructions must be ${MAX_INSTRUCTIONS_LENGTH} characters or fewer.` }, { status: 400 });
  }
  if (!Array.isArray(values.paymentMethods) || values.paymentMethods.length > MAX_PAYMENT_METHODS) {
    return NextResponse.json({ error: `Add no more than ${MAX_PAYMENT_METHODS} payment methods.` }, { status: 400 });
  }
  const paymentMethods: PaymentMethod[] = [];
  for (const value of values.paymentMethods) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return NextResponse.json({ error: "Each payment method needs a method name and account number." }, { status: 400 });
    }
    const pair = value as Record<string, unknown>;
    if (typeof pair.method !== "string" || typeof pair.accountNumber !== "string") {
      return NextResponse.json({ error: "Each payment method needs a method name and account number." }, { status: 400 });
    }
    const method = pair.method.trim();
    const accountNumber = pair.accountNumber.trim();
    if (!method || method.length > 80 || !accountNumber || accountNumber.length > 200) {
      return NextResponse.json({ error: "Enter a payment method (up to 80 characters) and account number (up to 200 characters) for every row." }, { status: 400 });
    }
    paymentMethods.push({ method, accountNumber });
  }
  if (typeof values.confirmUpdateExisting !== "boolean") {
    return NextResponse.json({ error: "Confirm whether existing payment orders should receive the changed instructions." }, { status: 400 });
  }

  try {
    const { data, error } = await createSupabaseAdminClient().rpc("update_marketplace_payment_instructions", {
      p_payment_methods: paymentMethods,
      p_instructions: values.instructions.trim(),
      p_admin_id: user.id,
      p_confirm_update_existing: values.confirmUpdateExisting,
    });
    if (error) throw error;
    if (data?.confirmation_required) {
      return NextResponse.json({
        confirmationRequired: true,
        awaitingPaymentOrderCount: Number(data.awaiting_payment_order_count) || 0,
      }, { status: 409 });
    }
    return NextResponse.json({
      paymentMethods: data.payment_methods,
      instructions: data.payment_instructions,
      updatedAt: data.payment_instructions_updated_at,
      affectedOrders: Number(data.affected_order_count) || 0,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not update marketplace payment instructions.", error);
    return NextResponse.json({ error: "Could not save payment instructions. Confirm the payment instructions SQL setup has been run." }, { status: 503 });
  }
}
