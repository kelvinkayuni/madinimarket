import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  const listingId = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isSafeInteger(listingId) || listingId <= 0) {
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
      .select("image_path")
      .eq("id", listingId)
      .maybeSingle();

    if (listingError) {
      console.error("Could not verify a public listing image.", listingError);
      return NextResponse.json({ error: "Could not load this listing image." }, { status: 503 });
    }
    if (!listing?.image_path) {
      return NextResponse.json({ error: "This listing image is not available." }, { status: 404 });
    }

    const admin = createSupabaseAdminClient();
    const { data: image, error: downloadError } = await admin
      .storage
      .from("mineral-images")
      .download(listing.image_path);

    if (downloadError || !image) {
      console.error("Could not download a public listing image.", downloadError);
      return NextResponse.json({ error: "Could not load this listing image." }, { status: 503 });
    }
    if (!["image/jpeg", "image/png"].includes(image.type)) {
      console.error("A public listing image has an unsupported content type.", image.type);
      return NextResponse.json({ error: "This listing image is not available." }, { status: 415 });
    }

    return new NextResponse(image, {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=3600",
        "Content-Type": image.type,
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Could not load a public listing image.", error);
    return NextResponse.json({ error: "Could not load this listing image." }, { status: 503 });
  }
}
