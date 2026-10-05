import { NextResponse } from "next/server";

import { isSupabaseConfigured } from "@/lib/supabase";

export async function GET() {
  return NextResponse.json({
    app: "Madinimarket",
    status: "ready",
    mode: "prototype",
    supabaseConfigured: isSupabaseConfigured,
  });
}
