import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getWebsiteAccountId } from "@/lib/website-session";

type DraftKind = "seller" | "buyer";

const allowedFields: Record<DraftKind, Set<string>> = {
  seller: new Set(["mineral", "color", "comment", "listing_type", "weight", "unit", "smallest_stone_weight", "largest_stone_weight", "stone_weight_unit", "price", "currency", "seller", "country", "region", "district", "street", "email", "phone"]),
  buyer: new Set(["mineral", "weight", "unit", "color", "shape", "quality", "offer", "currency", "buyer", "location", "email", "phone"]),
};

function getKind(value: unknown): DraftKind | null {
  return value === "seller" || value === "buyer" ? value : null;
}

function getPayload(kind: DraftKind, value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const values = value as Record<string, unknown>;
  const payload: Record<string, string | number> = {};
  for (const [key, item] of Object.entries(values)) {
    if (key === "submissionId") {
      const id = Number(item);
      if (!Number.isSafeInteger(id) || id < 1) return null;
      payload[key] = id;
    } else if (allowedFields[kind].has(key) && typeof item === "string" && item.length <= 500) {
      payload[key] = item;
    } else {
      return null;
    }
  }
  if (JSON.stringify(payload).length > 12_000) return null;
  return payload;
}

async function withImageUrl(admin: ReturnType<typeof createSupabaseAdminClient>, draft: { kind: DraftKind; payload: unknown; image_path: string | null; updated_at: string }) {
  if (!draft.image_path) return draft;
  const { data } = await admin.storage.from("mineral-images").createSignedUrl(draft.image_path, 3600);
  return { ...draft, image_url: data?.signedUrl ?? "" };
}

export async function GET(request: Request) {
  try {
    const accountId = await getWebsiteAccountId(request);
    if (!accountId) return NextResponse.json({ error: "Sign in to load your saved drafts." }, { status: 401 });
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("website_account_drafts")
      .select("kind, payload, image_path, updated_at")
      .eq("website_user_id", accountId);
    if (error) throw error;
    const drafts = await Promise.all((data ?? []).map((draft) => withImageUrl(admin, draft as { kind: DraftKind; payload: unknown; image_path: string | null; updated_at: string })));
    return NextResponse.json({ drafts }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load saved drafts." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Invalid draft");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid draft data." }, { status: 400 });
  }

  const accountId = await getWebsiteAccountId(request);
  const kind = getKind(body.kind);
  const payload = kind ? getPayload(kind, body.payload) : null;
  if (!accountId) return NextResponse.json({ error: "Sign in again to save your draft." }, { status: 401 });
  if (!kind || !payload) return NextResponse.json({ error: "Invalid draft data." }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { data: current, error: currentError } = await admin.from("website_account_drafts")
    .select("image_path")
    .eq("website_user_id", accountId)
    .eq("kind", kind)
    .maybeSingle();
  if (currentError) return NextResponse.json({ error: "Could not update the saved draft." }, { status: 503 });

  let imagePath = current?.image_path ?? null;
  let uploadedPath: string | null = null;
  const imageData = typeof body.imageData === "string" ? body.imageData : "";
  if (imageData) {
    if (kind !== "seller") return NextResponse.json({ error: "Buyer requests cannot include a photo." }, { status: 400 });
    const match = /^data:image\/jpeg;base64,([A-Za-z\d+/=]+)$/.exec(imageData);
    if (!match || match[1].length > 7_000_000) return NextResponse.json({ error: "Choose a JPG photo under 5 MB." }, { status: 400 });
    const image = Buffer.from(match[1], "base64");
    if (image.length > 5 * 1024 * 1024) return NextResponse.json({ error: "Choose a JPG photo under 5 MB." }, { status: 400 });
    uploadedPath = `${accountId}/drafts/seller/${randomUUID()}.jpg`;
    const { error } = await admin.storage.from("mineral-images").upload(uploadedPath, image, { contentType: "image/jpeg" });
    if (error) return NextResponse.json({ error: "The draft photo could not be saved." }, { status: 503 });
    imagePath = uploadedPath;
  }

  const { data, error } = await admin.from("website_account_drafts").upsert({
    website_user_id: accountId,
    kind,
    payload,
    image_path: imagePath,
    updated_at: new Date().toISOString(),
  }, { onConflict: "website_user_id,kind" })
    .select("kind, payload, image_path, updated_at")
    .single();
  if (error || !data) {
    if (uploadedPath) await admin.storage.from("mineral-images").remove([uploadedPath]);
    return NextResponse.json({ error: "Could not save your draft." }, { status: 503 });
  }
  if (uploadedPath && current?.image_path) await admin.storage.from("mineral-images").remove([current.image_path]);
  return NextResponse.json({ draft: await withImageUrl(admin, data as { kind: DraftKind; payload: unknown; image_path: string | null; updated_at: string }) }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Invalid draft");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid draft data." }, { status: 400 });
  }

  const accountId = await getWebsiteAccountId(request);
  const kind = getKind(body.kind);
  if (!accountId) return NextResponse.json({ error: "Sign in again to clear your draft." }, { status: 401 });
  if (!kind) return NextResponse.json({ error: "Invalid draft data." }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { data: draft, error: lookupError } = await admin.from("website_account_drafts")
    .select("image_path")
    .eq("website_user_id", accountId)
    .eq("kind", kind)
    .maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Could not clear the saved draft." }, { status: 503 });
  const { error } = await admin.from("website_account_drafts").delete()
    .eq("website_user_id", accountId)
    .eq("kind", kind);
  if (error) return NextResponse.json({ error: "Could not clear the saved draft." }, { status: 503 });
  if (draft?.image_path) await admin.storage.from("mineral-images").remove([draft.image_path]);
  return NextResponse.json({ cleared: true });
}
