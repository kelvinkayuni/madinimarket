import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getWebsiteAccountId } from "@/lib/website-session";
import { calculateListingPrice, type ListingCurrency } from "@/lib/listing-pricing";

function text(values: Record<string, unknown>, key: string, maxLength = 500) {
  const value = typeof values[key] === "string" ? values[key].trim() : "";
  return value && value.length <= maxLength ? value : null;
}

function positiveNumber(values: Record<string, unknown>, key: string) {
  const value = Number(values[key]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function weightInGrams(weight: number, unit: string) {
  const gramsPerUnit: Record<string, number> = { carats: 0.2, g: 1, kg: 1_000, tons: 1_000_000 };
  return weight * gramsPerUnit[unit];
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

async function readOwnedMarketRows(admin: ReturnType<typeof createSupabaseAdminClient>, table: "listings" | "buy_requests", accountId: string) {
  if (table === "listings") {
    const { data, error } = await admin.from("listings")
      .select("id, mineral_name, listing_type, weight, unit, smallest_stone_weight, largest_stone_weight, stone_weight_unit, seller_price, platform_fee_rate, platform_fee_amount, price, currency, country, region, district, image_path")
      .eq("website_user_id", accountId)
      .eq("status", "approved")
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return Promise.all((data ?? []).map(async (row) => {
      if (!row.image_path) return { ...row, signed_image_url: "" };
      const { data: signed, error: signedUrlError } = await admin.storage.from("mineral-images").createSignedUrl(row.image_path, 3600);
      if (signedUrlError) throw signedUrlError;
      return { ...row, signed_image_url: signed.signedUrl };
    }));
  }
  const { data, error } = await admin.from("buy_requests")
    .select("id, mineral_name, weight, unit, color, shape, quality, offer, currency, location")
    .eq("website_user_id", accountId)
    .eq("status", "approved")
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function GET() {
  try {
    const accountId = await getWebsiteAccountId();
    if (!accountId) return NextResponse.json({ error: "Sign in to view your submissions." }, { status: 401 });
    const admin = createSupabaseAdminClient();
    const [sellers, buyers, marketSellers, marketBuyers] = await Promise.all([
      readOwnedRows(admin, "listings", accountId),
      readOwnedRows(admin, "buy_requests", accountId),
      readOwnedMarketRows(admin, "listings", accountId),
      readOwnedMarketRows(admin, "buy_requests", accountId),
    ]);
    return NextResponse.json({ sellers, buyers, marketSellers, marketBuyers }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load your submissions." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  let stoneCertificate: File | null = null;
  try {
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData();
      const rawValues = form.get("values");
      body = {
        kind: form.get("kind"),
        id: form.get("id"),
        imageData: form.get("imageData"),
        values: typeof rawValues === "string" ? JSON.parse(rawValues) : null,
      };
      const uploadedFile = form.get("stoneCertificate");
      if (uploadedFile instanceof File && uploadedFile.size) stoneCertificate = uploadedFile;
    } else {
      const parsed: unknown = await request.json();
      if (typeof parsed !== "object" || parsed === null) throw new Error("Invalid request");
      body = parsed as Record<string, unknown>;
    }
  } catch {
    return NextResponse.json({ error: "Invalid submission details." }, { status: 400 });
  }

  const kind = body.kind === "seller" || body.kind === "buyer" ? body.kind : null;
  const values = typeof body.values === "object" && body.values !== null ? body.values as Record<string, unknown> : null;
  const accountId = await getWebsiteAccountId();
  if (!accountId) return NextResponse.json({ error: "Sign in again before submitting." }, { status: 401 });
  if (!kind || !values) return NextResponse.json({ error: "Invalid submission details." }, { status: 400 });
  if (kind !== "seller" && stoneCertificate) return NextResponse.json({ error: "Stone certificates can only be attached to mineral listings." }, { status: 400 });

  const table = kind === "seller" ? "listings" : "buy_requests";
  const admin = createSupabaseAdminClient();
  if (text(values, "currency", 3) === "USD") {
    const { data: currencySettings, error } = await admin.from("marketplace_settings")
      .select("usd_enabled")
      .eq("id", true)
      .single();
    if (error) return NextResponse.json({ error: "Could not verify marketplace currency settings." }, { status: 503 });
    if (!currencySettings.usd_enabled) {
      return NextResponse.json({ error: "USD is disabled. Select TSh to submit." }, { status: 400 });
    }
  }
  if (kind === "seller") {
    const { count, error } = await admin.from("website_account_certificates")
      .select("id", { count: "exact", head: true })
      .eq("website_user_id", accountId)
      .eq("status", "approved");
    if (error) return NextResponse.json({ error: "Could not verify your seller licence." }, { status: 503 });
    if (!count) return NextResponse.json({ error: "An approved dealer or broker licence is required before listing a mineral." }, { status: 403 });
  }
  const id = Number(body.id);
  const editing = Number.isSafeInteger(id) && id > 0;
  const { data: draft, error: draftError } = await admin.from("website_account_drafts")
    .select("image_path")
    .eq("website_user_id", accountId)
    .eq("kind", kind)
    .maybeSingle();
  if (draftError) return NextResponse.json({ error: "Could not load your saved draft." }, { status: 503 });
  let existing: { id: number; image_path: string | null; stone_certificate_path: string | null } | null = null;

  if (editing) {
    if (kind === "seller") {
      const { data, error } = await admin.from("listings").select("id, image_path, stone_certificate_path, status")
        .eq("id", id).eq("website_user_id", accountId).maybeSingle();
      if (error) return NextResponse.json({ error: "Could not load that submission." }, { status: 503 });
      if (!data || !["pending", "rejected"].includes(data.status)) {
        return NextResponse.json({ error: "That submission can no longer be edited." }, { status: 404 });
      }
      existing = { id: data.id, image_path: data.image_path, stone_certificate_path: data.stone_certificate_path };
    } else {
      const { data, error } = await admin.from("buy_requests").select("id, status")
        .eq("id", id).eq("website_user_id", accountId).maybeSingle();
      if (error) return NextResponse.json({ error: "Could not load that submission." }, { status: 503 });
      if (!data || !["pending", "rejected"].includes(data.status)) {
        return NextResponse.json({ error: "That submission can no longer be edited." }, { status: 404 });
      }
      existing = { id: data.id, image_path: null, stone_certificate_path: null };
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
  let stoneCertificatePath = existing?.stone_certificate_path ?? null;
  let uploadedStoneCertificatePath: string | null = null;

  if (kind === "seller") {
    const mineralName = text(values, "mineral_name", 120);
    const listingType = text(values, "listing_type", 10) ?? "single";
    const weight = positiveNumber(values, "weight");
    const unit = text(values, "unit", 10);
    const smallestStoneWeight = listingType === "batch" ? positiveNumber(values, "smallest_stone_weight") : null;
    const largestStoneWeight = listingType === "batch" ? positiveNumber(values, "largest_stone_weight") : null;
    const stoneWeightUnit = listingType === "batch" ? text(values, "stone_weight_unit", 10) : null;
    const sellerPrice = positiveNumber(values, "price");
    const currency = text(values, "currency", 3);
    const sellerName = text(values, "seller_name", 120);
    const country = text(values, "country", 100);
    const region = text(values, "region", 100);
    const district = text(values, "district", 100);
    const street = text(values, "street", 200);
    const email = text(values, "email", 254);
    const phone = text(values, "phone", 40);
    if (!mineralName || !["single", "batch"].includes(listingType) || !weight || !["carats", "g", "kg", "tons"].includes(unit ?? "") || !sellerPrice || !["TZS", "USD"].includes(currency ?? "") || !sellerName || !country || !region || !district || !street || !validEmail(email) || !phone) {
      return NextResponse.json({ error: "Check the seller listing details and try again." }, { status: 400 });
    }
    const pricing = calculateListingPrice(sellerPrice, currency as ListingCurrency);
    if (listingType === "batch" && (
      !smallestStoneWeight ||
      !largestStoneWeight ||
      !["carats", "g", "kg"].includes(stoneWeightUnit ?? "") ||
      smallestStoneWeight > largestStoneWeight ||
      weightInGrams(largestStoneWeight, stoneWeightUnit ?? "") > weightInGrams(weight, unit ?? "")
    )) {
      return NextResponse.json({ error: "Check the batch weights. The smallest stone must not exceed the largest, and the largest must fit within the total batch weight." }, { status: 400 });
    }
    if (stoneCertificate) {
      if (stoneCertificate.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Choose a PDF or JPEG stone certificate no larger than 10 MB." }, { status: 400 });
      const certificateBytes = new Uint8Array(await stoneCertificate.arrayBuffer());
      const isPdf = certificateBytes.length >= 5 && new TextDecoder().decode(certificateBytes.slice(0, 5)) === "%PDF-";
      const isJpeg = certificateBytes.length >= 3 && certificateBytes[0] === 0xff && certificateBytes[1] === 0xd8 && certificateBytes[2] === 0xff;
      if (!isPdf && !isJpeg) return NextResponse.json({ error: "Choose a valid PDF or JPEG stone certificate." }, { status: 400 });
      const extension = isPdf ? "pdf" : "jpg";
      const contentType = isPdf ? "application/pdf" : "image/jpeg";
      uploadedStoneCertificatePath = `${accountId}/${randomUUID()}.${extension}`;
      const { error } = await admin.storage.from("stone-certificates").upload(uploadedStoneCertificatePath, Buffer.from(certificateBytes), { contentType });
      if (error) return NextResponse.json({ error: "The stone certificate could not be uploaded." }, { status: 503 });
      stoneCertificatePath = uploadedStoneCertificatePath;
    }
    const imageData = typeof body.imageData === "string" ? body.imageData : "";
    if (imageData) {
      const match = /^data:image\/jpeg;base64,([A-Za-z\d+/=]+)$/.exec(imageData);
      if (!match || match[1].length > 7_000_000) {
        if (uploadedStoneCertificatePath) await admin.storage.from("stone-certificates").remove([uploadedStoneCertificatePath]);
        return NextResponse.json({ error: "Choose a PNG or JPG photo under 5 MB." }, { status: 400 });
      }
      const image = Buffer.from(match[1], "base64");
      if (image.length > 5 * 1024 * 1024) {
        if (uploadedStoneCertificatePath) await admin.storage.from("stone-certificates").remove([uploadedStoneCertificatePath]);
        return NextResponse.json({ error: "Choose a PNG or JPG photo under 5 MB." }, { status: 400 });
      }
      uploadedPath = `${accountId}/${randomUUID()}.jpg`;
      const { error } = await admin.storage.from("mineral-images").upload(uploadedPath, image, { contentType: "image/jpeg" });
      if (error) {
        if (uploadedStoneCertificatePath) await admin.storage.from("stone-certificates").remove([uploadedStoneCertificatePath]);
        return NextResponse.json({ error: "The photo could not be uploaded." }, { status: 503 });
      }
      imagePath = uploadedPath;
    } else if (draft?.image_path) imagePath = draft.image_path;
    if (!imagePath) {
      if (uploadedStoneCertificatePath) await admin.storage.from("stone-certificates").remove([uploadedStoneCertificatePath]);
      return NextResponse.json({ error: "Choose a mineral photo before submitting." }, { status: 400 });
    }
    rowValues = {
      ...common, mineral_name: mineralName, listing_type: listingType, weight, unit,
      smallest_stone_weight: smallestStoneWeight, largest_stone_weight: largestStoneWeight,
      stone_weight_unit: stoneWeightUnit, seller_price: pricing.sellerPrice,
      platform_fee_rate: pricing.platformFeeRate, platform_fee_amount: pricing.platformFeeAmount,
      price: pricing.marketPrice, currency, seller_name: sellerName,
      country, region, district, street, email, phone, image_path: imagePath, stone_certificate_path: stoneCertificatePath,
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
    if (uploadedStoneCertificatePath) await admin.storage.from("stone-certificates").remove([uploadedStoneCertificatePath]);
    return NextResponse.json({ error: "The submission could not be saved." }, { status: 503 });
  }
  if (kind === "seller" && existing?.image_path && existing.image_path !== imagePath) {
    await admin.storage.from("mineral-images").remove([existing.image_path]);
  }
  if (kind === "seller" && existing?.stone_certificate_path && existing.stone_certificate_path !== stoneCertificatePath) {
    await admin.storage.from("stone-certificates").remove([existing.stone_certificate_path]);
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
  let existing: { id: number; image_path: string | null; stone_certificate_path: string | null; status: string } | null;
  if (kind === "seller") {
    const { data, error } = await admin.from("listings").select("id, image_path, stone_certificate_path, status")
      .eq("id", id).eq("website_user_id", accountId).maybeSingle();
    if (error) return NextResponse.json({ error: "Could not load that submission." }, { status: 503 });
    existing = data;
  } else {
    const { data, error } = await admin.from("buy_requests").select("id, status")
      .eq("id", id).eq("website_user_id", accountId).maybeSingle();
    if (error) return NextResponse.json({ error: "Could not load that submission." }, { status: 503 });
    existing = data ? { id: data.id, image_path: null, stone_certificate_path: null, status: data.status } : null;
  }
  if (!existing || !["pending", "rejected"].includes(existing.status)) {
    return NextResponse.json({ error: "That submission can no longer be deleted." }, { status: 404 });
  }
  const { error } = await admin.from(table).delete().eq("id", id).eq("website_user_id", accountId);
  if (error) return NextResponse.json({ error: "The submission could not be deleted." }, { status: 503 });
  if (kind === "seller" && existing.image_path) await admin.storage.from("mineral-images").remove([existing.image_path]);
  if (kind === "seller" && existing.stone_certificate_path) await admin.storage.from("stone-certificates").remove([existing.stone_certificate_path]);
  return NextResponse.json({ deleted: true });
}
