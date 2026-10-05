import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { clearWebsiteSession, getWebsiteAccountId } from "@/lib/website-session";

export async function GET() {
  try {
    const id = await getWebsiteAccountId();
    if (!id) return NextResponse.json({ account: null }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const { data, error } = await createSupabaseAdminClient().from("website_accounts")
      .select("id, username, display_name")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return NextResponse.json({ account: null }, { status: 401, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ account: data }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Session lookup is temporarily unavailable." }, { status: 503 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ signedOut: true });
  clearWebsiteSession(response);
  return response;
}
