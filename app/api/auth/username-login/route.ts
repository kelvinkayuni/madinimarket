import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !publicKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase is not configured yet." }, { status: 503 });
  }

  let username = "";
  let password = "";
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) throw new Error("Invalid request");
    const values = body as Record<string, unknown>;
    username = typeof values.username === "string" ? values.username.trim() : "";
    password = typeof values.password === "string" ? values.password : "";
  } catch {
    return NextResponse.json({ error: "Invalid sign-in details." }, { status: 400 });
  }

  if (!username || username.length > 254 || password.length < 8 || password.length > 256) {
    return NextResponse.json({ error: "Username or password is incorrect." }, { status: 401 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const profileQuery = admin.from("profiles").select("id, email, username, role");
    const { data: profile, error: profileError } = emailPattern.test(username)
      ? await profileQuery.eq("email", username.toLowerCase()).maybeSingle()
      : await profileQuery.eq("username", username).maybeSingle();

    if (profileError) {
      console.error("Could not look up the sign-in account.", profileError);
      return NextResponse.json({ error: "Sign-in is temporarily unavailable." }, { status: 503 });
    }
    if (!profile?.email) {
      return NextResponse.json({ error: "Username or password is incorrect." }, { status: 401 });
    }

    const authClient = createClient(supabaseUrl, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await authClient.auth.signInWithPassword({
      email: profile.email,
      password,
    });

    if (error || !data.session) {
      return NextResponse.json({ error: "Username or password is incorrect." }, { status: 401 });
    }

    if (profile.role === "staff") {
      const { data: staff, error: staffError } = await admin.from("staff_members")
        .select("status")
        .eq("user_id", profile.id)
        .maybeSingle();
      if (staffError) throw staffError;
      if (!staff || staff.status !== "active") {
        await authClient.auth.signOut({ scope: "local" });
        return NextResponse.json({ error: "This staff account is inactive. Contact the owner administrator." }, { status: 403 });
      }
      return NextResponse.json(
        {
          username: profile.username,
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          accountType: "staff",
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (profile.role !== "admin") {
      const { data: settings, error: settingsError } = await admin.from("marketplace_settings")
        .select("non_admin_sign_in_disabled")
        .eq("id", true)
        .maybeSingle();
      if (!settingsError && settings?.non_admin_sign_in_disabled === true) {
        return NextResponse.json({ error: "User sign-in is not enabled right now. Please try again later." }, { status: 403 });
      }
      return NextResponse.json({ error: "Username or password is incorrect." }, { status: 401 });
    }

    return NextResponse.json(
      {
        username: profile.username,
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Could not sign in to the marketplace account.", error);
    return NextResponse.json({ error: "Sign-in is temporarily unavailable." }, { status: 503 });
  }
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;