import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getWebsiteAccountId } from "@/lib/website-session";

export async function GET(request: Request) {
  try {
    const id = await getWebsiteAccountId(request, true);
    if (!id) return NextResponse.json({ account: null }, { headers: { "Cache-Control": "no-store" } });
    const { data, error } = await createSupabaseAdminClient().from("website_accounts")
      .select("id, username, display_name, nin")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return NextResponse.json({ account: null }, { headers: { "Cache-Control": "no-store" } });
    const { nin, ...account } = data;
    return NextResponse.json({ account, ninRequired: !nin }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Session lookup is temporarily unavailable." }, { status: 503 });
  }
}

export async function DELETE() {
  return NextResponse.json({ signedOut: true });
}
