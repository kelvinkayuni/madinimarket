import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";

type SubmissionCounts = { total: number; pending: number; approved: number; rejected: number };

async function getAdminClient(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  const admin = createSupabaseAdminClient();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return profile?.role === "admin" ? admin : null;
}

function countSubmissions(rows: { website_user_id: string | null; status: string }[]) {
  const counts = new Map<string, SubmissionCounts>();
  for (const row of rows) {
    if (!row.website_user_id) continue;
    const accountCounts = counts.get(row.website_user_id) ?? { total: 0, pending: 0, approved: 0, rejected: 0 };
    accountCounts.total += 1;
    if (row.status in accountCounts && row.status !== "total") accountCounts[row.status as "pending" | "approved" | "rejected"] += 1;
    counts.set(row.website_user_id, accountCounts);
  }
  return counts;
}

async function parseAccountId(request: Request) {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
    const id = (body as Record<string, unknown>).id;
    return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const admin = await getAdminClient(request);
    if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    const [accountsResult, listingsResult, requestsResult] = await Promise.all([
      admin.from("website_accounts").select("id, display_name, username, email, phone, is_active, created_at").order("created_at", { ascending: false }),
      admin.from("listings").select("website_user_id, status").not("website_user_id", "is", null),
      admin.from("buy_requests").select("website_user_id, status").not("website_user_id", "is", null),
    ]);
    if (accountsResult.error || listingsResult.error || requestsResult.error) throw new Error("Could not load account data.");

    const listingCounts = countSubmissions(listingsResult.data ?? []);
    const buyingCounts = countSubmissions(requestsResult.data ?? []);
    const accounts = (accountsResult.data ?? []).map((account) => ({
      ...account,
      listings: listingCounts.get(account.id) ?? { total: 0, pending: 0, approved: 0, rejected: 0 },
      buying_requests: buyingCounts.get(account.id) ?? { total: 0, pending: 0, approved: 0, rejected: 0 },
    }));
    return NextResponse.json({ accounts }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load website accounts." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await getAdminClient(request);
    if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid account details." }, { status: 400 });
    }
    const values = body as Record<string, unknown>;
    const id = typeof values.id === "string" ? values.id : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || typeof values.is_active !== "boolean") {
      return NextResponse.json({ error: "Invalid account details." }, { status: 400 });
    }
    const { data, error } = await admin.from("website_accounts").update({ is_active: values.is_active })
      .eq("id", id).select("id, is_active").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Account not found." }, { status: 404 });
    return NextResponse.json({ account: data });
  } catch {
    return NextResponse.json({ error: "Could not update that account." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await getAdminClient(request);
    if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    const id = await parseAccountId(request);
    if (!id) return NextResponse.json({ error: "Invalid account details." }, { status: 400 });

    const [accountResult, listingsResult, draftsResult] = await Promise.all([
      admin.from("website_accounts").select("id").eq("id", id).maybeSingle(),
      admin.from("listings").select("image_path").eq("website_user_id", id),
      admin.from("website_account_drafts").select("image_path").eq("website_user_id", id),
    ]);
    if (accountResult.error || listingsResult.error || draftsResult.error) throw new Error("Could not load account data.");
    if (!accountResult.data) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    const imagePaths = [...new Set([
      ...(listingsResult.data ?? []).map((row) => row.image_path),
      ...(draftsResult.data ?? []).map((row) => row.image_path),
    ].filter((path): path is string => Boolean(path)))];
    const { error } = await admin.from("website_accounts").delete().eq("id", id);
    if (error) throw error;
    if (imagePaths.length) await admin.storage.from("mineral-images").remove(imagePaths);
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json({ error: "Could not delete that account." }, { status: 503 });
  }
}