import { createHash } from "node:crypto";

export function marketplacePayoutGroupKey(orderId: string, sellerId: string | null, receiptPath: string | null) {
  if (!receiptPath) return null;
  return createHash("sha256")
    .update(JSON.stringify([orderId, sellerId, receiptPath]))
    .digest("hex");
}
