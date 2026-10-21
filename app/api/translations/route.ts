import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function GET() {
  try {
    const { data, error } = await createSupabaseAdminClient().from("translation_pairs")
      .select("id, english_phrase, swahili_phrase")
      .order("english_phrase", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ translations: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load language translations." }, { status: 503 });
  }
}
