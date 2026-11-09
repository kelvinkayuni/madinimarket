import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";
import { getPublicAppUrl } from "@/lib/public-app-url";
import { isStaffPermission } from "@/lib/staff-permissions";

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

  const [
    { data: staff, error: staffError },
    { data: roles, error: rolesError },
    { data: assignments, error: assignmentsError },
  ] = await Promise.all([
    owner.admin.from("staff_members").select("id, employee_code, user_id, full_name, job_role, status, created_at, updated_at").order("id"),
    owner.admin.from("staff_roles").select("id, name, permissions, created_at").order("name"),
    owner.admin.from("staff_member_roles").select("staff_member_id, role_id"),
  ]);
  if (staffError || rolesError || assignmentsError) {
    console.error("Could not load staff management data.", staffError ?? rolesError ?? assignmentsError);
    return NextResponse.json({ error: "Could not load staff management data. Apply the staff management migration." }, { status: 503 });
  }

  const profileIds = [...new Set((staff ?? []).map((member) => member.user_id))];
  const { data: profiles, error: profileError } = profileIds.length
    ? await owner.admin.from("profiles").select("id, username, email").in("id", profileIds)
    : { data: [], error: null };
  if (profileError) {
    console.error("Could not load staff profile details.", profileError);
    return NextResponse.json({ error: "Could not load staff profile details." }, { status: 503 });
  }
  const staffIds = (staff ?? []).map((member) => member.id);
  const { data: acceptedInvitations, error: acceptedInvitationsError } = staffIds.length
    ? await owner.admin.from("staff_audit_log")
      .select("staff_member_id")
      .eq("action", "staff_invitation_accepted")
      .in("staff_member_id", staffIds)
    : { data: [], error: null };
  if (acceptedInvitationsError) {
    console.error("Could not verify staff setup status.", acceptedInvitationsError);
    return NextResponse.json({ error: "Could not verify staff setup status." }, { status: 503 });
  }
  const completedSetupIds = new Set((acceptedInvitations ?? []).map((entry) => entry.staff_member_id));
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  return NextResponse.json({
    staff: (staff ?? []).map((member) => ({
      ...member,
      setupComplete: completedSetupIds.has(member.id),
      email: profileById.get(member.user_id)?.email ?? "",
      username: profileById.get(member.user_id)?.username ?? "",
      roles: (assignments ?? [])
        .filter((assignment) => assignment.staff_member_id === member.id)
        .map((assignment) => roles?.find((role) => role.id === assignment.role_id))
        .filter((role): role is NonNullable<typeof roles>[number] => Boolean(role)),
    })),
    roles: roles ?? [],
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const owner = await getOwner(request);
  if (!owner) return NextResponse.json({ error: "Owner administrator access required." }, { status: 401 });
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid staff invitation." }, { status: 400 });
  if (body.action === "create_role") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const permissions = Array.isArray(body.permissions) ? [...new Set(body.permissions)] : [];
    if (name.length < 2 || name.length > 80 || !permissions.length || !permissions.every(isStaffPermission)) {
      return NextResponse.json({ error: "Enter a role name and choose at least one valid permission." }, { status: 400 });
    }
    const { data: role, error: roleError } = await owner.admin.from("staff_roles")
      .insert({ name, permissions, created_by: owner.userId })
      .select("id, name, permissions, created_at")
      .single();
    if (roleError?.code === "23505") return NextResponse.json({ error: "A role with that name already exists." }, { status: 409 });
    if (roleError) {
      console.error("Could not create a staff role.", roleError);
      return NextResponse.json({ error: "Could not create the staff role." }, { status: 503 });
    }
    const { error: auditError } = await owner.admin.from("staff_audit_log").insert({
      actor_user_id: owner.userId,
      action: "staff_role_created",
      entity_type: "staff_role",
      entity_id: String(role.id),
      details: { name: role.name, permissions: role.permissions },
    });
    if (auditError) {
      console.error("Staff role created, but its audit record could not be saved.", auditError);
      return NextResponse.json({ error: "The role was created, but its audit record could not be saved." }, { status: 503 });
    }
    return NextResponse.json({ role }, { status: 201 });
  }
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!fullName || fullName.length > 120 || !emailPattern.test(email) || email.length > 254) {
    return NextResponse.json({ error: "Enter a staff name and valid email address." }, { status: 400 });
  }
  const roleIds = Array.isArray(body.roleIds)
    ? [...new Set(body.roleIds.map((value) => Number(value)))]
    : [];
  if (!roleIds.length || roleIds.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    return NextResponse.json({ error: "Assign at least one staff role." }, { status: 400 });
  }

  let invitedUserId: string | null = null;
  try {
    const { data: existingProfile, error: existingProfileError } = await owner.admin.from("profiles")
      .select("id").eq("email", email).maybeSingle();
    if (existingProfileError) throw existingProfileError;
    if (existingProfile) {
      return NextResponse.json({ error: "An account already uses this email. Staff invitations must use a new, individual work email." }, { status: 409 });
    }
    const { data: roles, error: rolesError } = await owner.admin.from("staff_roles")
      .select("id, name").in("id", roleIds);
    if (rolesError) throw rolesError;
    if (roles?.length !== roleIds.length) return NextResponse.json({ error: "One or more selected roles are no longer available." }, { status: 400 });

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
      job_role: "multiple",
      status: "invited",
      invited_by: owner.userId,
    }).select("id, employee_code, user_id, full_name, job_role, status, created_at").single();
    if (memberError) throw memberError;

    const { error: assignmentError } = await owner.admin.from("staff_member_roles").insert(
      roleIds.map((roleId) => ({ staff_member_id: member.id, role_id: roleId, assigned_by: owner.userId })),
    );
    if (assignmentError) throw assignmentError;

    const { error: auditError } = await owner.admin.from("staff_audit_log").insert({
      actor_user_id: owner.userId,
      staff_member_id: member.id,
      action: "staff_invited",
      entity_type: "staff_member",
      entity_id: member.id.toString(),
      details: { roles: roles?.map((role) => role.name) ?? [] },
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
  if (Array.isArray(body.roleIds)) {
    const roleIds = [...new Set(body.roleIds.map((value) => Number(value)))];
    if (!Number.isSafeInteger(memberId) || memberId < 1 || !roleIds.length || roleIds.some((id) => !Number.isSafeInteger(id) || id < 1)) {
      return NextResponse.json({ error: "Assign at least one valid staff role." }, { status: 400 });
    }
    const { error: assignmentError } = await owner.admin.rpc("replace_staff_role_assignments", {
      p_staff_member_id: memberId,
      p_role_ids: roleIds,
      p_actor_user_id: owner.userId,
    });
    if (assignmentError?.code === "P0002") return NextResponse.json({ error: "Staff member not found." }, { status: 404 });
    if (assignmentError?.code === "22023") return NextResponse.json({ error: assignmentError.message }, { status: 400 });
    if (assignmentError) {
      console.error("Could not replace the staff role assignments.", assignmentError);
      return NextResponse.json({ error: "Could not update staff roles." }, { status: 503 });
    }
    return NextResponse.json({ ok: true });
  }
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
  const { data: updatedMember, error: updateError } = await owner.admin.from("staff_members")
    .update({ status, updated_at: now }).eq("id", memberId).eq("status", member.status).select("id").maybeSingle();
  if (updateError) {
    console.error("Could not update the staff status.", updateError);
    return NextResponse.json({ error: "Could not update staff access." }, { status: 503 });
  }
  if (!updatedMember) return NextResponse.json({ error: "Staff status changed. Refresh and try again." }, { status: 409 });
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

export async function DELETE(request: Request) {
  const owner = await getOwner(request);
  if (!owner) return NextResponse.json({ error: "Owner administrator access required." }, { status: 401 });
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid staff invitation deletion." }, { status: 400 });
  const memberId = typeof body.staffId === "number" ? body.staffId : Number(body.staffId);
  if (!Number.isSafeInteger(memberId) || memberId < 1) {
    return NextResponse.json({ error: "Choose a valid staff invitation." }, { status: 400 });
  }

  const { data: member, error: memberError } = await owner.admin.from("staff_members")
    .select("id, user_id, full_name, status").eq("id", memberId).maybeSingle();
  if (memberError) {
    console.error("Could not look up the staff invitation.", memberError);
    return NextResponse.json({ error: "Could not delete the staff invitation." }, { status: 503 });
  }
  if (!member) return NextResponse.json({ error: "Staff member not found." }, { status: 404 });
  if (!["invited", "suspended"].includes(member.status)) {
    return NextResponse.json({ error: "Only invitations that have not completed account setup can be deleted." }, { status: 409 });
  }

  const { data: acceptedInvitation, error: setupError } = await owner.admin.from("staff_audit_log")
    .select("id")
    .eq("staff_member_id", memberId)
    .eq("action", "staff_invitation_accepted")
    .limit(1)
    .maybeSingle();
  if (setupError) {
    console.error("Could not verify staff setup before deletion.", setupError);
    return NextResponse.json({ error: "Could not verify whether staff setup was completed." }, { status: 503 });
  }
  if (acceptedInvitation) {
    return NextResponse.json({ error: "This staff member has completed setup and cannot be deleted here." }, { status: 409 });
  }

  const { data: lockedMember, error: lockError } = await owner.admin.from("staff_members")
    .update({ status: "suspended", updated_at: new Date().toISOString() })
    .eq("id", memberId).eq("status", member.status).select("id, user_id").maybeSingle();
  if (lockError) {
    console.error("Could not lock the pending staff invitation for deletion.", lockError);
    return NextResponse.json({ error: "Could not delete the staff invitation." }, { status: 503 });
  }
  if (!lockedMember) {
    return NextResponse.json({ error: "The invitation status changed. Refresh and try again." }, { status: 409 });
  }

  const { error: deleteError } = await owner.admin.auth.admin.deleteUser(lockedMember.user_id);
  if (deleteError) {
    console.error("Could not delete the pending staff account.", deleteError);
    const { error: restoreError } = await owner.admin.from("staff_members")
      .update({ status: member.status, updated_at: new Date().toISOString() })
      .eq("id", memberId).eq("status", "suspended");
    if (restoreError) {
      console.error("Could not restore the pending staff invitation after deletion failed.", restoreError);
      return NextResponse.json({ error: "The account could not be deleted and its invitation could not be restored. Contact technical support." }, { status: 503 });
    }
    return NextResponse.json({ error: "Could not delete the staff account. The pending invitation was restored." }, { status: 503 });
  }

  const { error: auditError } = await owner.admin.from("staff_audit_log").insert({
    actor_user_id: owner.userId,
    action: "staff_invitation_deleted",
    entity_type: "staff_member",
    entity_id: String(memberId),
    details: { full_name: member.full_name },
  });
  if (auditError) {
    console.error("Staff invitation was deleted, but its audit record could not be saved.", auditError);
    return NextResponse.json({
      ok: true,
      warning: `The pending invitation for ${member.full_name} was deleted, but its audit record could not be saved.`,
    });
  }
  return NextResponse.json({ ok: true });
}
