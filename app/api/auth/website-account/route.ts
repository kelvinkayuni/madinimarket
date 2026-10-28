import { NextResponse } from "next/server";

import { sendGmailEmail } from "@/lib/gmail";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { hashWebsitePassword } from "@/lib/website-session";

export async function POST(request: Request) {
  let values: Record<string, unknown>;
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) throw new Error("Invalid request");
    values = body as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid account details." }, { status: 400 });
  }

  const firstName = typeof values.firstName === "string" ? values.firstName.trim() : "";
  const surname = typeof values.surname === "string" ? values.surname.trim() : "";
  const email = typeof values.email === "string" ? values.email.trim().toLowerCase() : "";
  const phone = typeof values.phone === "string" ? values.phone.trim() : "";
  const deliveryCountry = typeof values.country === "string" ? values.country.trim() : "";
  const deliveryRegion = typeof values.region === "string" ? values.region.trim() : "";
  const deliveryDistrict = typeof values.district === "string" ? values.district.trim() : "";
  const deliveryAddress = typeof values.address === "string" ? values.address.trim() : "";
  const password = typeof values.password === "string" ? values.password : "";
  if (!firstName || !surname || firstName.length > 100 || surname.length > 100 || !/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || !phone || phone.length > 40 ||
    !deliveryCountry || deliveryCountry.length > 100 || !deliveryRegion || deliveryRegion.length > 100 ||
    !deliveryDistrict || deliveryDistrict.length > 100 || !deliveryAddress || deliveryAddress.length > 300 ||
    password.length < 8 || password.length > 256) {
    return NextResponse.json({ error: "Check the account details and try again." }, { status: 400 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data: settings, error: settingsError } = await admin.from("marketplace_settings")
      .select("account_creation_disabled").eq("id", true).maybeSingle();
    if (settingsError) throw settingsError;
    if (settings?.account_creation_disabled) {
      return NextResponse.json({ error: "Account creation is suspended for now. Please try again later." }, { status: 403 });
    }
    const passwordHash = await hashWebsitePassword(password);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const username = `MM-${Math.floor(1000 + Math.random() * 9000)}`;
      const { data, error } = await admin.from("website_accounts").insert({
        display_name: `${firstName} ${surname}`,
        username,
        email,
        phone,
        delivery_country: deliveryCountry,
        delivery_region: deliveryRegion,
        delivery_district: deliveryDistrict,
        delivery_address: deliveryAddress,
        password_hash: passwordHash,
      }).select("id, username").maybeSingle();
      if (data) {
        try {
          await sendGmailEmail({
            to: email,
            subject: "Your Madinimarket username",
            text: `Hello ${firstName},\n\nYour Madinimarket username is ${data.username}. Use it with the password you created to sign in.\n\nMadinimarket`,
          });
        } catch {
          const { error: cleanupError } = await admin.from("website_accounts").delete().eq("id", data.id);
          return NextResponse.json(
            {
              error: cleanupError
                ? "We could not email your username. Please contact support before trying again."
                : "We could not email your username, so your account was not completed. Please try again shortly.",
            },
            { status: 503 },
          );
        }

        return NextResponse.json({ email }, { status: 201 });
      }
      if (error?.code !== "23505") {
        return NextResponse.json({ error: "Account creation is temporarily unavailable." }, { status: 503 });
      }
      const { data: existingEmail, error: lookupError } = await admin.from("website_accounts")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      if (lookupError) return NextResponse.json({ error: "Account creation is temporarily unavailable." }, { status: 503 });
      if (existingEmail) {
        return NextResponse.json({ error: "An account with this email already exists. Sign in instead." }, { status: 409 });
      }
    }
    return NextResponse.json({ error: "Could not generate a username. Please try again." }, { status: 503 });
  } catch {
    return NextResponse.json({ error: "Account creation is temporarily unavailable." }, { status: 503 });
  }
}
