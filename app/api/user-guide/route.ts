import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function GET() {
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("user_guide_content")
      .select("english_content, swahili_content, english_faq_content, swahili_faq_content, updated_at")
      .eq("id", 1)
      .single();
    if (error) throw error;

    return NextResponse.json({
      englishContent: data.english_content,
      swahiliContent: data.swahili_content,
      englishFaqContent: data.english_faq_content,
      swahiliFaqContent: data.swahili_faq_content,
      updatedAt: data.updated_at,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load public guide and FAQ content.", error);
    return NextResponse.json({
      error: "Could not load the guide and FAQ. Confirm both user-guide-content.sql and user-guide-faq-content.sql have been run.",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
