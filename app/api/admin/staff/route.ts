import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";
import { getPublicAppUrl } from "@/lib/public-app-url";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Body = Record<string, unknown>;

async function getOwner(request: Request) {
  const admin = await getAdminClient(request);
  if (!admin) return null;
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return null;
  return { admin, userId: user.id };
}

async function readBody(request: Request): Promise<Body | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? body as Body : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const owner = await getOwner(request);
  if (!owner) return NextResponse.json({ error: "Owner administrator access required." }, { status: 401 });

  const [{ data: staff, error: staffError }, { data: audit, error: auditError }] = await Promise.all([
    owner.admin.from("staff_members").select("id, employee_code, user_id, full_name, job_role, status, created_at, updated_at").order("id"),
    owner.admin.from("staff_audit_log").select("id, actor_user_id, staff_member_id, action, entity_type, entity_id, details, created_at").order("created_at", { ascending: false }).limit(50),
  ]);
  if (staffError || auditError) {
    console.error("Could not load staff management data.", staffError ?? auditError);
    return NextResponse.json({ error: "Could not load staff management data. Apply the staff management migration." }, { status: 503 });
  }

  const profileIds = [...new Set([
    ...(staff ?? []).map((member) => member.user_id),
    ...(audit ?? []).map((entry) => entry.actor_user_id).filter((id): id is string => Boolean(id)),
  ])];
  const { data: profiles, error: profileError } = profileIds.length
    ? await owner.admin.from("profiles").select("id, username, email").in("id", profileIds)
    : { data: [], error: null };
  if (profileError) {
    console.error("Could not load staff profile details.", profileError);
    return NextResponse.json({ error: "Could not load staff profile details." }, { status: 503 });
  }
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  return NextResponse.json({
    staff: (staff ?? []).map((member) => ({
      ...member,
      email: profileById.get(member.user_id)?.email ?? "",
      username: profileById.get(member.user_id)?.username ?? "",
    })),
    audit: (audit ?? []).map((entry) => ({
      ...entry,
      actor_username: entry.actor_user_id ? profileById.get(entry.actor_user_id)?.username ?? "Former account" : "Former account",
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const owner = await getOwner(request);
  if (!owner) return NextResponse.json({ error: "Owner administrator access required." }, { status: 401 });
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid staff invitation." }, { status: 400 });
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!fullName || fullName.length > 120 || !emailPattern.test(email) || email.length > 254) {
    return NextResponse.json({ error: "Enter a staff name and valid email address." }, { status: 400 });
  }
  if (body.jobRole !== "order_operations") {
    return NextResponse.json({ error: "Choose an available staff role." }, { status: 400 });
  }

  let invitedUserId: string | null = null;
  try {
    const { data: existingProfile, error: existingProfileError } = await owner.admin.from("profiles")
      .select("id").eq("email", email).maybeSingle();
    if (existingProfileError) throw existingProfileError;
    if (existingProfile) {
      return NextResponse.json({ error: "An account already uses this email. Staff invitations must use a new, individual work email." }, { status: 409 });
    }

    const redirectTo = new URL("/staff/activate", getPublicAppUrl()).toString();
    const { data: invitation, error: invitationError } = await owner.admin.auth.admin.inviteUserByEmail(email, {
      data: { display_name: fullName },
      redirectTo,
    });
    if (invitationError || !invitation.user) throw invitationError ?? new Error("Supabase did not return the invited user.");
    invitedUserId = invitation.user.id;

    const { error: profileError } = await owner.admin.from("profiles")
      .update({ display_name: fullName, role: "staff" })
      .eq("id", invitation.user.id);
    if (profileError) throw profileError;

    const { data: member, error: memberError } = await owner.admin.from("staff_members").insert({
      user_id: invitation.user.id,
      full_name: fullName,
      job_role: "order_operations",
      status: "invited",
      invited_by: owner.userId,
    }).select("id, employee_code, user_id, full_name, job_role, status, created_at").single();
    if (memberError) throw memberError;

    const { error: auditError } = await owner.admin.from("staff_audit_log").insert({
      actor_user_id: owner.userId,
      staff_member_id: member.id,
      action: "staff_invited",
      entity_type: "staff_member",
      entity_id: member.id.toString(),
      details: { job_role: "order_operations" },
    });
    if (auditError) throw auditError;

    const { data: profile, error: invitedProfileError } = await owner.admin.from("profiles")
      .select("username, email").eq("id", invitation.user.id).single();
    if (invitedProfileError) throw invitedProfileError;
    return NextResponse.json({
      ok: true,
      staff: { ...member, username: profile.username, email: profile.email },
    }, { status: 201 });
  } catch (error) {
    console.error("Could not create staff invitation.", error);
    if (invitedUserId) {
      const { error: cleanupError } = await owner.admin.auth.admin.deleteUser(invitedUserId);
      if (cleanupError) console.error("Could not remove the incomplete staff invitation.", cleanupError);
    }
    return NextResponse.json({
      error: "Could not create the staff account and invitation. Check Supabase Auth email delivery and the staff management migration, then retry.",
    }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const owner = await getOwner(request);
  if (!owner) return NextResponse.json({ error: "Owner administrator access required." }, { status: 401 });
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid staff update." }, { status: 400 });
  const memberId = typeof body.staffId === "number" ? body.staffId : Number(body.staffId);
  const status = body.status;
  if (!Number.isSafeInteger(memberId) || memberId < 1 || !["active", "suspended"].includes(String(status))) {
    return NextResponse.json({ error: "Choose a staff member and valid status." }, { status: 400 });
  }

  const { data: member, error: memberError } = await owner.admin.from("staff_members")
    .select("id, user_id, status").eq("id", memberId).maybeSingle();
  if (memberError) {
    console.error("Could not look up the staff member.", memberError);
    return NextResponse.json({ error: "Could not update staff access." }, { status: 503 });
  }
  if (!member) return NextResponse.json({ error: "Staff member not found." }, { status: 404 });
  if (member.status === status) return NextResponse.json({ ok: true });

  const now = new Date().toISOString();
  const { error: updateError } = await owner.admin.from("staff_members")
    .update({ status, updated_at: now }).eq("id", memberId);
  if (updateError) {
    console.error("Could not update the staff status.", updateError);
    return NextResponse.json({ error: "Could not update staff access." }, { status: 503 });
  }
  const { error: auditError } = await owner.admin.from("staff_audit_log").insert({
    actor_user_id: owner.userId,
    staff_member_id: memberId,
    action: status === "suspended" ? "staff_suspended" : "staff_reactivated",
    entity_type: "staff_member",
    entity_id: String(memberId),
    details: { previous_status: member.status, status },
  });
  if (auditError) {
    console.error("Staff access changed, but the audit entry could not be recorded.", auditError);
    return NextResponse.json({ error: "Staff access changed, but its audit record could not be saved. Contact technical support." }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
