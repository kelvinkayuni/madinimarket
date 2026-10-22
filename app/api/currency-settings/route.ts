import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function GET() {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("marketplace_settings")
      .select("usd_enabled")
      .eq("id", true)
      .single();
    if (error) throw error;
    return NextResponse.json({ usdEnabled: data.usd_enabled }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load marketplace currency settings." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await getAdminClient(request);
    if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid currency setting." }, { status: 400 });
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid currency setting." }, { status: 400 });
    }
    const usdEnabled = (body as Record<string, unknown>).usdEnabled;
    if (typeof usdEnabled !== "boolean") {
      return NextResponse.json({ error: "Invalid currency setting." }, { status: 400 });
    }

    const { data, error } = await admin.from("marketplace_settings")
      .update({ usd_enabled: usdEnabled, updated_at: new Date().toISOString() })
      .eq("id", true)
      .select("usd_enabled")
      .single();
    if (error) throw error;
    return NextResponse.json({ usdEnabled: data.usd_enabled }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not update marketplace currency settings." }, { status: 503 });
  }
}
