import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { sendGmailEmail } from "@/lib/gmail";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getPublicAppUrl } from "@/lib/public-app-url";
import { escapeUsernameLikePattern } from "@/lib/username-lookup";

export async function POST(request: Request) {
  let username = "";
  let email = "";
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) throw new Error("Invalid request");
    const values = body as Record<string, unknown>;
    username = typeof values.username === "string" ? values.username.trim() : "";
    email = typeof values.email === "string" ? values.email.trim().toLowerCase() : "";
  } catch {
    return NextResponse.json({ error: "Enter your username and registered email address." }, { status: 400 });
  }

  if (!username || username.length > 32 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return NextResponse.json({ error: "Enter your username and a valid registered email address." }, { status: 400 });
  }

  const genericMessage = "If the username and email match an active account, a password reset link will be sent.";
  try {
    const admin = createSupabaseAdminClient();
    const normalizedUsername = username.toUpperCase();
    const { data: settings, error: settingsError } = await admin.from("marketplace_settings")
      .select("non_admin_sign_in_disabled")
      .eq("id", true)
      .maybeSingle();
    if (settingsError) throw settingsError;
    const signInSuspended = settings?.non_admin_sign_in_disabled === true;
    const isStaffUsername = /^MMSA-\d{4,}$/.test(normalizedUsername);

    if (isStaffUsername) {
      const { data: staffProfile, error: staffProfileError } = await admin.from("profiles")
        .select("id, display_name, email")
        .ilike("username", escapeUsernameLikePattern(username))
        .eq("email", email)
        .eq("role", "staff")
        .maybeSingle();
      if (staffProfileError) throw staffProfileError;
      if (!staffProfile) {
        return NextResponse.json({ message: genericMessage }, { status: 202, headers: { "Cache-Control": "no-store" } });
      }

      const { data: staffMember, error: staffMemberError } = await admin.from("staff_members")
        .select("status")
        .eq("user_id", staffProfile.id)
        .maybeSingle();
      if (staffMemberError) throw staffMemberError;
      if (staffMember?.status !== "active") {
        return NextResponse.json({ message: genericMessage }, { status: 202, headers: { "Cache-Control": "no-store" } });
      }

      const { data: recovery, error: recoveryError } = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: getPublicAppUrl().toString() },
      });
      if (recoveryError) throw recoveryError;
      const actionLink = recovery.properties?.action_link;
      if (!actionLink) throw new Error("Supabase did not return a staff password recovery link.");
      await sendGmailEmail({
        to: email,
        subject: "Reset your Madinimarket staff password",
        text: `Hello ${staffProfile.display_name},\n\nUse this secure link to choose a new password for your staff account:\n\n${actionLink}\n\nIf you did not request this, you can ignore this email.`,
      });
      return NextResponse.json({ message: genericMessage }, { status: 202, headers: { "Cache-Control": "no-store" } });
    }

    const { data: adminProfile, error: adminProfileError } = await admin.from("profiles")
      .select("display_name, email")
      .ilike("username", escapeUsernameLikePattern(username))
      .eq("email", email)
      .eq("role", "admin")
      .maybeSingle();
    if (adminProfileError) throw adminProfileError;
    if (adminProfile) {
      const { data: recovery, error: recoveryError } = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: getPublicAppUrl().toString() },
      });
      if (recoveryError) throw recoveryError;
      const actionLink = recovery.properties?.action_link;
      if (!actionLink) throw new Error("Supabase did not return an administrator password recovery link.");
      await sendGmailEmail({
        to: email,
        subject: "Reset your Madinimarket administrator password",
        text: `Hello ${adminProfile.display_name},\n\nUse this secure link to choose a new password for your Madinimarket administrator account:\n\n${actionLink}\n\nIf you did not request this, you can ignore this email.`,
      });
      return NextResponse.json({ message: genericMessage }, { status: 202, headers: { "Cache-Control": "no-store" } });
    }

    if (signInSuspended || !/^MM-\d{4}$/.test(normalizedUsername)) {
      return NextResponse.json({ message: genericMessage }, { status: 202, headers: { "Cache-Control": "no-store" } });
    }
    const { data: account, error: accountError } = await admin.from("website_accounts")
      .select("id, display_name, email")
      .eq("username", normalizedUsername)
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
