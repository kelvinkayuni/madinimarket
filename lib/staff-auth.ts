import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function getOrderOperationsStaff(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  const admin = createSupabaseAdminClient();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return null;

  const { data: staff, error: staffError } = await admin.from("staff_members")
    .select("id, job_role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (staffError) throw staffError;
  if (!staff || staff.job_role !== "order_operations") return null;
  return { admin, userId: user.id, staffId: staff.id as number };
}
