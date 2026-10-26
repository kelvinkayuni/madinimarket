import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getWebsiteAccountId } from "@/lib/website-session";

type Currency = "TZS" | "USD";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET() {
  try {
    const accountId = await getWebsiteAccountId();
    if (!accountId) return NextResponse.json({ error: "Sign in to view subscriptions." }, { status: 401 });
    const admin = createSupabaseAdminClient();
    const now = new Date().toISOString();
    const { error: expiryError } = await admin.from("account_subscriptions")
      .update({ status: "expired" })
      .eq("website_user_id", accountId)
      .eq("status", "active")
      .lte("expires_at", now);
    if (expiryError) throw expiryError;

    const [plansResult, activeResult, scheduledResult, pendingResult, previousResult] = await Promise.all([
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
        .select("id, plan_id, months, currency, amount, status, requested_at, starts_at, expires_at, paid_at")
        .eq("website_user_id", accountId).eq("status", "pending")
        .order("requested_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("account_subscriptions")
        .select("id, plan_id, months, currency, amount, status, requested_at, starts_at, expires_at, paid_at")
        .eq("website_user_id", accountId).in("status", ["expired", "rejected"])
        .order("requested_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (plansResult.error || activeResult.error || scheduledResult.error || pendingResult.error || previousResult.error) {
      throw new Error("Could not load subscription details.");
    }
    return NextResponse.json({
      plans: plansResult.data ?? [],
      activeSubscription: activeResult.data,
      scheduledSubscription: scheduledResult.data,
      pendingSubscription: pendingResult.data,
      previousSubscription: previousResult.data,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load subscription details." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const accountId = await getWebsiteAccountId();
  if (!accountId) return NextResponse.json({ error: "Sign in again before choosing a subscription." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Choose a valid subscription plan." }, { status: 400 });
  }
  if (!isRecord(body)) return NextResponse.json({ error: "Choose a valid subscription plan." }, { status: 400 });
  const planId = typeof body.planId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.planId)
    ? body.planId
    : null;
  const currency = body.currency === "TZS" || body.currency === "USD" ? body.currency as Currency : null;
  if (!planId || !currency) return NextResponse.json({ error: "Choose a valid subscription plan and currency." }, { status: 400 });

  try {
    const admin = createSupabaseAdminClient();
    const now = new Date().toISOString();
    const { data: activeSubscription, error: activeSubscriptionError } = await admin.from("account_subscriptions")
      .select("id")
      .eq("website_user_id", accountId)
      .eq("status", "active")
      .gt("expires_at", now)
      .limit(1)
      .maybeSingle();
    if (activeSubscriptionError) throw activeSubscriptionError;
    if (activeSubscription) {
      return NextResponse.json({ error: "Your subscription is active. You can choose another plan after it expires." }, { status: 409 });
    }

    const { data: settings, error: settingsError } = await admin.from("marketplace_settings")
      .select("usd_enabled").eq("id", true).single();
    if (settingsError) throw settingsError;
    if (currency === "USD" && !settings.usd_enabled) {
      return NextResponse.json({ error: "USD subscriptions are disabled. Choose TSh." }, { status: 400 });
    }
    const { data: id, error } = await admin.rpc("request_website_subscription", {
      p_website_user_id: accountId,
      p_plan_id: planId,
      p_currency: currency,
    });
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "A subscription payment is already awaiting admin confirmation." }, { status: 409 });
      if (error.code === "22023") return NextResponse.json({ error: error.message }, { status: 400 });
      if (error.code === "42501") return NextResponse.json({ error: "Your account is not active." }, { status: 403 });
      if (error.code === "23514") return NextResponse.json({ error: "USD subscriptions are disabled. Choose TSh." }, { status: 400 });
      throw error;
    }
    const { data: subscription, error: subscriptionError } = await admin.from("account_subscriptions")
      .select("id, plan_id, months, currency, amount, status, requested_at, starts_at, expires_at, paid_at")
      .eq("id", id).single();
    if (subscriptionError) throw subscriptionError;
    return NextResponse.json({ subscription }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not request the subscription. Please try again." }, { status: 503 });
  }
}
