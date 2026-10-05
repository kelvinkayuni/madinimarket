import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getWebsiteAccountId } from "@/lib/website-session";

function text(values: Record<string, unknown>, key: string, maxLength = 500) {
  const value = typeof values[key] === "string" ? values[key].trim() : "";
  return value && value.length <= maxLength ? value : null;
}

function positiveNumber(values: Record<string, unknown>, key: string) {
  const value = Number(values[key]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function validEmail(value: string | null) {
  return Boolean(value && value.length <= 254 && /^\S+@\S+\.\S+$/.test(value));
}

async function readOwnedRows(admin: ReturnType<typeof createSupabaseAdminClient>, table: "listings" | "buy_requests", accountId: string) {
  const { data, error } = await admin.from(table).select("*")
    .eq("website_user_id", accountId)
    .in("status", ["pending", "rejected"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return Promise.all((data ?? []).map(async (row) => {
    if (!row.image_path) return row;
    const { data: signed } = await admin.storage.from("mineral-images").createSignedUrl(row.image_path, 3600);
    return { ...row, signed_image_url: signed?.signedUrl ?? "" };
  }));
}

export async function GET() {
  try {
    const accountId = await getWebsiteAccountId();
    if (!accountId) return NextResponse.json({ error: "Sign in to view your submissions." }, { status: 401 });
    const admin = createSupabaseAdminClient();
    const [sellers, buyers] = await Promise.all([
      readOwnedRows(admin, "listings", accountId),
      readOwnedRows(admin, "buy_requests", accountId),
    ]);
    return NextResponse.json({ sellers, buyers }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load your submissions." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null) throw new Error("Invalid request");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid submission details." }, { status: 400 });
  }

  const kind = body.kind === "seller" || body.kind === "buyer" ? body.kind : null;
  const values = typeof body.values === "object" && body.values !== null ? body.values as Record<string, unknown> : null;
  const accountId = await getWebsiteAccountId();
  if (!accountId) return NextResponse.json({ error: "Sign in again before submitting." }, { status: 401 });
  if (!kind || !values) return NextResponse.json({ error: "Invalid submission details." }, { status: 400 });

  const table = kind === "seller" ? "listings" : "buy_requests";
  const id = Number(body.id);
  const editing = Number.isSafeInteger(id) && id > 0;
  const admin = createSupabaseAdminClient();
  const { data: draft, error: draftError } = await admin.from("website_account_drafts")
    .select("image_path")
    .eq("website_user_id", accountId)
    .eq("kind", kind)
    .maybeSingle();
  if (draftError) return NextResponse.json({ error: "Could not load your saved draft." }, { status: 503 });
  let existing: { id: number; image_path: string | null } | null = null;

  if (editing) {
    if (kind === "seller") {
      const { data, error } = await admin.from("listings").select("id, image_path, status")
        .eq("id", id).eq("website_user_id", accountId).maybeSingle();
      if (error) return NextResponse.json({ error: "Could not load that submission." }, { status: 503 });
      if (!data || !["pending", "rejected"].includes(data.status)) {
        return NextResponse.json({ error: "That submission can no longer be edited." }, { status: 404 });
      }
      existing = { id: data.id, image_path: data.image_path };
    } else {
      const { data, error } = await admin.from("buy_requests").select("id, status")
        .eq("id", id).eq("website_user_id", accountId).maybeSingle();
      if (error) return NextResponse.json({ error: "Could not load that submission." }, { status: 503 });
      if (!data || !["pending", "rejected"].includes(data.status)) {
        return NextResponse.json({ error: "That submission can no longer be edited." }, { status: 404 });
      }
      existing = { id: data.id, image_path: null };
    }
  }

  const common = {
    user_id: null,
    website_user_id: accountId,
    status: "pending",
    review_message: null,
    reviewed_by: null,
    reviewed_at: null,
  };
  let rowValues: Record<string, unknown>;
  let imagePath = existing?.image_path ?? null;
  let uploadedPath: string | null = null;

  if (kind === "seller") {
    const mineralName = text(values, "mineral_name", 120);
    const weight = positiveNumber(values, "weight");
    const unit = text(values, "unit", 10);
    const price = positiveNumber(values, "price");
    const currency = text(values, "currency", 3);
    const sellerName = text(values, "seller_name", 120);
    const country = text(values, "country", 100);
    const region = text(values, "region", 100);
    const district = text(values, "district", 100);
    const street = text(values, "street", 200);
    const email = text(values, "email", 254);
    const phone = text(values, "phone", 40);
    if (!mineralName || !weight || !["carats", "g", "kg", "tons"].includes(unit ?? "") || !price || !["TZS", "USD"].includes(currency ?? "") || !sellerName || !country || !region || !district || !street || !validEmail(email) || !phone) {
      return NextResponse.json({ error: "Check the seller listing details and try again." }, { status: 400 });
    }
    const imageData = typeof body.imageData === "string" ? body.imageData : "";
    if (imageData) {
      const match = /^data:image\/jpeg;base64,([A-Za-z\d+/=]+)$/.exec(imageData);
      if (!match || match[1].length > 7_000_000) return NextResponse.json({ error: "Choose a PNG or JPG photo under 5 MB." }, { status: 400 });
      const image = Buffer.from(match[1], "base64");
      if (image.length > 5 * 1024 * 1024) return NextResponse.json({ error: "Choose a PNG or JPG photo under 5 MB." }, { status: 400 });
      uploadedPath = `${accountId}/${randomUUID()}.jpg`;
      const { error } = await admin.storage.from("mineral-images").upload(uploadedPath, image, { contentType: "image/jpeg" });
      if (error) return NextResponse.json({ error: "The photo could not be uploaded." }, { status: 503 });
      imagePath = uploadedPath;
    } else if (draft?.image_path) imagePath = draft.image_path;
    if (!imagePath) return NextResponse.json({ error: "Choose a mineral photo before submitting." }, { status: 400 });
    rowValues = {
      ...common, mineral_name: mineralName, weight, unit, price, currency, seller_name: sellerName,
      country, region, district, street, email, phone, image_path: imagePath,
    };
  } else {
    const mineralName = text(values, "mineral_name", 120);
    const weight = text(values, "weight", 80);
    const unit = text(values, "unit", 10);
    const color = text(values, "color", 100);
    const shape = text(values, "shape", 10);
    const quality = text(values, "quality", 200);
    const offer = positiveNumber(values, "offer");
    const currency = text(values, "currency", 3);
    const buyerName = text(values, "buyer_name", 120);
    const location = text(values, "location", 200);
    const email = text(values, "email", 254);
    const phone = text(values, "phone", 40);
    if (!mineralName || !weight || !["carats", "g", "kg", "tons"].includes(unit ?? "") || !color || !["Cut", "Uncut"].includes(shape ?? "") || !quality || !offer || !["TZS", "USD"].includes(currency ?? "") || !buyerName || !location || !validEmail(email) || !phone) {
      return NextResponse.json({ error: "Check the buyer request details and try again." }, { status: 400 });
    }
    rowValues = {
      ...common, mineral_name: mineralName, weight, unit, color, shape, quality, offer, currency,
      buyer_name: buyerName, location, email, phone,
    };
  }

  const result = editing
    ? await admin.from(table).update(rowValues).eq("id", id).eq("website_user_id", accountId).select("id").maybeSingle()
    : await admin.from(table).insert(rowValues).select("id").single();
  if (result.error || !result.data) {
    if (uploadedPath) await admin.storage.from("mineral-images").remove([uploadedPath]);
    return NextResponse.json({ error: "The submission could not be saved." }, { status: 503 });
  }
  if (kind === "seller" && existing?.image_path && existing.image_path !== imagePath) {
    await admin.storage.from("mineral-images").remove([existing.image_path]);
  }
  if (kind === "seller" && draft?.image_path && draft.image_path !== imagePath) {
    await admin.storage.from("mineral-images").remove([draft.image_path]);
  }
  await admin.from("website_account_drafts").delete()
    .eq("website_user_id", accountId)
    .eq("kind", kind);
  return NextResponse.json({ id: result.data.id }, { status: editing ? 200 : 201 });
}

export async function DELETE(request: Request) {
  let values: Record<string, unknown>;
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) throw new Error("Invalid request");
    values = body as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid submission details." }, { status: 400 });
  }

  const accountId = await getWebsiteAccountId();
  const kind = values.kind === "seller" || values.kind === "buyer" ? values.kind : null;
  const id = Number(values.id);
  if (!accountId) return NextResponse.json({ error: "Sign in again before deleting." }, { status: 401 });
  if (!kind || !Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Invalid submission details." }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const table = kind === "seller" ? "listings" : "buy_requests";
  let existing: { id: number; image_path: string | null; status: string } | null;
  if (kind === "seller") {
    const { data, error } = await admin.from("listings").select("id, image_path, status")
      .eq("id", id).eq("website_user_id", accountId).maybeSingle();
    if (error) return NextResponse.json({ error: "Could not load that submission." }, { status: 503 });
    existing = data;
  } else {
    const { data, error } = await admin.from("buy_requests").select("id, status")
      .eq("id", id).eq("website_user_id", accountId).maybeSingle();
    if (error) return NextResponse.json({ error: "Could not load that submission." }, { status: 503 });
    existing = data ? { id: data.id, image_path: null, status: data.status } : null;
  }
  if (!existing || !["pending", "rejected"].includes(existing.status)) {
    return NextResponse.json({ error: "That submission can no longer be deleted." }, { status: 404 });
  }
  const { error } = await admin.from(table).delete().eq("id", id).eq("website_user_id", accountId);
  if (error) return NextResponse.json({ error: "The submission could not be deleted." }, { status: 503 });
  if (kind === "seller" && existing.image_path) await admin.storage.from("mineral-images").remove([existing.image_path]);
  return NextResponse.json({ deleted: true });
}
