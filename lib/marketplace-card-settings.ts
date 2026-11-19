import type { CSSProperties } from "react";

export type MarketplaceCardAlignment = "spread" | "left" | "center" | "right";

export const SELLER_CARD_POSITION_ITEMS = [
  { key: "mineralName", label: "Mineral name" },
  { key: "color", label: "Color" },
  { key: "weight", label: "Weight" },
  { key: "price", label: "Price" },
  { key: "comment", label: "Comment" },
  { key: "location", label: "Location" },
  { key: "certificate", label: "Certificate link" },
  { key: "action", label: "Action button" },
] as const;

export const BUYER_CARD_POSITION_ITEMS = [
  { key: "wantedLabel", label: "Wanted label" },
  { key: "location", label: "Location" },
  { key: "mineralName", label: "Mineral name" },
  { key: "shape", label: "Shape" },
  { key: "weightLabel", label: "Weight label" },
  { key: "weightValue", label: "Weight value" },
  { key: "colorLabel", label: "Color label" },
  { key: "colorValue", label: "Color value" },
  { key: "qualityLabel", label: "Quality label" },
  { key: "qualityValue", label: "Quality value" },
  { key: "offerLabel", label: "Offer label" },
  { key: "offerValue", label: "Offer value" },
  { key: "action", label: "Action button" },
] as const;

export type MarketplaceCardPositionKey =
  | typeof SELLER_CARD_POSITION_ITEMS[number]["key"]
  | typeof BUYER_CARD_POSITION_ITEMS[number]["key"];

export type MarketplaceCardElementPosition = {
  desktopX: number;
  desktopY: number;
  phoneX: number;
  phoneY: number;
};

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
  positions: Partial<Record<MarketplaceCardPositionKey, MarketplaceCardElementPosition>>;
};

export type MarketplaceCardAppearanceSettings = {
  seller: MarketplaceCardStyleSettings;
  buyer: MarketplaceCardStyleSettings;
};

function createDefaultPositions(items: readonly { key: MarketplaceCardPositionKey; label: string }[]) {
  const positions: Partial<Record<MarketplaceCardPositionKey, MarketplaceCardElementPosition>> = {};
  for (const { key } of items) {
    positions[key] = { desktopX: 0, desktopY: 0, phoneX: 0, phoneY: 0 };
  }
  return positions;
}

const createDefaultCardStyle = (
  items: readonly { key: MarketplaceCardPositionKey; label: string }[],
): MarketplaceCardStyleSettings => ({
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
  positions: createDefaultPositions(items),
});

export const DEFAULT_MARKETPLACE_CARD_APPEARANCE: MarketplaceCardAppearanceSettings = {
  seller: createDefaultCardStyle(SELLER_CARD_POSITION_ITEMS),
  buyer: createDefaultCardStyle(BUYER_CARD_POSITION_ITEMS),
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

export function getMarketplaceCardPositionProperties(
  settings: MarketplaceCardStyleSettings,
  key: MarketplaceCardPositionKey,
): CSSProperties & Record<`--marketplace-card-position-${string}`, string> {
  const position = settings.positions[key] ?? { desktopX: 0, desktopY: 0, phoneX: 0, phoneY: 0 };
  return {
    "--marketplace-card-position-desktop": `${position.desktopX}px ${position.desktopY}px`,
    "--marketplace-card-position-phone": `${position.phoneX}px ${position.phoneY}px`,
  };
}

function isColor(value: unknown): value is string {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
}

function isSize(value: unknown, minimum: number, maximum: number): value is number | null {
  return value === null ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum);
}

function parseElementPosition(value: unknown): MarketplaceCardElementPosition | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const position = value as Record<string, unknown>;
  const isHorizontalOffset = (offset: unknown): offset is number =>
    typeof offset === "number" && Number.isSafeInteger(offset) && offset >= -120 && offset <= 120;
  const isVerticalOffset = (offset: unknown): offset is number =>
    typeof offset === "number" && Number.isSafeInteger(offset) && offset >= -180 && offset <= 180;
  if (!isHorizontalOffset(position.desktopX) || !isVerticalOffset(position.desktopY) ||
      !isHorizontalOffset(position.phoneX) || !isVerticalOffset(position.phoneY)) return null;
  return {
    desktopX: position.desktopX,
    desktopY: position.desktopY,
    phoneX: position.phoneX,
    phoneY: position.phoneY,
  };
}

function parseCardStyle(
  value: unknown,
  items: readonly { key: MarketplaceCardPositionKey; label: string }[],
): MarketplaceCardStyleSettings | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const settings = value as Record<string, unknown>;
  const rawPositions = settings.positions === undefined ? {} : settings.positions;
  if (typeof rawPositions !== "object" || rawPositions === null || Array.isArray(rawPositions)) return null;
  const parsedPositions: Partial<Record<MarketplaceCardPositionKey, MarketplaceCardElementPosition>> = {};
  for (const { key } of items) {
    const position = (rawPositions as Record<string, unknown>)[key];
    if (position === undefined) {
      parsedPositions[key] = { desktopX: 0, desktopY: 0, phoneX: 0, phoneY: 0 };
    } else {
      const parsedPosition = parseElementPosition(position);
      if (!parsedPosition) return null;
      parsedPositions[key] = parsedPosition;
    }
  }
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
    positions: parsedPositions,
  };
}

export function parseMarketplaceCardAppearanceSettings(value: unknown): MarketplaceCardAppearanceSettings | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const settings = value as Record<string, unknown>;
  const seller = parseCardStyle(settings.seller, SELLER_CARD_POSITION_ITEMS);
  const buyer = parseCardStyle(settings.buyer, BUYER_CARD_POSITION_ITEMS);
  return seller && buyer ? { seller, buyer } : null;
}
