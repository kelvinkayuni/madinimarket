import { NextResponse } from "next/server";

import { getStaffAccess } from "@/lib/staff-auth";
import { ownsStaffTaskClaim } from "@/lib/staff-task-claims";

export async function POST(request: Request) {
  try {
    const staff = await getStaffAccess(request);
    if (!staff || !staff.permissions.includes("market_moderation") && !staff.permissions.includes("review_submissions")) {
      return NextResponse.json({ error: "Assigned review access is required." }, { status: 403 });
    }

    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid review details." }, { status: 400 });
    }
    const values = body as Record<string, unknown>;
    const kind = values.kind;
    const id = Number(values.id);
    const approved = values.approved;
    const message = typeof values.message === "string" ? values.message.trim() : "";
    if (!["seller", "buyer"].includes(String(kind)) || !Number.isSafeInteger(id) || id < 1 || typeof approved !== "boolean") {
      return NextResponse.json({ error: "Invalid review details." }, { status: 400 });
    }
    if (!approved && (!message || message.length > 1000)) {
      return NextResponse.json({ error: "Enter a rejection reason of 1 to 1000 characters." }, { status: 400 });
    }
    const taskType = kind === "seller" ? "listing_review" : "buyer_request_review";
    let ownsClaim = false;
    try {
      ownsClaim = await ownsStaffTaskClaim(staff.admin, staff.staffId, taskType, String(id));
    } catch (error) {
      console.error("Could not verify the staff review claim.", error);
      return NextResponse.json({ error: "Could not verify task ownership." }, { status: 503 });
    }
    if (!ownsClaim) {
      return NextResponse.json({ error: "Claim this review before handling it. Another staff member may already be working on it." }, { status: 409 });
    }
    const { error } = await staff.admin.rpc(kind === "seller" ? "staff_review_listing" : "staff_review_buy_request", {
      p_staff_user_id: staff.userId,
      [kind === "seller" ? "p_listing_id" : "p_request_id"]: id,
      p_approved: approved,
      p_message: message || null,
    });
    if (error?.code === "42501") return NextResponse.json({ error: "Assigned review access is required." }, { status: 403 });
    if (error?.code === "P0002") return NextResponse.json({ error: error.message }, { status: 409 });
    if (error?.code === "22023") return NextResponse.json({ error: error.message }, { status: 400 });
    if (error) {
      console.error("Staff review action failed.", error);
      return NextResponse.json({ error: "Could not save the review decision." }, { status: 503 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Could not process the staff review action.", error);
    return NextResponse.json({ error: "Could not save the review decision." }, { status: 503 });
  }
}
