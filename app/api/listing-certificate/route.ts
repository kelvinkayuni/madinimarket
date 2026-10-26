import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id < 1) {
    return NextResponse.json({ error: "A valid listing ID is required." }, { status: 400 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data: listing, error: listingError } = await admin
      .from("market_listing_feed")
      .select("stone_certificate_path")
      .eq("id", id)
      .maybeSingle();
    if (listingError) throw listingError;
    if (!listing) return NextResponse.json({ error: "This listing is not available." }, { status: 404 });
    if (!listing.stone_certificate_path) {
      return NextResponse.json({ error: "No certificate was uploaded for this listing." }, { status: 404 });
    }

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
