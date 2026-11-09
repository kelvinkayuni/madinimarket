import { NextResponse } from "next/server";

import { getStaffTaskAccess } from "@/lib/staff-task-claims";

const taskTypePattern = /^[a-z_]{1,40}$/;
const taskIdPattern = /^[a-zA-Z0-9_-]{1,160}$/;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const taskType = url.searchParams.get("type") ?? "";
    const taskId = url.searchParams.get("id") ?? "";
    if (!taskTypePattern.test(taskType) || !taskIdPattern.test(taskId)) {
      return NextResponse.json({ error: "Choose a valid staff task." }, { status: 400 });
    }
    const staff = await getStaffTaskAccess(request, taskType);
    if (!staff) return NextResponse.json({ error: "Assigned staff access is required." }, { status: 403 });

    const { data: claim, error } = await staff.admin.from("staff_task_claims")
      .select("staff_member_id, claimed_at, expires_at, staff_members(full_name)")
      .eq("task_type", taskType)
      .eq("task_id", taskId)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error) throw error;
    const claimant = Array.isArray(claim?.staff_members) ? claim.staff_members[0] : claim?.staff_members;
    return NextResponse.json({
      claim: claim ? {
        fullName: claimant?.full_name ?? "Another staff member",
        mine: claim.staff_member_id === staff.staffId,
        expiresAt: claim.expires_at,
      } : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load the staff task claim.", error);
    return NextResponse.json({ error: "Could not load task availability." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid staff task claim." }, { status: 400 });
    }
    const values = body as Record<string, unknown>;
    const taskType = typeof values.type === "string" ? values.type : "";
    const taskId = typeof values.id === "string" ? values.id : "";
    const action = values.action;
    if (!taskTypePattern.test(taskType) || !taskIdPattern.test(taskId) || !["claim", "release"].includes(String(action))) {
      return NextResponse.json({ error: "Choose a valid staff task and action." }, { status: 400 });
    }
    const staff = await getStaffTaskAccess(request, taskType);
    if (!staff) return NextResponse.json({ error: "Assigned staff access is required." }, { status: 403 });

    if (action === "release") {
      const { error } = await staff.admin.from("staff_task_claims")
        .delete()
        .eq("task_type", taskType)
        .eq("task_id", taskId)
        .eq("staff_member_id", staff.staffId);
      if (error) throw error;
      return NextResponse.json({ ok: true, claim: null });
    }

    const { data, error } = await staff.admin.rpc("claim_staff_task", {
      p_staff_member_id: staff.staffId,
      p_task_type: taskType,
      p_task_id: taskId,
    });
    if (error) throw error;
    if (!data?.length) {
      const { data: current, error: currentError } = await staff.admin.from("staff_task_claims")
        .select("expires_at, staff_members(full_name)")
        .eq("task_type", taskType)
        .eq("task_id", taskId)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (currentError) throw currentError;
      const claimant = Array.isArray(current?.staff_members) ? current.staff_members[0] : current?.staff_members;
      return NextResponse.json({
        error: `This task is being handled by ${claimant?.full_name ?? "another staff member"}.`,
        claim: current ? { fullName: claimant?.full_name ?? "Another staff member", mine: false, expiresAt: current.expires_at } : null,
      }, { status: 409 });
    }

    return NextResponse.json({
      ok: true,
      claim: { fullName: staff.fullName, mine: true, expiresAt: data[0].expires_at },
    });
  } catch (error) {
    console.error("Could not update the staff task claim.", error);
    return NextResponse.json({ error: "Could not update task availability." }, { status: 503 });
  }
}
