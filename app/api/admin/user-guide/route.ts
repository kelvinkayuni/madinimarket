import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const MAX_GUIDE_LENGTH = 30000;

export async function GET(request: Request) {
  const authorized = await getAdminClient(request);
  if (!authorized) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("user_guide_content")
      .select("english_content, swahili_content, updated_at")
      .eq("id", 1)
      .single();
    if (error) throw error;

    return NextResponse.json({
      englishContent: data.english_content,
      swahiliContent: data.swahili_content,
      updatedAt: data.updated_at,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load admin user guide content.", error);
    return NextResponse.json({
      error: "Could not load the user guide. Confirm the user guide content SQL setup has been run.",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function PATCH(request: Request) {
  const authorized = await getAdminClient(request);
  if (!authorized) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  let values: unknown;
  try {
    values = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter valid guide content." }, { status: 400 });
  }
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    return NextResponse.json({ error: "Enter valid guide content." }, { status: 400 });
  }

  const body = values as Record<string, unknown>;
  if (typeof body.englishContent !== "string" || typeof body.swahiliContent !== "string" ||
    !body.englishContent.trim() || !body.swahiliContent.trim() ||
    body.englishContent.length > MAX_GUIDE_LENGTH || body.swahiliContent.length > MAX_GUIDE_LENGTH) {
    return NextResponse.json({
      error: `Enter both language versions. Each version must be ${MAX_GUIDE_LENGTH.toLocaleString()} characters or fewer.`,
    }, { status: 400 });
  }

  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { data: { user }, error: userError } = await authorized.auth.getUser(token);
  if (userError || !user) return NextResponse.json({ error: "Admin session expired." }, { status: 403 });

  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("user_guide_content")
      .update({
        english_content: body.englishContent,
        swahili_content: body.swahiliContent,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      })
      .eq("id", 1)
      .select("english_content, swahili_content, updated_at")
      .single();
    if (error) throw error;

    return NextResponse.json({
      englishContent: data.english_content,
      swahiliContent: data.swahili_content,
      updatedAt: data.updated_at,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not save admin user guide content.", error);
    return NextResponse.json({
      error: "Could not save the user guide. Confirm the user guide content SQL setup has been run.",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
