import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function GET() {
  try {
    const admin = createSupabaseAdminClient();
    const [{ data: settings, error: settingsError }, { data: headlines, error: headlinesError }] = await Promise.all([
      admin.from("marketplace_settings").select("swahili_enabled, homepage_headline_font_size, account_creation_disabled, homepage_announcement").eq("id", true).single(),
      admin.from("homepage_headlines").select("id, main_phrase, accent_phrase").order("created_at", { ascending: true }).order("id", { ascending: true }),
    ]);
    if (settingsError) throw settingsError;
    if (headlinesError) throw headlinesError;
    return NextResponse.json({
      swahiliEnabled: settings.swahili_enabled,
      headlineFontSize: settings.homepage_headline_font_size,
      accountCreationDisabled: settings.account_creation_disabled,
      homepageAnnouncement: settings.homepage_announcement ?? "",
      headlines: headlines ?? [],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load homepage and language settings." }, { status: 503 });
  }
}
