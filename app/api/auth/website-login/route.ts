import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createWebsiteSessionToken, verifyWebsitePassword } from "@/lib/website-session";

export async function POST(request: Request) {
  let username = "";
  let password = "";
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) throw new Error("Invalid request");
    const values = body as Record<string, unknown>;
    username = typeof values.username === "string" ? values.username.trim().toUpperCase() : "";
    password = typeof values.password === "string" ? values.password : "";
  } catch {
    return NextResponse.json({ error: "Invalid sign-in details." }, { status: 400 });
  }

  if (!/^MM-\d{4}$/.test(username) || password.length < 8 || password.length > 256) {
    return NextResponse.json({ error: "Username or password is incorrect." }, { status: 401 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data: settings, error: settingsError } = await admin.from("marketplace_settings")
      .select("non_admin_sign_in_disabled")
      .eq("id", true)
      .maybeSingle();
    if (!settingsError && settings?.non_admin_sign_in_disabled === true) {
      return NextResponse.json({ error: "Username or password is incorrect." }, { status: 401 });
    }

    const { data: account, error } = await admin.from("website_accounts")
      .select("id, username, display_name, password_hash, is_active, session_version")
      .eq("username", username)
      .maybeSingle();
    if (error || !account || !account.is_active || !(await verifyWebsitePassword(password, account.password_hash))) {
      return NextResponse.json({ error: "Username or password is incorrect." }, { status: 401 });
    }

    return NextResponse.json({
      id: account.id,
      username: account.username,
      displayName: account.display_name,
      accessToken: createWebsiteSessionToken(account.id, account.session_version),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Sign-in is temporarily unavailable." }, { status: 503 });
  }
}
