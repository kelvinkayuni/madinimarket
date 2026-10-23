import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function GET() {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("marketplace_settings")
      .select("listing_fee_rate, listing_fee_updated_at")
      .eq("id", true)
      .single();
    if (error) throw error;
    return NextResponse.json({
      feePercent: Number(data.listing_fee_rate) * 100,
      updatedAt: data.listing_fee_updated_at,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load mineral listing fee settings." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
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
      return NextResponse.json({ error: "Enter a valid listing fee percentage." }, { status: 400 });
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Enter a valid listing fee percentage." }, { status: 400 });
    }
    const feePercent = (body as Record<string, unknown>).feePercent;
    if (typeof feePercent !== "number" || !Number.isFinite(feePercent) ||
      feePercent < 0 || feePercent > 100 ||
      Math.abs(feePercent * 100 - Math.round(feePercent * 100)) > 1e-8) {
      return NextResponse.json({ error: "Enter a fee from 0% to 100%, with up to two decimal places." }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("marketplace_settings")
      .update({
        listing_fee_rate: feePercent / 100,
        listing_fee_updated_at: new Date().toISOString(),
        listing_fee_updated_by: user.id,
      })
      .eq("id", true)
      .select("listing_fee_rate, listing_fee_updated_at")
      .single();
    if (error) throw error;
    return NextResponse.json({
      feePercent: Number(data.listing_fee_rate) * 100,
      updatedAt: data.listing_fee_updated_at,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not update the mineral listing fee." }, { status: 503 });
  }
}
