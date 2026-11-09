import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { StaffPermission } from "@/lib/staff-permissions";

export async function getAdminClient(
  request: Request,
  staffPermission?: StaffPermission | readonly StaffPermission[],
) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  const admin = createSupabaseAdminClient();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile, error: profileError } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profileError) throw profileError;
  if (profile?.role === "admin") return admin;
  if (profile?.role !== "staff" || !staffPermission) return null;

  const { data: member, error: memberError } = await admin.from("staff_members")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (memberError) throw memberError;
  if (!member) return null;

  const { data: assignments, error: assignmentError } = await admin.from("staff_member_roles")
    .select("role_id")
    .eq("staff_member_id", member.id);
  if (assignmentError) throw assignmentError;
  const roleIds = (assignments ?? []).map((assignment) => assignment.role_id);
  if (!roleIds.length) return null;

  const { data: roles, error: rolesError } = await admin.from("staff_roles")
    .select("permissions")
    .in("id", roleIds);
  if (rolesError) throw rolesError;
  const required = Array.isArray(staffPermission) ? staffPermission : [staffPermission];
  return roles?.some((role) => required.some((permission) => role.permissions.includes(permission))) ? admin : null;
}