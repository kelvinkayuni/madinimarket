export const STAFF_PERMISSION_OPTIONS = [
  { id: "delivery_confirmation", label: "Delivery confirmation" },
  { id: "marketplace_orders", label: "Marketplace order processing" },
  { id: "accounting", label: "Accounting — payment verification and payouts; no refunds" },
  { id: "customer_support", label: "Customer support" },
  { id: "market_moderation", label: "Market moderation" },
  { id: "accounts", label: "Accounts" },
  { id: "translations", label: "English–Swahili translations" },
  { id: "homepage_headlines", label: "Homepage headlines" },
] as const;

export type StaffPermission = (typeof STAFF_PERMISSION_OPTIONS)[number]["id"];

export function isStaffPermission(value: unknown): value is StaffPermission {
  return typeof value === "string" && STAFF_PERMISSION_OPTIONS.some((permission) => permission.id === value);
}
