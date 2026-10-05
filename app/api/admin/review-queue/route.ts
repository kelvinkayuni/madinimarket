import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";

export async function GET(request: Request) {
  try {
    const admin = await getAdminClient(request);
    if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

    const [sellersResult, buyersResult] = await Promise.all([
      admin.from("listings").select("*").eq("status", "pending").order("created_at", { ascending: false }),
      admin.from("buy_requests").select("*").eq("status", "pending").order("created_at", { ascending: false }),
    ]);
    if (sellersResult.error || buyersResult.error) throw new Error("Could not load pending submissions.");

    const sellers = await Promise.all((sellersResult.data ?? []).map(async (row) => {
      if (!row.image_path) return row;
      const { data } = await admin.storage.from("mineral-images").createSignedUrl(row.image_path, 3600);
      return { ...row, signed_image_url: data?.signedUrl ?? "" };
    }));
    return NextResponse.json({ sellers, buyers: buyersResult.data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load pending submissions." }, { status: 503 });
  }
}