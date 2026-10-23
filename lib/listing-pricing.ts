export type ListingCurrency = "TZS" | "USD";

function roundForCurrency(amount: number, currency: ListingCurrency) {
  const precision = currency === "TZS" ? 0 : 2;
  const factor = 10 ** precision;
  return Math.round((amount + Number.EPSILON) * factor) / factor;
}

export function calculateListingPrice(sellerPrice: number, currency: ListingCurrency, feeRate: number) {
  const roundedSellerPrice = roundForCurrency(sellerPrice, currency);
  const feeAmount = roundForCurrency(roundedSellerPrice * feeRate, currency);
  return {
    sellerPrice: roundedSellerPrice,
    platformFeeRate: feeRate,
    platformFeeAmount: feeAmount,
    marketPrice: roundForCurrency(roundedSellerPrice + feeAmount, currency),
  };
}
