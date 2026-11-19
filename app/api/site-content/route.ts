import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  try {
    const admin = createSupabaseAdminClient();
    if (new URL(request.url).searchParams.get("scope") === "account-creation") {
      const { data: settings, error } = await admin.from("marketplace_settings")
        .select("account_creation_disabled").eq("id", true).single();
      if (error) throw error;
      return NextResponse.json({
        accountCreationDisabled: settings.account_creation_disabled,
      }, { headers: { "Cache-Control": "no-store" } });
    }
    const [{ data: settings, error: settingsError }, { data: headlines, error: headlinesError }] = await Promise.all([
      admin.from("marketplace_settings").select("swahili_enabled, homepage_headline_font_size, seller_cards_per_column, buyer_cards_per_column, account_creation_disabled, non_admin_sign_in_disabled, homepage_announcement, welcome_hero_hidden").eq("id", true).single(),
      admin.from("homepage_headlines").select("id, main_phrase, accent_phrase").order("created_at", { ascending: true }).order("id", { ascending: true }),
    ]);
    if (settingsError) throw settingsError;
    if (headlinesError) throw headlinesError;
    return NextResponse.json({
      swahiliEnabled: settings.swahili_enabled,
      headlineFontSize: settings.homepage_headline_font_size,
      sellerCardsPerColumn: settings.seller_cards_per_column,
      buyerCardsPerColumn: settings.buyer_cards_per_column,
      accountCreationDisabled: settings.account_creation_disabled,
      nonAdminSignInDisabled: settings.non_admin_sign_in_disabled ?? false,
      homepageAnnouncement: settings.homepage_announcement ?? "",
      welcomeHeroHidden: settings.welcome_hero_hidden,
      headlines: headlines ?? [],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load homepage and language settings." }, { status: 503 });
  }
}
