import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getWebsiteAccountId } from "@/lib/website-session";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

type Body = Record<string, unknown>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function numeric(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

async function readBody(request: Request): Promise<Body | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? body as Body : null;
  } catch {
    return null;
  }
}

function fail(error: { message: string; code?: string }) {
  console.error("Marketplace private offer operation failed", error);
  return NextResponse.json(
    { error: error.message || "The private offer request could not be completed." },
    { status: error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 409 },
  );
}

export async function GET(request: Request) {
  const accountId = await getWebsiteAccountId(request);
  if (!accountId) return NextResponse.json({ error: "Sign in to view private offers." }, { status: 401 });

  try {
    const admin = createSupabaseAdminClient();
    const [{ data: threads, error: threadError }, { data: settings, error: settingsError }] = await Promise.all([
      admin.from("marketplace_private_offer_threads")
        .select("id, request_id, buyer_id, seller_id, state, attempt_count, closed_at, close_reason, buyer_deleted_at, seller_deleted_at, created_at, updated_at")
        .or(`buyer_id.eq.${accountId},seller_id.eq.${accountId}`)
        .neq("state", "ordered")
        .order("updated_at", { ascending: false })
        .limit(100),
      admin.from("marketplace_settings").select("listing_fee_rate, usd_enabled").eq("id", true).single(),
    ]);
    if (threadError || settingsError) throw threadError ?? settingsError;
    const threadIds = (threads ?? []).map((thread) => thread.id);
    if (threadIds.length === 0) return NextResponse.json({
      threads: [],
      feeRate: null,
      usdEnabled: settings.usd_enabled,
    });

    const sellerThreadIds = new Set(
      (threads ?? []).filter((thread) => thread.seller_id === accountId).map((thread) => thread.id),
    );
    const requestIds = [...new Set((threads ?? []).map((thread) => thread.request_id))];
    const accountIds = [...new Set((threads ?? []).flatMap((thread) => [thread.seller_id, thread.buyer_id]))];
    const [{ data: offers, error: offerError }, { data: requests, error: requestError }, { data: accounts, error: accountError }] = await Promise.all([
      admin.from("marketplace_private_offers").select("id, thread_id, attempt_number, mineral_name, listing_type, weight, unit, smallest_stone_weight, largest_stone_weight, stone_weight_unit, color, shape, quality, image_path, certificate_path, certificate_file_name, certificate_content_type, decline_reason, decline_explanation, declined_at, country, region, district, seller_amount, platform_fee_rate, platform_fee_amount, total_price, currency, status, availability_confirmed_at, checkout_deadline, created_at").in("thread_id", threadIds).order("attempt_number"),
      admin.from("buy_requests").select("id, mineral_name, weight, unit, color, shape, quality, offer, currency, location")
        .in("id", requestIds),
      admin.from("website_accounts").select("id, username").in("id", accountIds),
    ]);
    if (offerError || requestError || accountError) throw offerError ?? requestError ?? accountError;

    const offerIds = (offers ?? []).map((offer) => offer.id);
    const { data: completedOrderItems, error: completedOrderItemsError } = offerIds.length
      ? await admin.from("marketplace_order_items").select("private_offer_id")
        .in("private_offer_id", offerIds).eq("status", "payout_paid")
      : { data: [], error: null };
    if (completedOrderItemsError) throw completedOrderItemsError;
    const completedOfferIds = new Set((completedOrderItems ?? []).map((item) => item.private_offer_id));
    const completedThreadIds = new Set(
      (offers ?? [])
        .filter((offer) => completedOfferIds.has(offer.id))
        .map((offer) => offer.thread_id),
    );
    const visibleThreads = (threads ?? []).filter((thread) => !completedThreadIds.has(thread.id));
    const visibleOffers = (offers ?? []).filter((offer) => !completedOfferIds.has(offer.id));
    const requestById = new Map((requests ?? []).map((request) => [request.id, request]));
    const usernameById = new Map((accounts ?? []).map((account) => [account.id, account.username]));
    const safeOffersByThread = new Map<string, Array<Record<string, unknown>>>();
    const safeOffers = await Promise.all(visibleOffers.map(async (offer) => {
      const {
        image_path: imagePath,
        certificate_path: certificatePath,
        certificate_file_name: certificateFileName,
        certificate_content_type: certificateContentType,
        seller_amount: sellerAmount,
        platform_fee_rate: platformFeeRate,
        platform_fee_amount: platformFeeAmount,
        ...safeOffer
      } = offer;
      let signedImageUrl: string | null = null;
      if (imagePath) {
        const { data: signed, error } = await admin.storage.from("mineral-images").createSignedUrl(imagePath, 3600);
        if (error || !signed?.signedUrl) throw error ?? new Error("Could not sign a private offer image.");
        signedImageUrl = signed.signedUrl;
      }
      let signedCertificateUrl: string | null = null;
      if (certificatePath) {
        const { data: signed, error } = await admin.storage.from("private-offer-certificates").createSignedUrl(certificatePath, 3600);
        if (error || !signed?.signedUrl) throw error ?? new Error("Could not sign the private mineral certificate.");
        signedCertificateUrl = signed.signedUrl;
      }
      return {
        thread_id: offer.thread_id,
        offer: {
          ...safeOffer,
          ...(sellerThreadIds.has(offer.thread_id)
            ? { seller_amount: sellerAmount, platform_fee_rate: platformFeeRate, platform_fee_amount: platformFeeAmount }
            : {}),
          signed_image_url: signedImageUrl,
          signed_certificate_url: signedCertificateUrl,
          certificate_file_name: certificateFileName,
          certificate_content_type: certificateContentType,
        },
      };
    }));
    for (const { thread_id, offer } of safeOffers) {
      const entries = safeOffersByThread.get(thread_id) ?? [];
      entries.push(offer);
      safeOffersByThread.set(thread_id, entries);
    }
    return NextResponse.json({
      feeRate: sellerThreadIds.size > 0 ? Number(settings.listing_fee_rate) : null,
      usdEnabled: settings.usd_enabled,
      threads: visibleThreads.filter((thread) =>
        thread.buyer_id === accountId ? !thread.buyer_deleted_at : !thread.seller_deleted_at
      ).map(({ buyer_id: buyerId, seller_id: sellerId, ...thread }) => ({
        ...thread,
        side: buyerId === accountId ? "buyer" : "seller",
        seller_username: usernameById.get(sellerId) ?? "Madinimarket seller",
        request: requestById.get(thread.request_id) ?? null,
        offers: safeOffersByThread.get(thread.id) ?? [],
      })),
    });
  } catch (error) {
    console.error("Marketplace private offers could not be loaded", error);
    return NextResponse.json({ error: "Could not load private offers. Please try again." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const accountId = await getWebsiteAccountId(request);
  if (!accountId) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const action = text(body.action, 50);

  try {
    const admin = createSupabaseAdminClient();
    if (action === "close_offer_thread") {
      const threadId = text(body.threadId, 36);
      if (!uuidPattern.test(threadId)) return NextResponse.json({ error: "Choose a valid private offer." }, { status: 400 });
      const { data: thread, error: threadError } = await admin.from("marketplace_private_offer_threads")
        .select("id, buyer_id, seller_id, state")
        .eq("id", threadId)
        .maybeSingle();
      if (threadError) throw threadError;
      if (!thread || (thread.buyer_id !== accountId && thread.seller_id !== accountId)) {
        return NextResponse.json({ error: "Private offer not found." }, { status: 404 });
      }
      if (!["open", "closed"].includes(thread.state)) {
        return NextResponse.json({ error: "This private offer cannot be closed manually." }, { status: 409 });
      }
      const now = new Date().toISOString();
      const { error: closeError } = await admin.from("marketplace_private_offer_threads")
        .update({ state: "closed", closed_at: now, closed_by: accountId, updated_at: now })
        .eq("id", threadId);
      if (closeError) throw closeError;
      const { error: offerCloseError } = await admin.from("marketplace_private_offers")
        .update({ status: "closed" })
        .eq("thread_id", threadId)
        .eq("status", "pending");
      if (offerCloseError) throw offerCloseError;
      return NextResponse.json({ ok: true });
    }

    if (action === "delete_closed_offer_thread") {
      const threadId = text(body.threadId, 36);
      if (!uuidPattern.test(threadId)) return NextResponse.json({ error: "Choose a valid private offer." }, { status: 400 });
      const { data: thread, error: threadError } = await admin.from("marketplace_private_offer_threads")
        .select("id, buyer_id, seller_id, state")
        .eq("id", threadId)
        .maybeSingle();
      if (threadError) throw threadError;
      if (!thread || (thread.buyer_id !== accountId && thread.seller_id !== accountId)) {
        return NextResponse.json({ error: "Private offer not found." }, { status: 404 });
      }
      if (thread.state !== "closed") return NextResponse.json({ error: "Only closed private offers can be deleted." }, { status: 409 });
      const update = thread.buyer_id === accountId
        ? { buyer_deleted_at: new Date().toISOString() }
        : { seller_deleted_at: new Date().toISOString() };
      const { error: deleteError } = await admin.from("marketplace_private_offer_threads").update(update).eq("id", threadId);
      if (deleteError) throw deleteError;
      return NextResponse.json({ ok: true });
    }

    if (action === "clear_closed_offer_threads") {
      const { data: threads, error: threadsError } = await admin.from("marketplace_private_offer_threads")
        .select("id, buyer_id, seller_id")
        .eq("state", "closed")
        .or(`buyer_id.eq.${accountId},seller_id.eq.${accountId}`);
      if (threadsError) throw threadsError;
      for (const thread of threads ?? []) {
        const update = thread.buyer_id === accountId
          ? { buyer_deleted_at: new Date().toISOString() }
          : { seller_deleted_at: new Date().toISOString() };
        const { error: clearError } = await admin.from("marketplace_private_offer_threads").update(update).eq("id", thread.id);
        if (clearError) throw clearError;
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "send_offer") {
      const requestId = Number(body.requestId);
      const threadId = body.threadId === null || body.threadId === undefined || body.threadId === ""
        ? null
        : text(body.threadId, 36);
      if (body.availabilityConfirmed !== true) {
        return NextResponse.json({ error: "Confirm that the mineral is available before sending this offer." }, { status: 400 });
      }
      if (!Number.isSafeInteger(requestId) || requestId < 1 || (threadId !== null && !uuidPattern.test(threadId))) {
        return NextResponse.json({ error: "Choose a valid buyer request." }, { status: 400 });
      }
      const { data: requestOwner, error: requestOwnerError } = await admin.from("buy_requests")
        .select("website_user_id")
        .eq("id", requestId)
        .maybeSingle();
      if (requestOwnerError) throw requestOwnerError;
      if (requestOwner?.website_user_id === accountId) {
        return NextResponse.json({ error: "You cannot send a private offer to your own buying request." }, { status: 403 });
      }
      const weight = numeric(body.weight);
      const sellerAmount = numeric(body.sellerAmount);
      const smallest = body.smallestStoneWeight === "" || body.smallestStoneWeight === null || body.smallestStoneWeight === undefined
        ? null : numeric(body.smallestStoneWeight);
      const largest = body.largestStoneWeight === "" || body.largestStoneWeight === null || body.largestStoneWeight === undefined
        ? null : numeric(body.largestStoneWeight);
      const imageData = typeof body.imageData === "string" ? body.imageData : "";
      const imageMatch = /^data:image\/jpeg;base64,([A-Za-z\d+/=]+)$/.exec(imageData);
      if (!Number.isSafeInteger(requestId) || requestId < 1 || (threadId !== null && !uuidPattern.test(threadId))
        || weight === null || sellerAmount === null || !imageMatch || imageMatch[1].length > 7_000_000
        || ((body.listingType === "batch") && (smallest === null || largest === null))) {
        return NextResponse.json({ error: "Enter valid mineral details and price, and attach a mineral photo." }, { status: 400 });
      }
      const imageBytes = Buffer.from(imageMatch[1], "base64");
      if (imageBytes.length < 3 || imageBytes.length > 5 * 1024 * 1024 ||
        imageBytes[0] !== 0xff || imageBytes[1] !== 0xd8 || imageBytes[2] !== 0xff) {
        return NextResponse.json({ error: "Choose a mineral photo smaller than 5 MB." }, { status: 400 });
      }
      const certificateData = typeof body.certificateData === "object" && body.certificateData !== null
        ? body.certificateData as Record<string, unknown> : null;
      let certificatePath: string | null = null;
      let certificateFileName: string | null = null;
      let certificateContentType: string | null = null;
      if (certificateData) {
        const certificateType = text(certificateData.type, 50);
        const certificateRaw = typeof certificateData.data === "string" ? certificateData.data : "";
        const certificateMatch = /^data:(application\/pdf|image\/jpeg|image\/png);base64,([A-Za-z\d+/=]+)$/.exec(certificateRaw);
        if (!certificateMatch || !["application/pdf", "image/jpeg", "image/png"].includes(certificateType) || certificateType !== certificateMatch[1]) {
          return NextResponse.json({ error: "Choose a valid PDF, JPG, or PNG mineral certificate." }, { status: 400 });
        }
        const certificateBytes = Buffer.from(certificateMatch[2], "base64");
        if (certificateBytes.length < 1 || certificateBytes.length > 10 * 1024 * 1024) {
          return NextResponse.json({ error: "Choose a mineral certificate smaller than 10 MB." }, { status: 400 });
        }
        certificateFileName = text(certificateData.name, 180);
        certificateContentType = certificateType;
        const extension = certificateType === "application/pdf" ? "pdf" : certificateType === "image/png" ? "png" : "jpg";
        certificatePath = `${accountId}/${randomUUID()}.${extension}`;
      }
      const imagePath = `${accountId}/${randomUUID()}.jpg`;
      const { error: uploadError } = await admin.storage.from("mineral-images").upload(imagePath, imageBytes, {
        contentType: "image/jpeg",
      });
      if (uploadError) throw uploadError;
      let uploadedCertificatePath: string | null = null;
      if (certificatePath && certificateContentType && certificateData?.data) {
        const certificateMatch = /^data:[^;]+;base64,([A-Za-z\d+/=]+)$/.exec(String(certificateData.data));
        if (certificateMatch) {
          const { error: certificateUploadError } = await admin.storage.from("private-offer-certificates").upload(
            certificatePath,
            Buffer.from(certificateMatch[1], "base64"),
            { contentType: certificateContentType },
          );
          if (certificateUploadError) {
            await admin.storage.from("mineral-images").remove([imagePath]);
            throw certificateUploadError;
          }
          uploadedCertificatePath = certificatePath;
        }
      }
      const { data: offerId, error } = await admin.rpc("send_marketplace_private_offer", {
        p_seller_id: accountId,
        p_request_id: requestId,
        p_thread_id: threadId,
        p_mineral_name: text(body.mineralName, 120),
        p_listing_type: text(body.listingType, 20),
        p_weight: weight,
        p_unit: text(body.unit, 20),
        p_smallest_stone_weight: smallest,
        p_largest_stone_weight: largest,
        p_stone_weight_unit: text(body.stoneWeightUnit, 20) || null,
        p_color: text(body.color, 100),
        p_shape: text(body.shape, 20),
        p_quality: text(body.quality, 200),
        p_image_path: imagePath,
        p_country: text(body.country, 100),
        p_region: text(body.region, 100),
        p_district: text(body.district, 100),
        p_seller_amount: sellerAmount,
        p_currency: text(body.currency, 3),
      });
      if (error) {
        await admin.storage.from("mineral-images").remove([imagePath]);
        if (uploadedCertificatePath) await admin.storage.from("private-offer-certificates").remove([uploadedCertificatePath]);
        return fail(error);
      }
      if (uploadedCertificatePath && typeof offerId === "string") {
        const { error: metadataError } = await admin.from("marketplace_private_offers")
          .update({
            certificate_path: uploadedCertificatePath,
            certificate_file_name: certificateFileName,
            certificate_content_type: certificateContentType,
          })
          .eq("id", offerId);
        if (metadataError) {
          await admin.storage.from("mineral-images").remove([imagePath]);
          await admin.storage.from("private-offer-certificates").remove([uploadedCertificatePath]);
          throw metadataError;
        }
      }
      return NextResponse.json({ ok: true, offerId });
    }

    if (action === "decide_offer") {
      const offerId = text(body.offerId, 36);
      if (!uuidPattern.test(offerId) || typeof body.agree !== "boolean") {
        return NextResponse.json({ error: "Choose whether to accept or decline this offer." }, { status: 400 });
      }
      const declineReason = text(body.declineReason, 100);
      const declineExplanation = text(body.declineExplanation, 500);
      if (!body.agree && !declineReason) {
        return NextResponse.json({ error: "Choose a reason for declining the offer." }, { status: 400 });
      }
      const { data: offerOwnership, error: ownershipError } = await admin.from("marketplace_private_offers")
        .select("thread_id")
        .eq("id", offerId)
        .maybeSingle();
      if (ownershipError) throw ownershipError;
      if (!offerOwnership) return NextResponse.json({ error: "Private offer not found." }, { status: 404 });
      const { data: threadOwnership, error: threadOwnershipError } = await admin.from("marketplace_private_offer_threads")
        .select("buyer_id")
        .eq("id", offerOwnership.thread_id)
        .maybeSingle();
      if (threadOwnershipError) throw threadOwnershipError;
      if (!threadOwnership || threadOwnership.buyer_id !== accountId) {
        return NextResponse.json({ error: "Private offer not found." }, { status: 404 });
      }
      const { data, error } = await admin.rpc("decide_marketplace_private_offer", {
        p_buyer_id: accountId,
        p_offer_id: offerId,
        p_agree: body.agree,
      });
      if (error) return fail(error);
      let checkoutDeadline: string | null = null;
      if (body.agree) {
        const { data: acceptedOffer, error: acceptedOfferError } = await admin.from("marketplace_private_offers")
          .select("checkout_deadline")
          .eq("id", offerId)
          .eq("status", "awaiting_buyer_checkout")
          .maybeSingle();
        if (acceptedOfferError) throw acceptedOfferError;
        checkoutDeadline = acceptedOffer?.checkout_deadline ?? null;
      }
      if (!body.agree) {
        const { error: declineError } = await admin.from("marketplace_private_offers")
          .update({ decline_reason: declineReason, decline_explanation: declineExplanation || null, declined_at: new Date().toISOString() })
          .eq("id", offerId);
        if (declineError) throw declineError;
      }
      return NextResponse.json({ ok: true, ...data, checkout_deadline: checkoutDeadline });
    }

    if (action === "cancel_offer_acceptance") {
      const offerId = text(body.offerId, 36);
      if (!uuidPattern.test(offerId)) return NextResponse.json({ error: "Choose a valid private offer." }, { status: 400 });
      const { data, error } = await admin.rpc("cancel_marketplace_private_offer_acceptance", {
        p_buyer_id: accountId,
        p_offer_id: offerId,
      });
      if (error) return fail(error);
      return NextResponse.json({ ok: true, ...data });
    }

    if (action === "confirm_offer") {
      const offerId = text(body.offerId, 36);
      if (!uuidPattern.test(offerId)) return NextResponse.json({ error: "Choose a valid private offer." }, { status: 400 });
      const weight = numeric(body.weight);
      const smallest = body.smallestStoneWeight === "" || body.smallestStoneWeight === null || body.smallestStoneWeight === undefined
        ? null : numeric(body.smallestStoneWeight);
      const largest = body.largestStoneWeight === "" || body.largestStoneWeight === null || body.largestStoneWeight === undefined
        ? null : numeric(body.largestStoneWeight);
      if (weight === null || (body.listingType === "batch" && (smallest === null || largest === null))) {
        return NextResponse.json({ error: "Enter valid final mineral details." }, { status: 400 });
      }
      const { error } = await admin.rpc("confirm_marketplace_private_offer", {
        p_seller_id: accountId,
        p_offer_id: offerId,
        p_mineral_name: text(body.mineralName, 120),
        p_listing_type: text(body.listingType, 20),
        p_weight: weight,
        p_unit: text(body.unit, 20),
        p_smallest_stone_weight: smallest,
        p_largest_stone_weight: largest,
        p_stone_weight_unit: text(body.stoneWeightUnit, 20) || null,
        p_color: text(body.color, 100),
        p_shape: text(body.shape, 20),
        p_quality: text(body.quality, 200),
        p_country: text(body.country, 100),
        p_region: text(body.region, 100),
        p_district: text(body.district, 100),
      });
      if (error) return fail(error);
      return NextResponse.json({ ok: true });
    }

    if (action === "checkout_offer") {
      const offerId = text(body.offerId, 36);
      if (!uuidPattern.test(offerId)) return NextResponse.json({ error: "Choose a valid private offer." }, { status: 400 });
      const { data: order, error } = await admin.rpc("create_marketplace_private_offer_order", {
        p_buyer_id: accountId,
        p_offer_id: offerId,
        p_buyer_name: text(body.buyerName, 120),
        p_buyer_phone: text(body.buyerPhone, 40),
        p_delivery_country: text(body.country, 100),
        p_delivery_region: text(body.region, 100),
        p_delivery_district: text(body.district, 100),
        p_delivery_address: text(body.address, 300),
      });
      if (error) return fail(error);
      return NextResponse.json({ ok: true, order });
    }

    return NextResponse.json({ error: "Unknown private offer action." }, { status: 400 });
  } catch (error) {
    console.error("Marketplace private offer request failed", error);
    return NextResponse.json({ error: "The private offer request could not be completed." }, { status: 503 });
  }
}
