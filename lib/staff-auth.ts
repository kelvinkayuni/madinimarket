import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { StaffPermission } from "@/lib/staff-permissions";

export async function getStaffAccess(request: Request, permission?: StaffPermission) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  const admin = createSupabaseAdminClient();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("role").eq("id", user.id).maybeSingle();
  if (profileError) throw profileError;
  if (profile?.role !== "staff") return null;
  const { data: member, error: memberError } = await admin.from("staff_members")
    .select("id, full_name, employee_code")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (memberError) throw memberError;
  if (!member) return null;

  const { data: assignments, error: assignmentsError } = await admin.from("staff_member_roles")
    .select("role:staff_roles(name, permissions)")
    .eq("staff_member_id", member.id);
  if (assignmentsError) throw assignmentsError;
  const roles = (assignments ?? []).flatMap((assignment) => assignment.role ?? []);
  const permissions = [...new Set(roles.flatMap((role) => role.permissions))] as StaffPermission[];
  if (permission && !permissions.includes(permission)) return null;
  return {
    admin,
    userId: user.id,
    staffId: member.id as number,
    fullName: member.full_name,
    employeeCode: member.employee_code,
    roles,
    permissions,
  };
}

export async function getOrderOperationsStaff(request: Request) {
  return getStaffAccess(request, "delivery_confirmation");
}
