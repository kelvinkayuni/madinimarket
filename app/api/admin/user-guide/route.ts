import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";
import { parseFaqContent } from "@/lib/faq-content";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const MAX_CONTENT_LENGTH = 30000;

export async function GET(request: Request) {
  const authorized = await getAdminClient(request);
  if (!authorized) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("user_guide_content")
      .select("english_content, swahili_content, english_faq_content, swahili_faq_content, updated_at")
      .eq("id", 1)
      .single();
    if (error) throw error;

    return NextResponse.json({
      englishContent: data.english_content,
      swahiliContent: data.swahili_content,
      englishFaqContent: data.english_faq_content,
      swahiliFaqContent: data.swahili_faq_content,
      updatedAt: data.updated_at,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load admin guide and FAQ content.", error);
    return NextResponse.json({
      error: "Could not load the guide and FAQ. Confirm both user-guide-content.sql and user-guide-faq-content.sql have been run.",
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
    return NextResponse.json({ error: "Enter valid guide and FAQ content." }, { status: 400 });
  }
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    return NextResponse.json({ error: "Enter valid guide and FAQ content." }, { status: 400 });
  }

  const body = values as Record<string, unknown>;
  const hasGuideContent = body.englishContent !== undefined || body.swahiliContent !== undefined;
  const hasFaqContent = body.englishFaqContent !== undefined || body.swahiliFaqContent !== undefined;
  if (!hasGuideContent && !hasFaqContent) {
    return NextResponse.json({ error: "Enter guide or FAQ content to save." }, { status: 400 });
  }
  let guideContent: { english: string; swahili: string } | null = null;
  if (hasGuideContent) {
    if (typeof body.englishContent !== "string" || typeof body.swahiliContent !== "string" ||
      !body.englishContent.trim() || !body.swahiliContent.trim() ||
      body.englishContent.length > MAX_CONTENT_LENGTH || body.swahiliContent.length > MAX_CONTENT_LENGTH) {
      return NextResponse.json({
        error: `Enter both guide language versions. Each version must be ${MAX_CONTENT_LENGTH.toLocaleString()} characters or fewer.`,
      }, { status: 400 });
    }
    guideContent = { english: body.englishContent, swahili: body.swahiliContent };
  }
  let faqContent: { english: string; swahili: string } | null = null;
  if (hasFaqContent) {
    if (typeof body.englishFaqContent !== "string" || typeof body.swahiliFaqContent !== "string" ||
      !body.englishFaqContent.trim() || !body.swahiliFaqContent.trim() ||
      body.englishFaqContent.length > MAX_CONTENT_LENGTH || body.swahiliFaqContent.length > MAX_CONTENT_LENGTH) {
      return NextResponse.json({
        error: `Enter both FAQ language versions. Each version must be ${MAX_CONTENT_LENGTH.toLocaleString()} characters or fewer.`,
      }, { status: 400 });
    }
    faqContent = { english: body.englishFaqContent, swahili: body.swahiliFaqContent };
    try {
      parseFaqContent(faqContent.english);
      parseFaqContent(faqContent.swahili);
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : "Check the FAQ section and question headings.",
      }, { status: 400 });
    }
  }

  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { data: { user }, error: userError } = await authorized.auth.getUser(token);
  if (userError || !user) return NextResponse.json({ error: "Admin session expired." }, { status: 403 });

  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("user_guide_content")
      .update({
        ...(guideContent ? {
          english_content: guideContent.english,
          swahili_content: guideContent.swahili,
        } : {}),
        ...(faqContent ? {
          english_faq_content: faqContent.english,
          swahili_faq_content: faqContent.swahili,
        } : {}),
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      })
      .eq("id", 1)
      .select("english_content, swahili_content, english_faq_content, swahili_faq_content, updated_at")
      .single();
    if (error) throw error;

    return NextResponse.json({
      englishContent: data.english_content,
      swahiliContent: data.swahili_content,
      englishFaqContent: data.english_faq_content,
      swahiliFaqContent: data.swahili_faq_content,
      updatedAt: data.updated_at,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not save admin guide and FAQ content.", error);
    return NextResponse.json({
      error: "Could not save the guide and FAQ. Confirm both user-guide-content.sql and user-guide-faq-content.sql have been run.",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
