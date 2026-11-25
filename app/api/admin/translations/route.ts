import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";
import { getStaffAccess } from "@/lib/staff-auth";
import { ownsStaffTaskClaim } from "@/lib/staff-task-claims";
import { recordStaffTaskCompletion } from "@/lib/staff-task-completions";
import { getPendingTranslationPhrases, getTranslationPhraseTaskId } from "@/lib/translation-catalog";
import { interfaceTranslationPhrases } from "@/lib/interface-translation-catalog";
import { normalizeTranslationPhrase } from "@/lib/translation-phrase-normalization";

const interfacePhraseCatalog = new Set(interfaceTranslationPhrases.map(normalizeTranslationPhrase));

function translationPlaceholders(value: string) {
  return (value.match(/\{\{value\d+\}\}/gi) ?? []).map((placeholder) => placeholder.toLowerCase()).sort();
}

function parsePair(values: Record<string, unknown>) {
  const englishPhrase = typeof values.english_phrase === "string"
    ? values.english_phrase.trim().replace(/\s+/g, " ")
    : "";
  const swahiliPhrase = typeof values.swahili_phrase === "string" ? values.swahili_phrase.trim() : "";
  if (!englishPhrase || !swahiliPhrase || englishPhrase.length > 1000 || swahiliPhrase.length > 1000) return null;
  if (translationPlaceholders(englishPhrase).join("\n") !== translationPlaceholders(swahiliPhrase).join("\n")) return null;
  return { english_phrase: englishPhrase, swahili_phrase: swahiliPhrase };
}

function parseId(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function phraseExistsOnSite(englishPhrase: string) {
  return interfacePhraseCatalog.has(normalizeTranslationPhrase(englishPhrase));
}

async function readValues(request: Request) {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const admin = await getAdminClient(request, "translations");
    if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    const translationsResult = await admin.from("translation_pairs")
      .select("id, english_phrase, swahili_phrase")
      .order("english_phrase", { ascending: true });
    if (translationsResult.error) throw translationsResult.error;
    const translations = translationsResult.data ?? [];
    return NextResponse.json({
      translations,
      pendingPhrases: getPendingTranslationPhrases(translations),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load translation pairs." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const admin = await getAdminClient(request, "translations");
    if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    const values = await readValues(request);
    if (!values) return NextResponse.json({ error: "Invalid translation details." }, { status: 400 });
    const pair = parsePair(values);
    if (!pair) return NextResponse.json({ error: "Keep both phrases within 1000 characters and preserve every {{valueN}} placeholder." }, { status: 400 });
    if (!phraseExistsOnSite(pair.english_phrase)) {
      return NextResponse.json({ error: "That English phrase does not match a complete phrase in the interface." }, { status: 400 });
    }
    const staff = await getStaffAccess(request, "translations");
    if (staff) {
      const taskId = getTranslationPhraseTaskId(pair.english_phrase);
      if (values.catalogTaskId !== taskId ||
        !await ownsStaffTaskClaim(admin, staff.staffId, "translation_pair", taskId)) {
        return NextResponse.json({ error: "Claim this English phrase before adding its translation." }, { status: 409 });
      }
    }
    const { data, error } = await admin.from("translation_pairs").insert(pair)
      .select("id, english_phrase, swahili_phrase").single();
    if (error?.code === "23505") return NextResponse.json({ error: "A translation for that English phrase already exists." }, { status: 409 });
    if (error) throw error;
    await recordStaffTaskCompletion(admin, staff, "translation_pair", data.id, "add_translation");
    return NextResponse.json({ translation: data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Could not save the translation pair." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await getAdminClient(request, "translations");
    if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    const staff = await getStaffAccess(request, "translations");
    const values = await readValues(request);
    if (!values) return NextResponse.json({ error: "Invalid translation details." }, { status: 400 });
    const id = parseId(values.id);
    const pair = parsePair(values);
    if (!id || !pair) return NextResponse.json({ error: "Keep both phrases within 1000 characters and preserve every {{valueN}} placeholder." }, { status: 400 });
    if (staff && !await ownsStaffTaskClaim(admin, staff.staffId, "translation_pair", id)) {
      return NextResponse.json({ error: "Claim this translation before editing it." }, { status: 409 });
    }
    const { data: existingPair, error: existingPairError } = await admin.from("translation_pairs")
      .select("english_phrase").eq("id", id).maybeSingle();
    if (existingPairError) throw existingPairError;
    if (!existingPair) return NextResponse.json({ error: "Translation pair not found." }, { status: 404 });
    if (!phraseExistsOnSite(pair.english_phrase) &&
      normalizeTranslationPhrase(existingPair.english_phrase) !== normalizeTranslationPhrase(pair.english_phrase)) {
      return NextResponse.json({ error: "That English phrase does not match a complete phrase in the interface." }, { status: 400 });
    }
    const { data, error } = await admin.from("translation_pairs").update(pair).eq("id", id)
      .select("id, english_phrase, swahili_phrase").maybeSingle();
    if (error?.code === "23505") return NextResponse.json({ error: "A translation for that English phrase already exists." }, { status: 409 });
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Translation pair not found." }, { status: 404 });
    await recordStaffTaskCompletion(admin, staff, "translation_pair", id, "update_translation");
    return NextResponse.json({ translation: data });
  } catch {
    return NextResponse.json({ error: "Could not update the translation pair." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await getAdminClient(request, "translations");
    if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    const staff = await getStaffAccess(request, "translations");
    const values = await readValues(request);
    if (!values) return NextResponse.json({ error: "Invalid translation details." }, { status: 400 });
    const id = parseId(values.id);
    if (!id) return NextResponse.json({ error: "Invalid translation details." }, { status: 400 });
    if (staff && !await ownsStaffTaskClaim(admin, staff.staffId, "translation_pair", id)) {
      return NextResponse.json({ error: "Claim this translation before deleting it." }, { status: 409 });
    }
    const { data, error } = await admin.from("translation_pairs").delete().eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Translation pair not found." }, { status: 404 });
    await recordStaffTaskCompletion(admin, staff, "translation_pair", id, "delete_translation");
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json({ error: "Could not delete the translation pair." }, { status: 503 });
  }
}
