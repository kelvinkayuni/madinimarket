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

  if (!username || username.length > 128 || password.length < 8 || password.length > 256) {
    return NextResponse.json({ error: "Username or password is incorrect." }, { status: 401 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("email, username, role")
      .eq("username", username)
      .maybeSingle();

    if (profileError || !profile?.email || profile.role !== "admin") {
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

    return NextResponse.json(
      {
        username: profile.username,
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Sign-in is temporarily unavailable." }, { status: 503 });
  }
}