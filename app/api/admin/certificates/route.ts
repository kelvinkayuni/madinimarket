import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";
import { getStaffAccess } from "@/lib/staff-auth";
import { ownsStaffTaskClaim } from "@/lib/staff-task-claims";

export async function GET(request: Request) {
  try {
    const admin = await getAdminClient(request, ["review_submissions", "accounts"]);
    if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    const { data: rows, error } = await admin.from("website_account_certificates")
      .select("id, website_user_id, kind, status, file_name, file_path, created_at")
      .in("status", ["pending", "approved"])
      .order("created_at", { ascending: true });
    if (error) throw error;
    const accountIds = [...new Set((rows ?? []).map((row) => row.website_user_id))];
    const { data: accounts, error: accountError } = accountIds.length
      ? await admin.from("website_accounts").select("id, username, display_name, email").in("id", accountIds)
      : { data: [], error: null };
    if (accountError) throw accountError;
    const accountById = new Map((accounts ?? []).map((account) => [account.id, account]));
    const certificates = await Promise.all((rows ?? []).map(async (row) => {
      const { data: signed } = await admin.storage.from("account-certificates").createSignedUrl(row.file_path, 3600);
      return { ...row, account: accountById.get(row.website_user_id), signed_url: signed?.signedUrl ?? "" };
    }));
    return NextResponse.json({ certificates }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load licence reviews." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await getAdminClient(request, ["review_submissions", "accounts"]);
    if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid review details." }, { status: 400 });
    }
    const values = body as Record<string, unknown>;
    const id = typeof values.id === "string" ? values.id : "";
    const approved = values.approved;
    const message = typeof values.message === "string" ? values.message.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || typeof approved !== "boolean") {
      return NextResponse.json({ error: "Invalid review details." }, { status: 400 });
    }
    if (!approved && (!message || message.length > 1000)) {
      return NextResponse.json({ error: "Enter a rejection reason of 1 to 1000 characters." }, { status: 400 });
    }
    const staff = await getStaffAccess(request);
    if (staff && !await ownsStaffTaskClaim(admin, staff.staffId, "certificate_review", id)) {
      return NextResponse.json({ error: "Claim this licence review before handling it." }, { status: 409 });
    }
    const { data, error } = await admin.from("website_account_certificates").update({
      status: approved ? "approved" : "rejected",
      review_message: approved ? null : message,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    }).eq("id", id).eq("status", "pending").select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "This licence is no longer waiting for review." }, { status: 404 });
    return NextResponse.json({ reviewed: true });
  } catch {
    return NextResponse.json({ error: "Could not save the licence review." }, { status: 503 });
  }
}