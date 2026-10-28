import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

function readObject(body: unknown): Record<string, unknown> | null {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
}

async function readBody(request: Request) {
  try {
    return readObject(await request.json());
  } catch {
    return null;
  }
}

function parseHeadline(values: Record<string, unknown>) {
  const mainPhrase = typeof values.mainPhrase === "string" ? values.mainPhrase.trim() : "";
  const accentPhrase = typeof values.accentPhrase === "string" ? values.accentPhrase.trim() : "";
  if ((!mainPhrase && !accentPhrase) || mainPhrase.length > 120 || accentPhrase.length > 120) return null;
  return { main_phrase: mainPhrase, accent_phrase: accentPhrase };
}

function parseId(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export async function GET(request: Request) {
  try {
    const authorized = await getAdminClient(request);
    if (!authorized) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

    const admin = createSupabaseAdminClient();
    const [{ data: settings, error: settingsError }, { data: headlines, error: headlinesError }] = await Promise.all([
      admin.from("marketplace_settings").select("swahili_enabled, homepage_headline_font_size, account_creation_disabled, non_admin_sign_in_disabled, homepage_announcement").eq("id", true).single(),
      admin.from("homepage_headlines").select("id, main_phrase, accent_phrase").order("created_at", { ascending: true }).order("id", { ascending: true }),
    ]);
    if (settingsError) throw settingsError;
    if (headlinesError) throw headlinesError;
    return NextResponse.json({
      swahiliEnabled: settings.swahili_enabled,
      headlineFontSize: settings.homepage_headline_font_size,
      accountCreationDisabled: settings.account_creation_disabled,
      nonAdminSignInDisabled: settings.non_admin_sign_in_disabled ?? false,
      homepageAnnouncement: settings.homepage_announcement ?? "",
      headlines: headlines ?? [],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load homepage and language settings." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    const authorized = await getAdminClient(request);
    if (!authorized) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    const values = await readBody(request);
    if (typeof values?.accountCreationDisabled === "boolean") {
      const { data, error } = await createSupabaseAdminClient().from("marketplace_settings")
        .update({ account_creation_disabled: values.accountCreationDisabled })
        .eq("id", true)
        .select("account_creation_disabled")
        .single();
      if (error) throw error;
      return NextResponse.json({ accountCreationDisabled: data.account_creation_disabled }, { headers: { "Cache-Control": "no-store" } });
    }
    if (typeof values?.nonAdminSignInDisabled === "boolean") {
      const { data, error } = await createSupabaseAdminClient().from("marketplace_settings")
        .update({ non_admin_sign_in_disabled: values.nonAdminSignInDisabled })
        .eq("id", true)
        .select("non_admin_sign_in_disabled")
        .single();
      if (error) throw error;
      return NextResponse.json({ nonAdminSignInDisabled: data.non_admin_sign_in_disabled }, { headers: { "Cache-Control": "no-store" } });
    }
    if (typeof values?.homepageAnnouncement === "string") {
      const announcement = values.homepageAnnouncement.trim().slice(0, 500);
      const { data, error } = await createSupabaseAdminClient().from("marketplace_settings")
        .update({ homepage_announcement: announcement })
        .eq("id", true)
        .select("homepage_announcement")
        .single();
      if (error) throw error;
      return NextResponse.json({ homepageAnnouncement: data.homepage_announcement ?? "" }, { headers: { "Cache-Control": "no-store" } });
    }
    if (typeof values?.swahiliEnabled === "boolean") {
      const { data, error } = await createSupabaseAdminClient().from("marketplace_settings")
        .update({ swahili_enabled: values.swahiliEnabled })
        .eq("id", true)
        .select("swahili_enabled")
        .single();
      if (error) throw error;
      return NextResponse.json({ swahiliEnabled: data.swahili_enabled }, { headers: { "Cache-Control": "no-store" } });
    }
    if (values &&
      Number.isInteger(values.headlineFontSize) &&
      typeof values.headlineFontSize === "number" &&
      values.headlineFontSize >= 24 &&
      values.headlineFontSize <= 72) {
      const { data, error } = await createSupabaseAdminClient().from("marketplace_settings")
        .update({ homepage_headline_font_size: values.headlineFontSize })
        .eq("id", true)
        .select("homepage_headline_font_size")
        .single();
      if (error) throw error;
      return NextResponse.json({ headlineFontSize: data.homepage_headline_font_size }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "Choose a font size between 24 and 72 pixels." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Could not update the language setting." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const authorized = await getAdminClient(request);
    if (!authorized) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    const values = await readBody(request);
    if (!values) return NextResponse.json({ error: "Enter a valid homepage phrase." }, { status: 400 });
    const headline = parseHeadline(values);
    if (!headline) {
      return NextResponse.json({ error: "Add at least one phrase part and keep each part to 120 characters or fewer." }, { status: 400 });
    }

    const { data, error } = await createSupabaseAdminClient().from("homepage_headlines").insert(headline)
      .select("id, main_phrase, accent_phrase").single();
    if (error) throw error;
    return NextResponse.json({ headline: data }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not save the homepage phrase." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  try {
    const authorized = await getAdminClient(request);
    if (!authorized) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    const values = await readBody(request);
    const id = parseId(values?.id);
    if (!id) return NextResponse.json({ error: "Choose a valid homepage phrase." }, { status: 400 });

    const { data, error } = await createSupabaseAdminClient().from("homepage_headlines")
      .delete().eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Homepage phrase not found." }, { status: 404 });
    return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not delete the homepage phrase." }, { status: 503 });
  }
}
