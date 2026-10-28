import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { hashWebsitePassword } from "@/lib/website-session";

export async function POST(request: Request) {
  let token = "";
  let password = "";
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) throw new Error("Invalid request");
    const values = body as Record<string, unknown>;
    token = typeof values.token === "string" ? values.token : "";
    password = typeof values.password === "string" ? values.password : "";
  } catch {
    return NextResponse.json({ error: "The reset link or password is invalid." }, { status: 400 });
  }

  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || password.length < 8 || password.length > 256) {
    return NextResponse.json({ error: "Use a valid reset link and a password between 8 and 256 characters." }, { status: 400 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data: settings, error: settingsError } = await admin.from("marketplace_settings")
      .select("non_admin_sign_in_disabled")
      .eq("id", true)
      .maybeSingle();
    if (settingsError) throw settingsError;
    if (settings?.non_admin_sign_in_disabled === true) {
      return NextResponse.json({ error: "Password recovery is currently unavailable while user sign-in is not enabled." }, { status: 403 });
    }

    const tokenHash = createHash("sha256").update(token).digest("hex");
    const passwordHash = await hashWebsitePassword(password);
    const { data: updated, error } = await admin.rpc("complete_website_password_reset", {
      p_token_hash: tokenHash,
      p_password_hash: passwordHash,
    });
    if (error) throw error;
    if (!updated) {
      return NextResponse.json({ error: "This reset link is invalid, expired, or already used. Request a new link." }, { status: 400 });
    }
    return NextResponse.json({ message: "Your password has been updated. You can now sign in with your username and new password." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not complete website password reset.", error);
    return NextResponse.json({ error: "Password reset is temporarily unavailable. Please try again later." }, { status: 503 });
  }
}
