import type { SupabaseClient } from "@supabase/supabase-js";

import { getStaffAccess } from "@/lib/staff-auth";
import type { StaffPermission } from "@/lib/staff-permissions";

export const STAFF_TASK_PERMISSIONS: Record<string, readonly StaffPermission[]> = {
  listing_review: ["market_moderation"],
  buyer_request_review: ["market_moderation"],
  certificate_review: ["accounts"],
  marketplace_order: ["accounting"],
  marketplace_order_item: ["delivery_confirmation", "marketplace_orders", "accounting"],
  support_thread: ["customer_support"],
  website_account: ["accounts"],
  translation_pair: ["translations"],
  homepage_headline: ["homepage_headlines"],
  homepage_setting: ["homepage_headlines"],
};

export type StaffTaskType = keyof typeof STAFF_TASK_PERMISSIONS;

export async function getStaffTaskAccess(request: Request, taskType: string) {
  const permissions = STAFF_TASK_PERMISSIONS[taskType];
  if (!permissions) return null;
  const staff = await getStaffAccess(request);
  if (!staff || !permissions.some((permission) => staff.permissions.includes(permission))) return null;
  return staff;
}

export async function ownsStaffTaskClaim(
  admin: SupabaseClient,
  staffMemberId: number,
  taskType: StaffTaskType,
  taskId: string,
) {
  const { data, error } = await admin.from("staff_task_claims")
    .select("staff_member_id")
    .eq("task_type", taskType)
    .eq("task_id", taskId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return data?.staff_member_id === staffMemberId;
}
