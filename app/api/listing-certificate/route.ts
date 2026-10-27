import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getWebsiteAccountId } from "@/lib/website-session";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const id = Number(requestUrl.searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id < 1) {
    return NextResponse.json({ error: "A valid listing ID is required." }, { status: 400 });
  }

  try {
    if (!await getWebsiteAccountId(request)) {
      const signInUrl = new URL("/", requestUrl);
      signInUrl.searchParams.set("signin", "1");
      signInUrl.searchParams.set("returnTo", "certificate");
      signInUrl.searchParams.set("listingId", String(id));
      return NextResponse.redirect(signInUrl, {
        headers: { "Cache-Control": "no-store" },
      });
    }

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
    const { data: certificate, error: downloadError } = await admin.storage
      .from("stone-certificates")
      .download(listing.stone_certificate_path);
    if (downloadError || !certificate) {
      throw downloadError ?? new Error("Could not download the stone certificate.");
    }
    const contentType = ["application/pdf", "image/jpeg"].includes(certificate.type)
      ? certificate.type
      : "application/octet-stream";
    return new NextResponse(certificate, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
        "Vary": "Authorization",
      },
    });
  } catch (error) {
    console.error("Could not open listing stone certificate", error);
    return NextResponse.json({ error: "Could not open the stone certificate. Please try again." }, { status: 500 });
  }
}
