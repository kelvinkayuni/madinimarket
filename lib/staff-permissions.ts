export const STAFF_PERMISSION_OPTIONS = [
  { id: "accounts", label: "Seller/Buyer Accounts" },
  { id: "translations", label: "English–Swahili Translations" },
  { id: "homepage_headlines", label: "Homepage Display" },
  { id: "marketplace_orders", label: "Marketplace Orders Processing" },
  { id: "delivery_confirmation", label: "Delivery Confirmation" },
  { id: "order_disputes", label: "Order Disputes" },
  { id: "buyer_refunds", label: "Buyer Refunds" },
  { id: "seller_submission_reviews", label: "Seller Submission Reviews" },
  { id: "buyer_submission_reviews", label: "Buyer Submission Reviews" },
  { id: "subscription_payment_confirmations", label: "Subscription Payment Confirmations" },
  { id: "customer_support", label: "Support Inbox" },
] as const;

export type StaffPermission = (typeof STAFF_PERMISSION_OPTIONS)[number]["id"];

export function isStaffPermission(value: unknown): value is StaffPermission {
  return typeof value === "string" && STAFF_PERMISSION_OPTIONS.some((permission) => permission.id === value);
}
