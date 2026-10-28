import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getWebsiteAccountId } from "@/lib/website-session";

type Currency = "TZS" | "USD";

const SUBSCRIPTION_RECEIPT_BUCKET = "account-subscription-payment-proofs";
const MAX_SUBSCRIPTION_RECEIPT_BYTES = 4 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validReceiptSignature(type: string, bytes: Buffer) {
  if (type === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return false;
}

export async function GET(request: Request) {
  try {
    const accountId = await getWebsiteAccountId(request);
    if (!accountId) return NextResponse.json({ error: "Sign in to view subscriptions." }, { status: 401 });
    const admin = createSupabaseAdminClient();
    const now = new Date().toISOString();
    const { error: expiryError } = await admin.from("account_subscriptions")
      .update({ status: "expired" })
      .eq("website_user_id", accountId)
      .eq("status", "active")
      .lte("expires_at", now);
    if (expiryError) throw expiryError;

    const [plansResult, activeResult, scheduledResult, pendingResult, previousResult, settingsResult] = await Promise.all([
      admin.from("subscription_plans").select("id, months, price_tzs, price_usd")
        .eq("is_active", true).order("months", { ascending: true }),
      admin.from("account_subscriptions")
        .select("id, plan_id, months, currency, amount, status, requested_at, starts_at, expires_at, paid_at")
        .eq("website_user_id", accountId).eq("status", "active").lte("starts_at", now).gt("expires_at", now)
        .order("expires_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("account_subscriptions")
        .select("id, plan_id, months, currency, amount, status, requested_at, starts_at, expires_at, paid_at")
        .eq("website_user_id", accountId).eq("status", "active").gt("starts_at", now).gt("expires_at", now)
        .order("expires_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("account_subscriptions")
        .select("id, plan_id, months, currency, amount, status, requested_at, starts_at, expires_at, paid_at, payment_reference")
        .eq("website_user_id", accountId).eq("status", "pending")
        .order("requested_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("account_subscriptions")
        .select("id, plan_id, months, currency, amount, status, requested_at, starts_at, expires_at, paid_at, review_note, payment_reference")
        .eq("website_user_id", accountId).in("status", ["expired", "rejected"])
        .order("requested_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("marketplace_settings").select("payment_methods, payment_instructions")
        .eq("id", true).single(),
    ]);
    if (plansResult.error || activeResult.error || scheduledResult.error || pendingResult.error || previousResult.error || settingsResult.error) {
      throw new Error("Could not load subscription details.");
    }
    return NextResponse.json({
      plans: plansResult.data ?? [],
      activeSubscription: activeResult.data,
      scheduledSubscription: scheduledResult.data,
      pendingSubscription: pendingResult.data,
      previousSubscription: previousResult.data,
      paymentMethods: settingsResult.data.payment_methods ?? [],
      paymentInstructions: settingsResult.data.payment_instructions ?? "",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load user subscription details.", error);
    return NextResponse.json({ error: "Could not load subscription details." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const accountId = await getWebsiteAccountId(request);
  if (!accountId) return NextResponse.json({ error: "Sign in again before choosing a subscription." }, { status: 401 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Complete the subscription payment form." }, { status: 400 });
  }
  const planIdValue = formData.get("planId");
  const currencyValue = formData.get("currency");
  const referenceValue = formData.get("paymentReference");
  const receiptValue = formData.get("paymentReceipt");
  const planId = typeof planIdValue === "string" && UUID_PATTERN.test(planIdValue)
    ? planIdValue
    : null;
  const currency = currencyValue === "TZS" || currencyValue === "USD" ? currencyValue as Currency : null;
  const paymentReference = typeof referenceValue === "string" ? referenceValue.trim() : "";
  if (!planId || !currency) return NextResponse.json({ error: "Choose a valid subscription plan and currency." }, { status: 400 });
  if (paymentReference.length < 3 || paymentReference.length > 120) {
    return NextResponse.json({ error: "Enter a payment reference between 3 and 120 characters." }, { status: 400 });
  }
  if (!(receiptValue instanceof File) || receiptValue.size === 0) {
    return NextResponse.json({ error: "Upload your payment receipt as a PDF, JPEG, or PNG." }, { status: 400 });
  }
  if (receiptValue.size > MAX_SUBSCRIPTION_RECEIPT_BYTES) {
    return NextResponse.json({ error: "The receipt must be 4 MB or smaller." }, { status: 400 });
  }
  const receiptExtensions: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
  };
  const extension = receiptExtensions[receiptValue.type];
  if (!extension) return NextResponse.json({ error: "Upload a PDF, JPEG, or PNG receipt." }, { status: 400 });
  const receiptBytes = Buffer.from(await receiptValue.arrayBuffer());
  if (!validReceiptSignature(receiptValue.type, receiptBytes)) {
    return NextResponse.json({ error: "The receipt file does not match its PDF, JPEG, or PNG type." }, { status: 400 });
  }

  let uploadedReceiptPath: string | null = null;
  let requestCreated = false;
  try {
    const admin = createSupabaseAdminClient();
    const now = new Date().toISOString();
    const { data: existingSubscription, error: existingSubscriptionError } = await admin.from("account_subscriptions")
      .select("id")
      .eq("website_user_id", accountId)
      .eq("status", "active")
      .gt("expires_at", now)
      .limit(1)
      .maybeSingle();
    if (existingSubscriptionError) throw existingSubscriptionError;
    if (existingSubscription) {
      return NextResponse.json({ error: "Your subscription is active. You can choose a new plan after it expires." }, { status: 409 });
    }

    const { data: settings, error: settingsError } = await admin.from("marketplace_settings")
      .select("usd_enabled").eq("id", true).single();
    if (settingsError) throw settingsError;
    if (currency === "USD" && !settings.usd_enabled) {
      return NextResponse.json({ error: "USD subscriptions are disabled. Choose TSh." }, { status: 400 });
    }
    const receiptId = randomUUID();
    uploadedReceiptPath = `${accountId}/${receiptId}.${extension}`;
    const { error: uploadError } = await admin.storage.from(SUBSCRIPTION_RECEIPT_BUCKET).upload(
      uploadedReceiptPath,
      receiptBytes,
      { contentType: receiptValue.type, upsert: false },
    );
    if (uploadError) throw uploadError;

    const { data: id, error } = await admin.rpc("request_website_subscription", {
      p_website_user_id: accountId,
      p_plan_id: planId,
      p_currency: currency,
      p_payment_reference: paymentReference,
      p_payment_receipt_path: uploadedReceiptPath,
    });
    if (error) {
      const { error: cleanupError } = await admin.storage.from(SUBSCRIPTION_RECEIPT_BUCKET).remove([uploadedReceiptPath]);
      uploadedReceiptPath = null;
      if (cleanupError) console.error("Could not remove an unused subscription receipt.", cleanupError);
      if (error.code === "23505") return NextResponse.json({ error: "A subscription payment is already awaiting admin confirmation." }, { status: 409 });
      if (error.code === "22023") return NextResponse.json({ error: error.message }, { status: 400 });
      if (error.code === "42501") return NextResponse.json({ error: "Your account is not active." }, { status: 403 });
      if (error.code === "23514") return NextResponse.json({ error: "USD subscriptions are disabled. Choose TSh." }, { status: 400 });
      throw error;
    }
    requestCreated = true;
    const { data: subscription, error: subscriptionError } = await admin.from("account_subscriptions")
      .select("id, plan_id, months, currency, amount, status, requested_at, starts_at, expires_at, paid_at, payment_reference")
      .eq("id", id).single();
    if (subscriptionError) throw subscriptionError;
    return NextResponse.json({ subscription }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not create subscription payment request.", error);
    if (uploadedReceiptPath && !requestCreated) {
      const { error: cleanupError } = await createSupabaseAdminClient().storage
        .from(SUBSCRIPTION_RECEIPT_BUCKET).remove([uploadedReceiptPath]);
      if (cleanupError) console.error("Could not remove an unused subscription receipt.", cleanupError);
    }
    return NextResponse.json({ error: "Could not request the subscription. Please try again." }, { status: 503 });
  }
}
