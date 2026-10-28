import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { sendGmailEmail } from "@/lib/gmail";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getPublicAppUrl } from "@/lib/public-app-url";

export async function POST(request: Request) {
  let email = "";
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) throw new Error("Invalid request");
    const values = body as Record<string, unknown>;
    email = typeof values.email === "string" ? values.email.trim().toLowerCase() : "";
  } catch {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const genericMessage = "If an active account uses that email, a password reset link will be sent.";
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
    const { data: account, error: accountError } = await admin.from("website_accounts")
      .select("id, display_name, email")
      .eq("email", email)
      .eq("is_active", true)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account) {
      return NextResponse.json({ message: genericMessage }, { status: 202, headers: { "Cache-Control": "no-store" } });
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const resetUrl = new URL("/reset-password", getPublicAppUrl());
    resetUrl.searchParams.set("token", token);
    const { data: issued, error: issueError } = await admin.rpc("issue_website_password_reset", {
      p_account_id: account.id,
      p_token_hash: tokenHash,
      p_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
    if (issueError) throw issueError;
    if (!issued) {
      return NextResponse.json({ message: genericMessage }, { status: 202, headers: { "Cache-Control": "no-store" } });
    }

    try {
      await sendGmailEmail({
        to: account.email,
        subject: "Reset your Madinimarket password",
        text: `Hello ${account.display_name},\n\nUse this one-time link to choose a new Madinimarket password. It expires in 30 minutes:\n\n${resetUrl.toString()}\n\nIf you did not request this, you can ignore this email.`,
      });
    } catch (error) {
      const { error: cleanupError } = await admin.from("website_password_resets")
        .delete()
        .eq("account_id", account.id)
        .eq("token_hash", tokenHash);
      if (cleanupError) console.error("Could not remove an unsent website password reset token.", cleanupError);
      console.error("Could not send website password reset email.", error);
      return NextResponse.json({ error: "Password reset email is temporarily unavailable. Please try again later." }, { status: 503 });
    }

    return NextResponse.json({ message: genericMessage }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not issue website password reset.", error);
    return NextResponse.json({ error: "Password reset is temporarily unavailable. Please try again later." }, { status: 503 });
  }
}
