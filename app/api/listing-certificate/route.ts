import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id < 1) {
    return NextResponse.json({ error: "A valid listing ID is required." }, { status: 400 });
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !publicKey) throw new Error("Supabase public credentials are not configured.");
    const publicClient = createClient(supabaseUrl, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: listing, error: listingError } = await publicClient
      .from("market_listing_feed")
      .select("stone_certificate_path")
      .eq("id", id)
      .maybeSingle();
    if (listingError) throw listingError;
    if (!listing) return NextResponse.json({ error: "This listing is not available." }, { status: 404 });
    if (!listing.stone_certificate_path) {
      return NextResponse.json({ error: "No certificate was uploaded for this listing." }, { status: 404 });
    }

    const admin = createSupabaseAdminClient();
    const { data: signed, error: signedUrlError } = await admin.storage
      .from("stone-certificates")
      .createSignedUrl(listing.stone_certificate_path, 3600);
    if (signedUrlError || !signed?.signedUrl) {
      throw signedUrlError ?? new Error("Could not open the stone certificate.");
    }
    return NextResponse.redirect(signed.signedUrl, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Could not open listing stone certificate", error);
    return NextResponse.json({ error: "Could not open the stone certificate. Please try again." }, { status: 500 });
  }
}
