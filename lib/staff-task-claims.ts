import type { SupabaseClient } from "@supabase/supabase-js";

import { getStaffAccess } from "@/lib/staff-auth";
import type { StaffPermission } from "@/lib/staff-permissions";

export const STAFF_TASK_PERMISSIONS: Record<string, readonly StaffPermission[]> = {
  listing_review: ["seller_submission_reviews"],
  buyer_request_review: ["buyer_submission_reviews"],
  certificate_review: ["accounts"],
  marketplace_order: ["marketplace_orders"],
  marketplace_delivery: ["delivery_confirmation"],
  marketplace_payout: ["marketplace_orders"],
  marketplace_dispute: ["order_disputes"],
  buyer_refund: ["buyer_refunds"],
  support_thread: ["customer_support"],
  website_account: ["accounts"],
  translation_pair: ["translations"],
  homepage_headline: ["homepage_headlines"],
  homepage_setting: ["homepage_headlines"],
  account_setting: ["accounts"],
  subscription_payment: ["subscription_payment_confirmations"],
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
