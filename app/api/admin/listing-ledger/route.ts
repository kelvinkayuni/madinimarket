import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";

const PAGE_SIZE = 1000;

export async function GET(request: Request) {
  try {
    const admin = await getAdminClient(request);
    if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await admin.from("listings")
        .select("id, seller_name, mineral_name, seller_price, platform_fee_rate, platform_fee_amount, price, currency, status, listing_type, created_at")
        .order("created_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
    }

    const listings = rows.map((row) => ({
      ...row,
      id: Number(row.id),
      seller_price: String(row.seller_price),
      platform_fee_rate: Number(row.platform_fee_rate),
      platform_fee_amount: String(row.platform_fee_amount),
      price: String(row.price),
    }));
    return NextResponse.json({ listings }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load the listing ledger." }, { status: 503 });
  }
}
