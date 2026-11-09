import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return NextResponse.json({ error: "Invitation session is invalid or expired." }, { status: 401 });

  try {
    const admin = createSupabaseAdminClient();
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) return NextResponse.json({ error: "Invitation session is invalid or expired." }, { status: 401 });
    const { data, error } = await admin.rpc("activate_staff_invitation", { p_staff_user_id: user.id });
    if (error) {
      if (error.code === "42501") return NextResponse.json({ error: error.message }, { status: 403 });
      throw error;
    }
    if (!data) return NextResponse.json({ error: "The staff invitation could not be activated." }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Could not activate the staff invitation.", error);
    return NextResponse.json({ error: "Could not activate the staff account. Contact the owner administrator." }, { status: 503 });
  }
}
