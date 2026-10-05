import { NextResponse } from "next/server";

import { isSupabaseConfigured } from "@/lib/supabase";

export async function GET() {
  const supabaseServerConfigured = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  return NextResponse.json({
    app: "Madinimarket",
    status: "ready",
    mode: isSupabaseConfigured && supabaseServerConfigured ? "supabase" : "prototype",
    supabaseConfigured: isSupabaseConfigured,
    supabaseServerConfigured,
  });
}
