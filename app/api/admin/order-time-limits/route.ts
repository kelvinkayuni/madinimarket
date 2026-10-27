import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

function isHours(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 168;
}

export async function GET(request: Request) {
  const authorized = await getAdminClient(request);
  if (!authorized) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const { data, error } = await createSupabaseAdminClient().from("marketplace_settings")
      .select("seller_confirmation_hours, buyer_payment_hours, order_time_limits_updated_at")
      .eq("id", true)
      .single();
    if (error) throw error;
    return NextResponse.json({
      sellerConfirmationHours: data.seller_confirmation_hours,
      buyerPaymentHours: data.buyer_payment_hours,
      updatedAt: data.order_time_limits_updated_at,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load marketplace order time limits.", error);
    return NextResponse.json({ error: "Could not load order time limits. Confirm the order time limits SQL setup has been run." }, { status: 503 });
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
    return NextResponse.json({ error: "Enter valid seller and buyer order windows." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Enter valid seller and buyer order windows." }, { status: 400 });
  }
  const values = body as Record<string, unknown>;
  if (!isHours(values.sellerConfirmationHours) || !isHours(values.buyerPaymentHours)) {
    return NextResponse.json({ error: "Enter a whole number of hours from 1 to 168 for each order window." }, { status: 400 });
  }

  try {
    const { data, error } = await createSupabaseAdminClient().rpc("update_marketplace_order_time_limits", {
      p_seller_confirmation_hours: values.sellerConfirmationHours,
      p_buyer_payment_hours: values.buyerPaymentHours,
      p_admin_id: user.id,
    });
    if (error) throw error;
    return NextResponse.json({
      sellerConfirmationHours: data.seller_confirmation_hours,
      buyerPaymentHours: data.buyer_payment_hours,
      updatedAt: data.order_time_limits_updated_at,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not update marketplace order time limits.", error);
    return NextResponse.json({ error: "Could not save order time limits. Confirm the order time limits SQL setup has been run." }, { status: 503 });
  }
}
