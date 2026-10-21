export type ListingCurrency = "TZS" | "USD";

export const PLATFORM_FEE_RATE = 0.05;

function roundForCurrency(amount: number, currency: ListingCurrency) {
  const precision = currency === "TZS" ? 0 : 2;
  const factor = 10 ** precision;
  return Math.round((amount + Number.EPSILON) * factor) / factor;
}

export function calculateListingPrice(sellerPrice: number, currency: ListingCurrency) {
  const roundedSellerPrice = roundForCurrency(sellerPrice, currency);
  const feeAmount = roundForCurrency(roundedSellerPrice * PLATFORM_FEE_RATE, currency);
  return {
    sellerPrice: roundedSellerPrice,
    platformFeeRate: PLATFORM_FEE_RATE,
    platformFeeAmount: feeAmount,
    marketPrice: roundedSellerPrice + feeAmount,
  };
}
