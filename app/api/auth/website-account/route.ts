import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { hashWebsitePassword, setWebsiteSession } from "@/lib/website-session";

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
  const password = typeof values.password === "string" ? values.password : "";
  if (!firstName || !surname || firstName.length > 100 || surname.length > 100 || !/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || !phone || phone.length > 40 || password.length < 8 || password.length > 256) {
    return NextResponse.json({ error: "Check the account details and try again." }, { status: 400 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const passwordHash = await hashWebsitePassword(password);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const username = `MM-${Math.floor(1000 + Math.random() * 9000)}`;
      const { data, error } = await admin.from("website_accounts").insert({
        display_name: `${firstName} ${surname}`,
        username,
        email,
        phone,
        password_hash: passwordHash,
      }).select("id, username").maybeSingle();
      if (data) {
        const response = NextResponse.json({ id: data.id, username: data.username }, { status: 201 });
        setWebsiteSession(response, data.id);
        return response;
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
