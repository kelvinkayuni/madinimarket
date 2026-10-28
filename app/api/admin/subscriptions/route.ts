import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBody(request: Request) {
  try {
    const body: unknown = await request.json();
    return isRecord(body) ? body : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const admin = await getAdminClient(request);
    if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    const service = createSupabaseAdminClient();
    const [plansResult, pendingResult] = await Promise.all([
      service.from("subscription_plans")
        .select("id, months, price_tzs, price_usd, is_active, updated_at")
        .order("months", { ascending: true }),
      service.from("account_subscriptions")
        .select("id, website_user_id, plan_id, months, currency, amount, status, requested_at, payment_reference, payment_receipt_path")
        .eq("status", "pending")
        .order("requested_at", { ascending: true }),
    ]);
    if (plansResult.error || pendingResult.error) throw new Error("Could not load subscription administration data.");
    const accountIds = [...new Set((pendingResult.data ?? []).map((item) => item.website_user_id))];
    const { data: accounts, error: accountsError } = accountIds.length
      ? await service.from("website_accounts").select("id, display_name, username, email").in("id", accountIds)
      : { data: [], error: null };
    if (accountsError) throw accountsError;
    const accountsById = new Map((accounts ?? []).map((account) => [account.id, account]));
    const pendingSubscriptions = await Promise.all((pendingResult.data ?? []).map(async (subscription) => {
      const { payment_receipt_path: receiptPath, ...safeSubscription } = subscription;
      const receipt = receiptPath
        ? await service.storage.from("account-subscription-payment-proofs").createSignedUrl(receiptPath, 10 * 60)
        : null;
      if (receipt?.error) throw receipt.error;
      return {
        ...safeSubscription,
        payment_receipt_url: receipt?.data.signedUrl ?? null,
        account: accountsById.get(subscription.website_user_id) ?? null,
      };
    }));
    return NextResponse.json({
      plans: plansResult.data ?? [],
      pendingSubscriptions,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load subscription administration data." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const authorized = await getAdminClient(request);
    if (!authorized) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    const body = await readBody(request);
    if (!body) return NextResponse.json({ error: "Enter a valid subscription plan." }, { status: 400 });
    const months = Number(body.months);
    const priceTzs = Number(body.price_tzs);
    const priceUsd = Number(body.price_usd);
    if (!Number.isInteger(months) || months < 1 || months > 120 ||
      !Number.isFinite(priceTzs) || priceTzs <= 0 ||
      !Number.isFinite(priceUsd) || priceUsd <= 0) {
      return NextResponse.json({ error: "Enter 1–120 months and positive TSh and USD prices." }, { status: 400 });
    }
    const service = createSupabaseAdminClient();
    const { data, error } = await service.from("subscription_plans").upsert({
      months,
      price_tzs: priceTzs,
      price_usd: priceUsd,
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "months" }).select("id, months, price_tzs, price_usd, is_active, updated_at").single();
    if (error) throw error;
    return NextResponse.json({ plan: data }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not save the subscription plan." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    const authorized = await getAdminClient(request);
    if (!authorized) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    const { data: { user }, error: userError } = await authorized.auth.getUser(token);
    if (userError || !user) return NextResponse.json({ error: "Admin session expired." }, { status: 403 });
    const body = await readBody(request);
    const subscriptionId = typeof body?.subscriptionId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.subscriptionId)
      ? body.subscriptionId
      : null;
    if (!subscriptionId || typeof body?.paid !== "boolean") {
      return NextResponse.json({ error: "Choose whether to confirm or reject this payment." }, { status: 400 });
    }
    const reviewNote = typeof body.reviewNote === "string" ? body.reviewNote.trim() : "";
    if (!body.paid && !reviewNote) {
      return NextResponse.json({ error: "Enter a reason before rejecting this request." }, { status: 400 });
    }
    if (reviewNote.length > 500) {
      return NextResponse.json({ error: "The rejection reason must be 500 characters or fewer." }, { status: 400 });
    }
    const service = createSupabaseAdminClient();
    const { data, error } = await service.rpc("review_website_subscription", {
      p_subscription_id: subscriptionId,
      p_admin_id: user.id,
      p_approved: body.paid,
      p_review_note: reviewNote || null,
    });
    if (error?.code === "P0002") return NextResponse.json({ error: "That payment request is no longer pending." }, { status: 404 });
    if (error?.code === "42501") return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    if (error?.code === "22023") return NextResponse.json({ error: error.message }, { status: 409 });
    if (error) throw error;
    return NextResponse.json({ subscription: data }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not update that subscription payment." }, { status: 503 });
  }
}
