import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function GET() {
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("user_guide_content")
      .select("english_content, swahili_content, updated_at")
      .eq("id", 1)
      .single();
    if (error) throw error;

    return NextResponse.json({
      englishContent: data.english_content,
      swahiliContent: data.swahili_content,
      updatedAt: data.updated_at,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load the public user guide.", error);
    return NextResponse.json({
      error: "Could not load the user guide. Confirm the user guide content SQL setup has been run.",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
