import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type MineralView = "marketplace_buy_requests" | "marketplace_listings";
type MineralCountRow = { id: string; mineral_name: string | null };
type MarketplaceMineralDatabase = {
  public: {
    Tables: Record<never, never>;
    Views: {
      marketplace_buy_requests: { Row: MineralCountRow; Relationships: [] };
      marketplace_listings: { Row: MineralCountRow; Relationships: [] };
    };
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};

const PAGE_SIZE = 500;
const noStoreHeaders = { "Cache-Control": "no-store" };

async function countMinerals(client: SupabaseClient<MarketplaceMineralDatabase>, view: MineralView) {
  const counts = new Map<string, { name: string; count: number }>();

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const query = view === "marketplace_buy_requests"
      ? client.from("marketplace_buy_requests").select("id, mineral_name")
      : client.from("marketplace_listings").select("id, mineral_name");
    const { data, error } = await query
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;

    const rows = data ?? [];
    for (const row of rows) {
      const name = typeof row.mineral_name === "string"
        ? row.mineral_name.trim().replace(/\s+/g, " ") || "Unspecified"
        : "Unspecified";
      const key = name.toLocaleLowerCase("en-US");
      const current = counts.get(key);
      if (current) current.count += 1;
      else counts.set(key, { name, count: 1 });
    }

    if (rows.length < PAGE_SIZE) break;
  }

  const minerals = [...counts.values()].sort((left, right) =>
    right.count - left.count || left.name.localeCompare(right.name, "en", { sensitivity: "base" }));
  return {
    total: minerals.reduce((sum, mineral) => sum + mineral.count, 0),
    minerals,
  };
}

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !publicKey) throw new Error("Public Supabase credentials are not configured.");

    const client = createClient<MarketplaceMineralDatabase>(supabaseUrl, publicKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    const [buyerRequests, sellerListings] = await Promise.all([
      countMinerals(client, "marketplace_buy_requests"),
      countMinerals(client, "marketplace_listings"),
    ]);

    return NextResponse.json({ buyerRequests, sellerListings }, { headers: noStoreHeaders });
  } catch (error) {
    console.error("Could not load marketplace mineral statistics.", error);
    return NextResponse.json(
      { error: "Could not load market mineral statistics." },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
