import type { CSSProperties } from "react";

export type MarketplaceCardAlignment = "spread" | "left" | "center" | "right";

export type MarketplaceCardStyleSettings = {
  alignment: MarketplaceCardAlignment;
  titleColor: string | null;
  titleDesktopSize: number | null;
  titlePhoneSize: number | null;
  priceColor: string | null;
  priceDesktopSize: number | null;
  pricePhoneSize: number | null;
  detailsColor: string | null;
  detailsDesktopSize: number | null;
  detailsPhoneSize: number | null;
};

export type MarketplaceCardAppearanceSettings = {
  seller: MarketplaceCardStyleSettings;
  buyer: MarketplaceCardStyleSettings;
};

const createDefaultCardStyle = (): MarketplaceCardStyleSettings => ({
  alignment: "spread",
  titleColor: null,
  titleDesktopSize: null,
  titlePhoneSize: null,
  priceColor: null,
  priceDesktopSize: null,
  pricePhoneSize: null,
  detailsColor: null,
  detailsDesktopSize: null,
  detailsPhoneSize: null,
});

export const DEFAULT_MARKETPLACE_CARD_APPEARANCE: MarketplaceCardAppearanceSettings = {
  seller: createDefaultCardStyle(),
  buyer: createDefaultCardStyle(),
};

type MarketplaceCardStyleProperties = CSSProperties & Record<`--marketplace-card-${string}`, string | undefined>;

export function getMarketplaceCardStyleProperties(settings: MarketplaceCardStyleSettings): MarketplaceCardStyleProperties {
  const alignment = settings.alignment === "spread" ? "left" : settings.alignment;
  const textAlign = alignment;
  const justifyContent = settings.alignment === "spread"
    ? "space-between"
    : alignment === "right" ? "flex-end" : alignment === "center" ? "center" : "flex-start";
  const specsJustifyContent = alignment === "right" ? "flex-end" : alignment === "center" ? "center" : "flex-start";
  return {
    "--marketplace-card-alignment": alignment,
    "--marketplace-card-text-align": textAlign,
    "--marketplace-card-comment-align": settings.alignment === "spread" ? "right" : alignment,
    "--marketplace-card-justify": justifyContent,
    "--marketplace-card-specs-justify": specsJustifyContent,
    "--marketplace-card-title-color": settings.titleColor ?? undefined,
    "--marketplace-card-title-desktop-size": settings.titleDesktopSize === null ? undefined : `${settings.titleDesktopSize}px`,
    "--marketplace-card-title-phone-size": settings.titlePhoneSize === null ? undefined : `${settings.titlePhoneSize}px`,
    "--marketplace-card-price-color": settings.priceColor ?? undefined,
    "--marketplace-card-price-desktop-size": settings.priceDesktopSize === null ? undefined : `${settings.priceDesktopSize}px`,
    "--marketplace-card-price-phone-size": settings.pricePhoneSize === null ? undefined : `${settings.pricePhoneSize}px`,
    "--marketplace-card-details-color": settings.detailsColor ?? undefined,
    "--marketplace-card-details-desktop-size": settings.detailsDesktopSize === null ? undefined : `${settings.detailsDesktopSize}px`,
    "--marketplace-card-details-phone-size": settings.detailsPhoneSize === null ? undefined : `${settings.detailsPhoneSize}px`,
  };
}

function isColor(value: unknown): value is string {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
}

function isSize(value: unknown, minimum: number, maximum: number): value is number | null {
  return value === null ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum);
}

function parseCardStyle(value: unknown): MarketplaceCardStyleSettings | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const settings = value as Record<string, unknown>;
  if ((settings.alignment !== "spread" && settings.alignment !== "left" &&
      settings.alignment !== "center" && settings.alignment !== "right") ||
    (settings.titleColor !== null && !isColor(settings.titleColor)) ||
    !isSize(settings.titleDesktopSize, 10, 28) ||
    !isSize(settings.titlePhoneSize, 10, 24) ||
    (settings.priceColor !== null && !isColor(settings.priceColor)) ||
    !isSize(settings.priceDesktopSize, 9, 22) ||
    !isSize(settings.pricePhoneSize, 9, 20) ||
    (settings.detailsColor !== null && !isColor(settings.detailsColor)) ||
    !isSize(settings.detailsDesktopSize, 7, 16) ||
    !isSize(settings.detailsPhoneSize, 7, 14)) return null;

  return {
    alignment: settings.alignment,
    titleColor: settings.titleColor,
    titleDesktopSize: settings.titleDesktopSize,
    titlePhoneSize: settings.titlePhoneSize,
    priceColor: settings.priceColor,
    priceDesktopSize: settings.priceDesktopSize,
    pricePhoneSize: settings.pricePhoneSize,
    detailsColor: settings.detailsColor,
    detailsDesktopSize: settings.detailsDesktopSize,
    detailsPhoneSize: settings.detailsPhoneSize,
  };
}

export function parseMarketplaceCardAppearanceSettings(value: unknown): MarketplaceCardAppearanceSettings | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const settings = value as Record<string, unknown>;
  const seller = parseCardStyle(settings.seller);
  const buyer = parseCardStyle(settings.buyer);
  return seller && buyer ? { seller, buyer } : null;
}
