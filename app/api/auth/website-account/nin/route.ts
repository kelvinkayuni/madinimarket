import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isTanzaniaNinFormat } from "@/lib/tanzania-nin";
import { getWebsiteAccountId } from "@/lib/website-session";

export async function POST(request: Request) {
  try {
    const accountId = await getWebsiteAccountId(request, true);
    if (!accountId) return NextResponse.json({ error: "Sign in to update your account." }, { status: 401 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Enter a valid Tanzania NIDA NIN." }, { status: 400 });
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Enter a valid Tanzania NIDA NIN." }, { status: 400 });
    }
    const nin = (body as Record<string, unknown>).nin;
    if (!isTanzaniaNinFormat(nin)) {
      return NextResponse.json({ error: "Enter your 20-digit Tanzania NIDA NIN." }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("website_accounts")
      .update({ nin })
      .eq("id", accountId)
      .is("nin", null)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (data) return NextResponse.json({ saved: true }, { headers: { "Cache-Control": "no-store" } });

    const { data: account, error: accountError } = await admin.from("website_accounts")
      .select("nin")
      .eq("id", accountId)
      .maybeSingle();
    if (accountError) throw accountError;
    if (account?.nin === nin) return NextResponse.json({ saved: true }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ error: "A NIN is already saved. Contact support if it needs correction." }, { status: 409 });
  } catch {
    return NextResponse.json({ error: "Could not save your NIN. Please try again." }, { status: 503 });
  }
}
