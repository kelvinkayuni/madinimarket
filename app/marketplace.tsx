"use client";

import { ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronDown, Eye, EyeOff, Gem, Menu, Plus, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import Image from "next/image";
import { FormEvent, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Session } from "@supabase/supabase-js";

import AdminMarketplaceOrders from "./admin-marketplace-orders";
import AdminPaymentInstructions from "./admin-payment-instructions";
import AdminOrderTimeLimits from "./admin-order-time-limits";
import SupportInbox from "./support-inbox";
import CommercePanel from "./commerce-panel";
import PrivateOfferForm from "./private-offer-form";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";
import { clearWebsiteSessionToken, fetchWithWebsiteSession, getWebsiteSessionToken, setWebsiteSessionToken } from "@/lib/client-website-session";
import { applyVisibleTranslations, type Language, type TranslationPair } from "@/lib/translations";
import { calculateListingPrice } from "@/lib/listing-pricing";
import { MARKET_TIME_ZONE, type MarketHoursSchedule } from "@/lib/market-hours";

type Unit = "g" | "kg" | "tons" | "carats";
type StoneWeightUnit = Exclude<Unit, "tons">;
type ListingType = "single" | "batch";
type Currency = "TZS" | "USD";
type AdminPanel = "review" | "ledger" | "translations" | "homepage" | "accounts" | "subscriptions" | "listing-fee" | "market-hours" | "orders" | "order-time-limits" | "payment-instructions" | "support";
type HomepageHeadline = { id: string; main_phrase: string; accent_phrase: string };
type SubmissionStatus = "pending" | "approved" | "rejected";
type CertificateKind = "dealer" | "broker";
type CertificateStatus = "pending" | "approved" | "rejected";
type CertificateSubmission = { id: string; kind: CertificateKind; status: CertificateStatus; review_message: string | null; file_name: string; signed_url: string; created_at: string };
type AdminCertificate = CertificateSubmission & { website_user_id: string; account?: { username: string; display_name: string; email: string } };
type Seller = { id: number; user_id?: string; website_account_seller?: boolean; reservation_status?: string | null; marketplace_state?: string; is_active?: boolean; mineral: string; listing_type?: ListingType; weight: string; unit: Unit; smallest_stone_weight?: string; largest_stone_weight?: string; stone_weight_unit?: StoneWeightUnit; seller_price?: string; platform_fee_rate?: number; platform_fee_amount?: string; price: string; currency: Currency; seller: string; location: string; country?: string; region?: string; district?: string; street?: string; email: string; phone: string; image: string; image_path?: string | null; stone_certificate_path?: string | null; stone_certificate_url?: string | null; verified_seller?: boolean; accent: string; status: SubmissionStatus; review_message?: string | null };
type Buyer = { id: number; user_id?: string; is_own?: boolean; offer_enabled?: boolean; mineral: string; weight: string; unit: Unit; color: string; shape: "Cut" | "Uncut"; quality: string; offer: string; currency: Currency; buyer: string; location: string; email: string; phone: string; status: SubmissionStatus; review_message?: string | null };
type AccountMarketListing = Pick<Seller, "id" | "mineral" | "listing_type" | "weight" | "unit" | "smallest_stone_weight" | "largest_stone_weight" | "stone_weight_unit" | "seller_price" | "platform_fee_rate" | "platform_fee_amount" | "price" | "currency" | "location" | "image">;
type AccountWantedMineral = Pick<Buyer, "id" | "mineral" | "weight" | "unit" | "color" | "shape" | "quality" | "offer" | "currency" | "location"> & {
  marketplace_status?: "available" | "temporarily_unavailable";
};
type AccountWantedRequest = {
  id: number;
  mineral_name: string;
  weight: string | number;
  unit: Unit;
  color: string;
  shape: Buyer["shape"];
  quality: string;
  offer: string | number;
  currency: Currency;
  location: string;
  marketplace_status?: AccountWantedMineral["marketplace_status"];
};
type WebsiteAccount = { id: string; display_name: string; username: string; email: string; phone: string | null; is_active: boolean; created_at: string; listings: SubmissionCounts; buying_requests: SubmissionCounts; subscription: { months: number; starts_at: string; expires_at: string } | null };
type SubmissionCounts = { total: number; pending: number; approved: number; rejected: number };
type WebsiteDraft = { kind: "seller" | "buyer"; payload: Record<string, string | number>; image_path: string | null; image_url?: string; updated_at: string };
type SalesLedgerTotals = Record<Currency, { transactions: number; grossSales: number; sellerAmount: number; marketplaceFee: number }>;
type SalesLedgerPeriod = { today: SalesLedgerTotals; thisWeek: SalesLedgerTotals; thisMonth: SalesLedgerTotals; thisYear: SalesLedgerTotals };
type SalesLedgerTransaction = { itemId: string; orderId: string; controlNumber: string; verifiedAt: string; mineralName: string; status: string; currency: Currency; grossSales: number; sellerAmount: number; marketplaceFee: number; feeRate: number };
type SalesLedgerData = { periods: SalesLedgerPeriod; transactions: SalesLedgerTransaction[]; timeZone: string };
type SalesLedgerPeriodFilter = "all" | "today" | "thisWeek" | "thisMonth" | "thisYear";
type SubscriptionPlan = { id: string; months: number; price_tzs: string; price_usd: string; is_active: boolean; updated_at?: string };
type SubscriptionPaymentMethod = { method: string; accountNumber: string };
type AccountSubscription = { id: string; website_user_id?: string; plan_id: string | null; months: number; currency: Currency; amount: string; status: "pending" | "active" | "expired" | "rejected"; requested_at: string; starts_at: string | null; expires_at: string | null; paid_at: string | null; payment_reference?: string | null; payment_receipt_url?: string | null; review_note?: string | null; account?: { display_name: string; username: string; email: string } | null };
type EditingSubmission = { kind: "seller"; item: Seller } | { kind: "buyer"; item: Buyer } | null;
type Dialog = "create" | "signin" | "forgot-password" | "sell" | "buy" | "review" | "submissions" | "subscription" | "my-market-minerals" | "my-wanted-minerals" | "my-licenses" | "commerce" | "private-offer" | "certificate-ready" | "support" | "signout" | null;

const SELLERS_STORAGE_KEY = "madinimarket:sellers:v1";
const BUYERS_STORAGE_KEY = "madinimarket:buyers:v1";
const USER_STORAGE_KEY = "madinimarket:user:v1";
const SALES_LEDGER_PAGE_SIZE = 25;
const signedMineralImageUrls = new Map<string, { url: string; expiresAt: number }>();

function salesLedgerPeriodKeys(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const localDate = new Date(Date.UTC(year, month - 1, day));
  localDate.setUTCDate(localDate.getUTCDate() - ((localDate.getUTCDay() + 6) % 7));
  return {
    day: `${values.year}-${values.month}-${values.day}`,
    week: localDate.toISOString().slice(0, 10),
    month: `${values.year}-${values.month}`,
    year: values.year,
  };
}
const defaultMarketHours: MarketHoursSchedule = {
  openDays: [0, 1, 2, 3, 4, 5, 6],
  openTime: "00:00",
  closeTime: "00:00",
  updatedAt: null,
  manuallyClosed: false,
};
const marketWeekdays = [
  { day: 1, label: "Monday" },
  { day: 2, label: "Tuesday" },
  { day: 3, label: "Wednesday" },
  { day: 4, label: "Thursday" },
  { day: 5, label: "Friday" },
  { day: 6, label: "Saturday" },
  { day: 0, label: "Sunday" },
];

function onBrowserResume(refresh: () => void | Promise<void>) {
  let lastRefreshAt = 0;
  const refreshWhenActive = () => {
    if (document.visibilityState !== "visible" || Date.now() - lastRefreshAt < 1_000) return;
    lastRefreshAt = Date.now();
    void refresh();
  };
  document.addEventListener("visibilitychange", refreshWhenActive);
  window.addEventListener("focus", refreshWhenActive);
  window.addEventListener("pageshow", refreshWhenActive);
  window.addEventListener("online", refreshWhenActive);
  return () => {
    document.removeEventListener("visibilitychange", refreshWhenActive);
    window.removeEventListener("focus", refreshWhenActive);
    window.removeEventListener("pageshow", refreshWhenActive);
    window.removeEventListener("online", refreshWhenActive);
  };
}

const money = (value: string, currency: Currency) => `${currency === "TZS" ? "TSh" : "$"} ${value}`;
const formatFeePercent = (value: number) => value.toFixed(2);
const formatMarketOpening = (value: string) => {
  const opening = new Date(value);
  const date = opening.toLocaleDateString("en-GB", {
    timeZone: MARKET_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = opening.toLocaleTimeString("en-GB", {
    timeZone: MARKET_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: MARKET_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(opening));
  const timeOfDay = hour < 5 ? "at night" : hour < 12 ? "in the morning" : hour < 17 ? "in the afternoon" : hour < 21 ? "in the evening" : "at night";
  return `${date} at ${time} ${timeOfDay}`;
};
const sellerPriceDetails = (listing: Pick<Seller, "seller_price" | "platform_fee_amount" | "price" | "currency">) => {
  const sellerPrice = listing.seller_price ?? listing.price;
  const platformFee = listing.platform_fee_amount ?? String(Number(listing.price) - Number(sellerPrice));
  return `Seller receives ${money(sellerPrice, listing.currency)} · Madinimarket fee ${money(platformFee, listing.currency)}`;
};
const isAdminRole = (role: "user" | "admin" | null): boolean => role === "admin";
const weightInGrams = (weight: number, unit: Unit | StoneWeightUnit) =>
  weight * ({ carats: 0.2, g: 1, kg: 1_000, tons: 1_000_000 }[unit]);
const isValidBatchWeightRange = (
  totalWeight: number,
  totalUnit: Unit,
  smallestWeight: number,
  largestWeight: number,
  stoneUnit: StoneWeightUnit,
) =>
  smallestWeight <= largestWeight &&
  weightInGrams(largestWeight, stoneUnit) <= weightInGrams(totalWeight, totalUnit);

function readStoredArray<T>(key: string): T[] {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

async function storeMineralPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = 800;
  const sourceSide = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image processing is unavailable.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, side, side);
  context.drawImage(
    bitmap,
    (bitmap.width - sourceSide) / 2,
    (bitmap.height - sourceSide) / 2,
    sourceSide,
    sourceSide,
    0,
    0,
    side,
    side,
  );
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function getSignedMineralImageUrl(
  supabase: ReturnType<typeof getSupabaseBrowserClient>,
  imagePath: string,
  refreshedUrl?: string,
) {
  const cached = signedMineralImageUrls.get(imagePath);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.url;

  try {
    let url = refreshedUrl ?? "";
    if (!url) {
      const { data, error } = await supabase.storage.from("mineral-images").createSignedUrl(imagePath, 3600);
      if (error) throw error;
      url = data.signedUrl;
    }
    if (url) signedMineralImageUrls.set(imagePath, { url, expiresAt: Date.now() + 50 * 60 * 1000 });
    return url;
  } catch (error) {
    console.error("Could not create a signed mineral image URL.", error);
    return "";
  }
}

async function loadMarketplaceListings(includeOwnSubmissions = false, adminAccessToken?: string) {
  const supabase = getSupabaseBrowserClient();

  const loadPublicSellerRows = async () => {
    const attempts = [
      () => supabase.from("market_listing_feed").select("*").order("created_at", { ascending: false }),
      () => supabase.from("marketplace_listings").select("*").order("created_at", { ascending: false }),
    ];

    const loadPublicRows = async () => {
      for (const attempt of attempts) {
        try {
          const { data, error } = await attempt();
          if (error) throw error;
          return data ?? [];
        } catch {
          // Try the next fallback view before treating the marketplace as unavailable.
        }
      }
      return null;
    };
    const publicRows = await loadPublicRows();
    if (!publicRows) return [];
    if (publicRows.length === 0) return [];
    const { data: reservationRows, error: reservationError } = await supabase
      .from("marketplace_listing_reservations")
      .select("listing_id, reservation_status")
      .in("listing_id", publicRows.map((row) => Number(row.id)));
    if (reservationError) throw reservationError;
    const reservationStatusByListing = new Map(
      (reservationRows ?? []).map((row) => [Number(row.listing_id), row.reservation_status as string]),
    );
    return publicRows.map((row) => ({
      ...row,
      reservation_status: reservationStatusByListing.get(Number(row.id)) ?? null,
    }));
  };

  const loadPublicBuyerRows = async () => {
    const attempts = [
      () => supabase.from("marketplace_buy_requests").select("*").order("created_at", { ascending: false }),
        () => supabase.from("buy_requests").select("id, mineral_name, weight, unit, color, shape, quality, offer, currency, location, status, created_at, is_active").eq("status", "approved").eq("is_active", true).order("created_at", { ascending: false }),
    ];

    for (const attempt of attempts) {
      try {
        const { data, error } = await attempt();
        if (error) throw error;
        return data ?? [];
      } catch {
        // Continue to the next fallback strategy if a public buy-request view is unavailable.
      }
    }
    return [];
  };

  const [sellerResult, buyerResult] = await Promise.all([
    loadPublicSellerRows(),
    loadPublicBuyerRows(),
  ]);

  let sellerRows = sellerResult;
  let buyerRows = buyerResult;
  const ownedBuyerRequestIds = new Set<number>();
  if (adminAccessToken) {
    try {
      const response = await fetch("/api/admin/review-queue", {
        headers: { Authorization: `Bearer ${adminAccessToken}` },
        cache: "no-store",
      });
      const reviewQueue = await response.json();
      if (!response.ok) throw new Error(reviewQueue.error ?? "Could not load pending submissions.");
      sellerRows = [...sellerRows, ...(reviewQueue.sellers ?? [])];
      buyerRows = [...buyerRows, ...(reviewQueue.buyers ?? [])];
    } catch {
      // Admin review queue is optional for public market loading. Keep the public listings available even if
      // the queue endpoint is temporarily unavailable or the admin session cannot be validated.
    }
  }
  if (includeOwnSubmissions) {
    try {
      const response = await fetchWithWebsiteSession("/api/website-submissions", { cache: "no-store" });
      if (response.ok) {
        const ownSubmissions = await response.json();
        sellerRows = [...sellerRows, ...(ownSubmissions.sellers ?? [])];
        buyerRows = [...buyerRows, ...(ownSubmissions.buyers ?? [])];
        for (const request of ownSubmissions.marketBuyers ?? []) {
          const id = Number(request.id);
          if (Number.isSafeInteger(id) && id > 0) ownedBuyerRequestIds.add(id);
        }
      }
    } catch {
      // Public listings remain available if a website account session has expired.
    }
  }

  const sellers = await Promise.all(sellerRows.map(async (row) => {
    let image = "";
    if (row.image_path) {
      image = await getSignedMineralImageUrl(supabase, row.image_path, row.signed_image_url);
    }
    return {
      id: Number(row.id), user_id: row.website_user_id ?? row.user_id, mineral: row.mineral_name, weight: String(row.weight),
      listing_type: row.listing_type as ListingType | undefined,
      unit: row.unit as Unit, price: String(row.price), currency: row.currency as Currency,
      seller_price: row.seller_price == null ? undefined : String(row.seller_price),
      platform_fee_rate: row.platform_fee_rate == null ? undefined : Number(row.platform_fee_rate),
      platform_fee_amount: row.platform_fee_amount == null ? undefined : String(row.platform_fee_amount),
      smallest_stone_weight: row.smallest_stone_weight == null ? undefined : String(row.smallest_stone_weight),
      largest_stone_weight: row.largest_stone_weight == null ? undefined : String(row.largest_stone_weight),
      stone_weight_unit: row.stone_weight_unit as StoneWeightUnit | undefined,
      seller: row.seller_name ?? "", country: row.country, region: row.region, district: row.district,
      location: [row.district, row.region, row.country].filter(Boolean).join(", "), email: row.email ?? "", phone: row.phone ?? "",
      image, image_path: row.image_path, accent: "#43866b", status: row.status as SubmissionStatus,
      reservation_status: row.reservation_status ?? null,
      marketplace_state: row.marketplace_state,
      is_active: row.is_active,
      review_message: row.review_message, stone_certificate_path: row.stone_certificate_path ?? null,
      stone_certificate_url: row.signed_stone_certificate_url ?? null,
      verified_seller: row.verified_seller === true,
      website_account_seller: Boolean(row.website_user_id),
    } satisfies Seller;
  }));
  const buyers = buyerRows.map((row) => ({
    id: Number(row.id), user_id: row.website_user_id ?? row.user_id, is_own: ownedBuyerRequestIds.has(Number(row.id)), mineral: row.mineral_name, weight: String(row.weight),
    unit: row.unit as Unit, color: row.color, shape: row.shape as Buyer["shape"], quality: row.quality,
    offer: String(row.offer), currency: row.currency as Currency, buyer: row.buyer_name, location: row.location,
    email: row.email ?? "", phone: row.phone ?? "", status: row.status as SubmissionStatus, review_message: row.review_message,
    offer_enabled: row.offer_enabled === true,
  } satisfies Buyer));
  return { sellers, buyers };
}

async function loadAdminAccounts(accessToken: string): Promise<WebsiteAccount[]> {
  const response = await fetch("/api/admin/website-accounts", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not load website accounts.");
  return result.accounts as WebsiteAccount[];
}

async function loadAdminSalesLedger(accessToken: string): Promise<SalesLedgerData> {
  const response = await fetch("/api/admin/sales-ledger", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not load the marketplace sales ledger.");
  if (typeof result !== "object" || result === null || !Array.isArray(result.transactions) ||
    typeof result.timeZone !== "string" || typeof result.periods !== "object" || result.periods === null) {
    throw new Error("Marketplace sales ledger data is invalid.");
  }
  return result as SalesLedgerData;
}

async function loadAdminCertificates(accessToken: string): Promise<AdminCertificate[]> {
  const response = await fetch("/api/admin/certificates", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not load licence reviews.");
  return result.certificates as AdminCertificate[];
}

async function loadAdminTranslations(accessToken: string): Promise<TranslationPair[]> {
  const response = await fetch("/api/admin/translations", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not load translation pairs.");
  return result.translations as TranslationPair[];
}

async function loadAdminSiteContent(accessToken: string): Promise<{ swahiliEnabled: boolean; headlineFontSize: number; accountCreationDisabled: boolean; nonAdminSignInDisabled: boolean; homepageAnnouncement: string; headlines: HomepageHeadline[] }> {
  const response = await fetch("/api/admin/site-content", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not load homepage and language settings.");
  if (typeof result.swahiliEnabled !== "boolean" || typeof result.accountCreationDisabled !== "boolean" || typeof result.nonAdminSignInDisabled !== "boolean" || typeof result.homepageAnnouncement !== "string" || !Number.isInteger(result.headlineFontSize) ||
    result.headlineFontSize < 24 || result.headlineFontSize > 72 || !Array.isArray(result.headlines) ||
    !result.headlines.every((headline: unknown) =>
      typeof headline === "object" && headline !== null &&
      "id" in headline && typeof headline.id === "string" &&
      "main_phrase" in headline && typeof headline.main_phrase === "string" &&
      "accent_phrase" in headline && typeof headline.accent_phrase === "string",
    )) {
    throw new Error("Homepage and language settings are invalid.");
  }
  return {
    swahiliEnabled: result.swahiliEnabled,
    headlineFontSize: result.headlineFontSize,
    accountCreationDisabled: result.accountCreationDisabled,
    nonAdminSignInDisabled: result.nonAdminSignInDisabled,
    homepageAnnouncement: result.homepageAnnouncement,
    headlines: result.headlines,
  };
}

async function loadAdminSubscriptions(accessToken: string): Promise<{ plans: SubscriptionPlan[]; pendingSubscriptions: AccountSubscription[] }> {
  const response = await fetch("/api/admin/subscriptions", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not load subscription administration data.");
  return {
    plans: result.plans as SubscriptionPlan[],
    pendingSubscriptions: result.pendingSubscriptions as AccountSubscription[],
  };
}

export default function Marketplace() {
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [websiteAccounts, setWebsiteAccounts] = useState<WebsiteAccount[]>([]);
  const [usdEnabled, setUsdEnabled] = useState(true);
  const [currencySettingsLoaded, setCurrencySettingsLoaded] = useState(!isSupabaseConfigured);
  const [listingFeePercent, setListingFeePercent] = useState(5);
  const [listingFeePercentInput, setListingFeePercentInput] = useState("5");
  const [listingFeeUpdatedAt, setListingFeeUpdatedAt] = useState<string | null>(null);
  const [listingFeeSettingsLoaded, setListingFeeSettingsLoaded] = useState(!isSupabaseConfigured);
  const listingFeeDraftDirty = useRef(false);
  const [marketHours, setMarketHours] = useState<MarketHoursSchedule>(defaultMarketHours);
  const [marketHoursDraft, setMarketHoursDraft] = useState<MarketHoursSchedule>(defaultMarketHours);
  const [marketHoursLoaded, setMarketHoursLoaded] = useState(!isSupabaseConfigured);
  const marketHoursDraftDirty = useRef(false);
  const [marketIsOpen, setMarketIsOpen] = useState(!isSupabaseConfigured);
  const [currentMarketHours, setCurrentMarketHours] = useState<string | null>(null);
  const [nextMarketOpenAt, setNextMarketOpenAt] = useState<string | null>(null);
  const [marketHoursError, setMarketHoursError] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState<"all" | "active" | "deactivated" | "approvedLicence" | "subscribed" | "notSubscribed" | "noApprovedLicence" | "licencePending">("all");
  const [accountPage, setAccountPage] = useState(1);
  const accountListRef = useRef<HTMLDivElement>(null);
  const accountListScrollTop = useRef<number | null>(null);
  const [adminSalesLedger, setAdminSalesLedger] = useState<SalesLedgerData | null>(null);
  const [adminSalesLedgerError, setAdminSalesLedgerError] = useState("");
  const [salesLedgerSearchInput, setSalesLedgerSearchInput] = useState("");
  const [salesLedgerSearch, setSalesLedgerSearch] = useState("");
  const [salesLedgerCurrency, setSalesLedgerCurrency] = useState<"all" | Currency>("all");
  const [salesLedgerStatus, setSalesLedgerStatus] = useState("all");
  const [salesLedgerPeriod, setSalesLedgerPeriod] = useState<SalesLedgerPeriodFilter>("all");
  const [salesLedgerPage, setSalesLedgerPage] = useState(1);
  const [translationPairs, setTranslationPairs] = useState<TranslationPair[]>([]);
  const [translationForm, setTranslationForm] = useState({ english_phrase: "", swahili_phrase: "" });
  const [editingTranslationId, setEditingTranslationId] = useState<string | null>(null);
  const [swahiliEnabled, setSwahiliEnabled] = useState(true);
  const [accountCreationDisabled, setAccountCreationDisabled] = useState(false);
  const [nonAdminSignInDisabled, setNonAdminSignInDisabled] = useState(false);
  const [signOutAllUsersAction, setSignOutAllUsersAction] = useState(false);
  const [homepageAnnouncement, setHomepageAnnouncement] = useState("");
  const [homepageAnnouncementDraft, setHomepageAnnouncementDraft] = useState("");
  const homepageAnnouncementDirty = useRef(false);
  const [siteContentLoaded, setSiteContentLoaded] = useState(false);
  const [homepageHeadlines, setHomepageHeadlines] = useState<HomepageHeadline[]>([]);
  const [homepageHeadlineIndex, setHomepageHeadlineIndex] = useState(0);
  const [homepageHeadlineFontSize, setHomepageHeadlineFontSize] = useState(49);
  const [homepageHeadlineFontSizeInput, setHomepageHeadlineFontSizeInput] = useState("49");
  const [failedSellerImageIds, setFailedSellerImageIds] = useState<Set<number>>(() => new Set());
  const filteredSalesLedgerTransactions = useMemo(() => {
    const transactions = adminSalesLedger?.transactions ?? [];
    const query = salesLedgerSearch.trim().toLocaleLowerCase();
    const currentPeriods = adminSalesLedger
      ? salesLedgerPeriodKeys(new Date(), adminSalesLedger.timeZone)
      : null;
    return transactions.filter((transaction) => {
      if (salesLedgerCurrency !== "all" && transaction.currency !== salesLedgerCurrency) return false;
      if (salesLedgerStatus !== "all" && transaction.status !== salesLedgerStatus) return false;
      if (query && !`${transaction.controlNumber} ${transaction.mineralName}`.toLocaleLowerCase().includes(query)) return false;
      if (salesLedgerPeriod !== "all" && currentPeriods && adminSalesLedger) {
        const transactionPeriods = salesLedgerPeriodKeys(new Date(transaction.verifiedAt), adminSalesLedger.timeZone);
        const periodKey = salesLedgerPeriod === "today" ? "day"
          : salesLedgerPeriod === "thisWeek" ? "week"
            : salesLedgerPeriod === "thisMonth" ? "month" : "year";
        if (transactionPeriods[periodKey] !== currentPeriods[periodKey]) return false;
      }
      return true;
    });
  }, [adminSalesLedger, salesLedgerCurrency, salesLedgerPeriod, salesLedgerSearch, salesLedgerStatus]);
  const salesLedgerPageCount = Math.max(1, Math.ceil(filteredSalesLedgerTransactions.length / SALES_LEDGER_PAGE_SIZE));
  const activeSalesLedgerPage = Math.min(salesLedgerPage, salesLedgerPageCount);
  const visibleSalesLedgerTransactions = filteredSalesLedgerTransactions.slice(
    (activeSalesLedgerPage - 1) * SALES_LEDGER_PAGE_SIZE,
    activeSalesLedgerPage * SALES_LEDGER_PAGE_SIZE,
  );
  const activeHomepageHeadline = homepageHeadlines.length
    ? homepageHeadlines[homepageHeadlineIndex % homepageHeadlines.length]
    : null;
  const [homepageHeadlineForm, setHomepageHeadlineForm] = useState({ mainPhrase: "", accentPhrase: "" });
  const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlan[]>([]);
  const [pendingSubscriptions, setPendingSubscriptions] = useState<AccountSubscription[]>([]);
  const [subscriptionPlanForm, setSubscriptionPlanForm] = useState({ months: "", price_tzs: "", price_usd: "" });
  const [editingSubscriptionPlanId, setEditingSubscriptionPlanId] = useState<string | null>(null);
  const [userSubscriptionPlans, setUserSubscriptionPlans] = useState<SubscriptionPlan[]>([]);
  const [subscriptionPaymentMethods, setSubscriptionPaymentMethods] = useState<SubscriptionPaymentMethod[]>([]);
  const [subscriptionPaymentInstructions, setSubscriptionPaymentInstructions] = useState("");
  const [activeSubscription, setActiveSubscription] = useState<AccountSubscription | null>(null);
  const [scheduledSubscription, setScheduledSubscription] = useState<AccountSubscription | null>(null);
  const [pendingUserSubscription, setPendingUserSubscription] = useState<AccountSubscription | null>(null);
  const [previousSubscription, setPreviousSubscription] = useState<AccountSubscription | null>(null);
  const [selectedSubscriptionRequest, setSelectedSubscriptionRequest] = useState<{ planId: string; currency: Currency } | null>(null);
  const [subscriptionReceiptName, setSubscriptionReceiptName] = useState("");
  const [subscriptionRejectionNotes, setSubscriptionRejectionNotes] = useState<Record<string, string>>({});
  const [userSubscriptionLoaded, setUserSubscriptionLoaded] = useState(false);
  const [userSubscriptionError, setUserSubscriptionError] = useState("");
  const [language, setLanguage] = useState<Language>("en");
  const [certificates, setCertificates] = useState<Partial<Record<CertificateKind, CertificateSubmission>>>({});
  const [certificateFiles, setCertificateFiles] = useState<Partial<Record<CertificateKind, File>>>({});
  const [adminCertificates, setAdminCertificates] = useState<AdminCertificate[]>([]);
  const [myMarketMinerals, setMyMarketMinerals] = useState<AccountMarketListing[]>([]);
  const [myWantedMinerals, setMyWantedMinerals] = useState<AccountWantedMineral[]>([]);
  const [userAccountListSearch, setUserAccountListSearch] = useState("");
  const [userAccountListFilter, setUserAccountListFilter] = useState<"all" | "pending" | "rejected">("all");
  const [userAccountListPage, setUserAccountListPage] = useState(1);
  const accountListScroll = useRef({ submissions: 0, market: 0, wanted: 0 });
  const submissionsListRef = useRef<HTMLDivElement>(null);
  const marketListRef = useRef<HTMLDivElement>(null);
  const wantedListRef = useRef<HTMLDivElement>(null);
  const [certificateRejectionMessages, setCertificateRejectionMessages] = useState<Record<string, string>>({});
  const [busyCertificate, setBusyCertificate] = useState<CertificateKind | string | null>(null);
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);
  const [busyActions, setBusyActions] = useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = useState<Dialog>(null);
  const returnToOrdersAfterSignIn = useRef(false);
  const returnToCertificateAfterSignIn = useRef<number | null>(null);
  const [certificateReadyListingId, setCertificateReadyListingId] = useState<number | null>(null);
  const [privateOfferRequest, setPrivateOfferRequest] = useState<Buyer | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [activeAdminPanel, setActiveAdminPanel] = useState<AdminPanel | null>(null);
  const [user, setUser] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [userId, setUserId] = useState("");
  const [marketplaceOrdersNeedingAction, setMarketplaceOrdersNeedingAction] = useState(0);
  const [cartListingIds, setCartListingIds] = useState<Set<number>>(() => new Set());
  const [cartListingAccountId, setCartListingAccountId] = useState("");
  const [sellerOpenOrdersCount, setSellerOpenOrdersCount] = useState(0);
  const [buyerOpenOrdersCount, setBuyerOpenOrdersCount] = useState(0);
  const [privateOffersCount, setPrivateOffersCount] = useState(0);
  const [sellingCount, setSellingCount] = useState(0);
  const [buyingCount, setBuyingCount] = useState(0);
  const updateAccountMenuCounts = useCallback((counts: { sellerOpenOrdersCount: number; buyerOpenOrdersCount: number; privateOffersCount: number; sellingCount: number; buyingCount: number; cartListingIds: number[] }) => {
    setSellerOpenOrdersCount(counts.sellerOpenOrdersCount);
    setBuyerOpenOrdersCount(counts.buyerOpenOrdersCount);
    setPrivateOffersCount(counts.privateOffersCount);
    setSellingCount(counts.sellingCount);
    setBuyingCount(counts.buyingCount);
    setCartListingIds(new Set(counts.cartListingIds));
    setCartListingAccountId(userId);
  }, [userId]);
  const [role, setRole] = useState<"user" | "admin" | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [appUpdateAvailable, setAppUpdateAvailable] = useState(false);
  const appVersion = useRef<string | null>(process.env.NEXT_PUBLIC_APP_VERSION ?? null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [sellerImagePreview, setSellerImagePreview] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [rejectionMessages, setRejectionMessages] = useState<Record<string, string>>({});

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("signin") !== "1") return;
    returnToOrdersAfterSignIn.current = url.searchParams.get("returnTo") === "orders";
    const certificateId = Number(url.searchParams.get("listingId"));
    if (url.searchParams.get("returnTo") === "certificate" && Number.isSafeInteger(certificateId) && certificateId > 0) {
      returnToCertificateAfterSignIn.current = certificateId;
    }
    url.searchParams.delete("signin");
    url.searchParams.delete("returnTo");
    url.searchParams.delete("listingId");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    const frame = window.requestAnimationFrame(() => setDialog("signin"));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const [websiteDrafts, setWebsiteDrafts] = useState<{ seller: WebsiteDraft | null; buyer: WebsiteDraft | null }>({ seller: null, buyer: null });
  const [editingSubmission, setEditingSubmission] = useState<EditingSubmission>(null);
  const [sellerListingType, setSellerListingType] = useState<ListingType>("single");
  const currencyOptions: [string, string][] = currencySettingsLoaded && usdEnabled
    ? [["TZS", "TZS"], ["USD", "USD"]]
    : [["TZS", "TSh"]];
  const sellerFeePercent = editingSubmission?.kind === "seller" && editingSubmission.item.platform_fee_rate != null
    ? editingSubmission.item.platform_fee_rate * 100
    : listingFeePercent;
  const marketHoursChanged = marketHoursDraft.openTime !== marketHours.openTime ||
    marketHoursDraft.closeTime !== marketHours.closeTime ||
    marketHoursDraft.openDays.length !== marketHours.openDays.length ||
    marketHoursDraft.openDays.some((day) => !marketHours.openDays.includes(day));
  const draftSaveTimers = useRef<{ seller: number | null; buyer: number | null }>({ seller: null, buyer: null });
  const draftRestoreDialog = useRef<Dialog>(null);
  const sellerRail = useRef<HTMLDivElement>(null);
  const buyerRail = useRef<HTMLDivElement>(null);
  const filteredWebsiteAccounts = useMemo(() => {
    const certificatesByAccount = new Map<string, AdminCertificate[]>();
    for (const certificate of adminCertificates) {
      const accountCertificates = certificatesByAccount.get(certificate.website_user_id) ?? [];
      accountCertificates.push(certificate);
      certificatesByAccount.set(certificate.website_user_id, accountCertificates);
    }
    const search = accountSearch.trim().toLocaleLowerCase();
    return [...websiteAccounts]
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .filter((account) => {
        const accountCertificates = certificatesByAccount.get(account.id) ?? [];
        const hasApprovedLicence = accountCertificates.some((certificate) => certificate.status === "approved");
        const hasPendingLicence = accountCertificates.some((certificate) => certificate.status === "pending");
        const matchesFilter = accountFilter === "all" ||
          (accountFilter === "active" && account.is_active) ||
          (accountFilter === "deactivated" && !account.is_active) ||
          (accountFilter === "approvedLicence" && hasApprovedLicence) ||
          (accountFilter === "subscribed" && Boolean(account.subscription)) ||
          (accountFilter === "notSubscribed" && !account.subscription) ||
          (accountFilter === "noApprovedLicence" && !hasApprovedLicence) ||
          (accountFilter === "licencePending" && hasPendingLicence);
        const matchesSearch = !search ||
          `${account.display_name} ${account.username} ${account.email} ${account.id}`.toLocaleLowerCase().includes(search);
        return matchesFilter && matchesSearch;
      });
  }, [accountFilter, accountSearch, adminCertificates, websiteAccounts]);
  const accountPageSize = 25;
  const accountPageCount = Math.max(1, Math.ceil(filteredWebsiteAccounts.length / accountPageSize));
  const activeAccountPage = Math.min(accountPage, accountPageCount);
  const visibleWebsiteAccounts = filteredWebsiteAccounts.slice(
    (activeAccountPage - 1) * accountPageSize,
    activeAccountPage * accountPageSize,
  );

  useLayoutEffect(() => {
    const scrollTop = accountListScrollTop.current;
    if (scrollTop === null) return;
    if (accountListRef.current) accountListRef.current.scrollTop = scrollTop;
    accountListScrollTop.current = null;
  }, [websiteAccounts]);

  const withProgress = async (key: string, action: () => Promise<void>) => {
    if (busyActions.has(key)) return;
    setBusyActions((current) => new Set(current).add(key));
    try {
      await action();
    } finally {
      setBusyActions((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  useEffect(() => {
    if (role !== "user" || !userId || !isSupabaseConfigured) return;
    let active = true;
    let loading = false;
    const refreshAccountCounts = async () => {
      if (loading || document.visibilityState !== "visible") return;
      loading = true;
      try {
        const response = await fetchWithWebsiteSession("/api/commerce", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not load account counts.");
        if (active) {
          setSellerOpenOrdersCount(Number(result.sellerOpenOrdersCount) || 0);
          setBuyerOpenOrdersCount(Number(result.buyerOpenOrdersCount) || 0);
          setPrivateOffersCount(Number(result.privateOffersCount) || 0);
          setSellingCount(Number(result.sellingCount) || 0);
          setBuyingCount(Number(result.buyingCount) || 0);
          setCartListingIds(new Set((result.cartItems ?? []).map((item: { listing_id: number }) => Number(item.listing_id)).filter(Number.isSafeInteger)));
          setCartListingAccountId(userId);
        }
      } catch (error) {
        if (active) console.error("Could not refresh account counts.", error);
      } finally {
        loading = false;
      }
    };
    void refreshAccountCounts();
    const interval = window.setInterval(() => void refreshAccountCounts(), 30_000);
    const removeResumeListener = onBrowserResume(refreshAccountCounts);
    return () => {
      active = false;
      window.clearInterval(interval);
      removeResumeListener();
    };
  }, [role, userId]);
  useEffect(() => {
    if (role !== "admin" || !userId || !isSupabaseConfigured) return;
    let active = true;
    let loading = false;
    let refreshTimer: number | undefined;
    const refreshMarketplaceOrdersNeedingAction = async () => {
      if (loading || document.visibilityState !== "visible") return;
      loading = true;
      try {
        const { data: { session }, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
        if (sessionError) throw sessionError;
        if (!session) throw new Error("Admin session expired.");
        const response = await fetch("/api/admin/marketplace-orders?summary=1", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not load marketplace orders needing action.");
        if (!Number.isSafeInteger(result.marketplaceOrdersNeedingAction) || result.marketplaceOrdersNeedingAction < 0) {
          throw new Error("Marketplace orders needing action count is invalid.");
        }
        if (active) setMarketplaceOrdersNeedingAction(result.marketplaceOrdersNeedingAction);
      } catch (error) {
        if (active) console.error("Could not refresh marketplace orders needing action.", error);
      } finally {
        loading = false;
      }
    };
    const scheduleRefresh = () => {
      if (document.visibilityState !== "visible" || refreshTimer !== undefined) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        void refreshMarketplaceOrdersNeedingAction();
      }, 200);
    };
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel("admin-marketplace-order-count", { config: { private: true } })
      .on("broadcast", { event: "marketplace_orders_changed" }, scheduleRefresh)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          scheduleRefresh();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(`Marketplace order count Realtime subscription status: ${status}.`);
        }
      });
    const removeResumeListener = onBrowserResume(refreshMarketplaceOrdersNeedingAction);
    return () => {
      active = false;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
      removeResumeListener();
    };
  }, [role, userId]);

  const addMineralToCart = async (listing: Seller) => {
    if (role !== "user") {
      setNotice("Sign in or create an account to add minerals to your cart.");
      setDialog("signin");
      return;
    }
    if (!listing.website_account_seller) {
      setNotice("This seller has not connected a Madinimarket account for order availability confirmations yet.");
      return;
    }
    if (listing.user_id === userId) {
      setNotice("You cannot add your own listing to your cart.");
      return;
    }
    await withProgress(`cart-add-${listing.id}`, async () => {
      try {
        const response = await fetchWithWebsiteSession("/api/commerce", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "add_to_cart", listingId: listing.id }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not add this mineral to your cart.");
        setCartListingIds((current) => new Set(current).add(listing.id));
        setCartListingAccountId(userId);
        const cartResponse = await fetchWithWebsiteSession("/api/commerce", { cache: "no-store" });
        const cartResult = await cartResponse.json();
        if (!cartResponse.ok) throw new Error(cartResult.error ?? "The item was added, but your cart could not be refreshed.");
        const nextCartListingIds = new Set<number>((cartResult.cartItems ?? []).map((item: { listing_id: number }) => Number(item.listing_id)).filter(Number.isSafeInteger));
        setCartListingIds(nextCartListingIds);
        setCartListingAccountId(userId);
        setNotice(`${listing.mineral} added to your cart.`);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not add this mineral to your cart.");
      }
    });
  };

  const openStoneCertificate = (event: React.MouseEvent<HTMLAnchorElement>, listingId: number) => {
    event.preventDefault();
    if (role === "user") {
      const certificateTab = window.open("about:blank", "_blank");
      if (!certificateTab) {
        setNotice("Allow pop-ups to open this certificate.");
        return;
      }
      void fetchWithWebsiteSession(`/api/listing-certificate?id=${listingId}`)
        .then(async (response) => {
          if (!response.ok) {
            const result = await response.json();
            throw new Error(result.error ?? "Could not open this certificate.");
          }
          const certificateUrl = URL.createObjectURL(await response.blob());
          certificateTab.location.href = certificateUrl;
          window.setTimeout(() => URL.revokeObjectURL(certificateUrl), 60_000);
        })
        .catch((error: unknown) => {
          certificateTab.close();
          setNotice(error instanceof Error ? error.message : "Could not open this certificate.");
        });
      return;
    }
    returnToCertificateAfterSignIn.current = listingId;
    setNotice("Sign in to view this mineral's certificate.");
    setDialog("signin");
  };

  const openPrivateOfferForm = (request: Buyer) => {
    if (request.is_own || request.user_id === userId) {
      setNotice("You cannot send a private offer to your own buying request.");
      return;
    }
    if (role !== "user") {
      setNotice("Sign in to send a private offer through Madinimarket.");
      setDialog("signin");
      return;
    }
    if (!hasApprovedCertificate) {
      setNotice("An approved dealer or broker licence is required before sending a private mineral offer.");
      void openAccountLicences();
      return;
    }
    if (!request.offer_enabled) return;
    setPrivateOfferRequest(request);
    setDialog("private-offer");
  };

  const sendPrivateOffer = async (details: Record<string, unknown>) => {
    await withProgress("private-offer-submit", async () => {
      try {
        const response = await fetchWithWebsiteSession("/api/marketplace-offers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(details),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not send your private offer.");
        setDialog(null);
        setPrivateOfferRequest(null);
        setNotice("Private offer sent. The buyer can review it in their account.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not send your private offer.");
      }
    });
  };

  useEffect(() => {
    if (!sellerImagePreview?.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(sellerImagePreview);
  }, [sellerImagePreview]);
  useEffect(() => {
    const updateTime = () => setLastUpdated(new Date());
    updateTime();
    const interval = window.setInterval(updateTime, 60_000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    let active = true;
    const checkAppVersion = async () => {
      try {
        const response = await fetch("/api/app-version", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || typeof result.version !== "string") {
          throw new Error(result.error ?? "Could not check for app updates.");
        }
        if (!active) return;
        if (appVersion.current === null) appVersion.current = result.version;
        else if (appVersion.current !== result.version) setAppUpdateAvailable(true);
      } catch (error) {
        if (active) console.error("Could not check for app updates.", error);
      }
    };
    void checkAppVersion();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void checkAppVersion();
    }, 60_000);
    const removeResumeListener = onBrowserResume(checkAppVersion);
    return () => {
      active = false;
      window.clearInterval(interval);
      removeResumeListener();
    };
  }, []);
  useEffect(() => {
    let active = true;
    const validateWebsiteSession = async () => {
      if (!getWebsiteSessionToken()) return;
      try {
        const response = await fetchWithWebsiteSession("/api/auth/website-session", { cache: "no-store" });
        const result = response.ok ? await response.json() : null;
        if (!active || result?.account) return;
        clearWebsiteSessionToken();
        setUser("");
        setDisplayName("");
        setUserId("");
        setRole(null);
        setCertificates({});
        setSellerOpenOrdersCount(0);
        setBuyerOpenOrdersCount(0);
        setPrivateOffersCount(0);
        setDialog(null);
        setNotice("Your session has ended. Please sign in again.");
      } catch {
        // Keep the current session until the next validation attempt.
      }
    };
    void validateWebsiteSession();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void validateWebsiteSession();
    }, 30_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void validateWebsiteSession();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);
  useEffect(() => {
    let active = true;
    const refreshTranslations = async () => {
      try {
        const response = await fetch("/api/translations", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not load language translations.");
        if (active) setTranslationPairs(result.translations as TranslationPair[]);
      } catch (error) {
        if (active) setNotice(error instanceof Error ? error.message : "Could not load language translations.");
      }
    };
    const refreshSiteContent = async () => {
      try {
        const response = await fetch("/api/site-content", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || typeof result.swahiliEnabled !== "boolean" || typeof result.accountCreationDisabled !== "boolean" || typeof result.nonAdminSignInDisabled !== "boolean" || typeof result.homepageAnnouncement !== "string" || !Number.isInteger(result.headlineFontSize) ||
          result.headlineFontSize < 24 || result.headlineFontSize > 72 || !Array.isArray(result.headlines)) {
          throw new Error(result.error ?? "Could not load homepage and language settings.");
        }
        if (!active) return;
        setSwahiliEnabled(result.swahiliEnabled);
        setAccountCreationDisabled(Boolean(result.accountCreationDisabled));
        setNonAdminSignInDisabled(Boolean(result.nonAdminSignInDisabled));
        setHomepageAnnouncement(typeof result.homepageAnnouncement === "string" ? result.homepageAnnouncement : "");
        setHomepageHeadlineFontSize(result.headlineFontSize);
        setHomepageHeadlineFontSizeInput(String(result.headlineFontSize));
        setSiteContentLoaded(true);
        setHomepageHeadlines((current) => {
          const next = result.headlines as HomepageHeadline[];
          return current.length === next.length && current.every((headline, index) =>
            headline.id === next[index]?.id &&
            headline.main_phrase === next[index]?.main_phrase &&
            headline.accent_phrase === next[index]?.accent_phrase,
          ) ? current : next;
        });
        if (!result.swahiliEnabled) {
          setLanguage("en");
          try {
            localStorage.setItem("madinimarket:language:v1", "en");
          } catch {
            setNotice("This browser could not update its language preference.");
          }
        } else {
          try {
            if (localStorage.getItem("madinimarket:language:v1") === "sw") setLanguage("sw");
          } catch {
            setNotice("This browser could not load your language preference.");
          }
        }
      } catch (error) {
        if (active) setNotice(error instanceof Error ? error.message : "Could not load homepage and language settings.");
      }
    };
    void refreshTranslations();
    void refreshSiteContent();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshTranslations();
        void refreshSiteContent();
      }
    }, 60_000);
    const removeResumeListener = onBrowserResume(() => {
      void refreshTranslations();
      void refreshSiteContent();
    });
    return () => {
      active = false;
      window.clearInterval(interval);
      removeResumeListener();
    };
  }, []);
  useEffect(() => {
    if (homepageHeadlines.length < 2) return;
    const interval = window.setInterval(() => {
      setHomepageHeadlineIndex((current) => (current + 1) % homepageHeadlines.length);
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [homepageHeadlines.length]);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    let loaded = false;
    const refreshCurrencySettings = async () => {
      try {
        const response = await fetch("/api/currency-settings", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not load marketplace currency settings.");
        if (typeof result.usdEnabled !== "boolean") throw new Error("Marketplace currency settings are invalid.");
        loaded = true;
        if (active) {
          setUsdEnabled(result.usdEnabled);
          setCurrencySettingsLoaded(true);
        }
      } catch (error) {
        if (!active) return;
        if (!loaded) {
          setUsdEnabled(false);
          setCurrencySettingsLoaded(true);
          setNotice(error instanceof Error ? error.message : "Could not load marketplace currency settings.");
        }
        loaded = true;
      }
    };
    void refreshCurrencySettings();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshCurrencySettings();
    }, 30_000);
    const removeResumeListener = onBrowserResume(refreshCurrencySettings);
    return () => {
      active = false;
      window.clearInterval(interval);
      removeResumeListener();
    };
  }, []);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    let initialLoadComplete = false;
    const refreshListingFeeSettings = async () => {
      try {
        const response = await fetch("/api/listing-fee-settings", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not load mineral listing fee settings.");
        if (typeof result.feePercent !== "number" || !Number.isFinite(result.feePercent) ||
          result.feePercent < 0 || result.feePercent > 100) {
          throw new Error("Mineral listing fee settings are invalid.");
        }
        initialLoadComplete = true;
        if (!active) return;
        setListingFeePercent(result.feePercent);
        setListingFeeUpdatedAt(typeof result.updatedAt === "string" ? result.updatedAt : null);
        setListingFeeSettingsLoaded(true);
        if (!listingFeeDraftDirty.current) setListingFeePercentInput(formatFeePercent(result.feePercent));
      } catch (error) {
        if (!active) return;
        if (!initialLoadComplete) {
          setNotice(error instanceof Error ? error.message : "Could not load mineral listing fee settings.");
        }
        initialLoadComplete = true;
      }
    };
    void refreshListingFeeSettings();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshListingFeeSettings();
    }, 30_000);
    const removeResumeListener = onBrowserResume(refreshListingFeeSettings);
    return () => {
      active = false;
      window.clearInterval(interval);
      removeResumeListener();
    };
  }, []);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    let boundaryTimer: number | undefined;
    const refreshMarketHours = async () => {
      try {
        const response = await fetch("/api/market-hours", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not load market hours.");
        const schedule = result.schedule as MarketHoursSchedule;
        if (!Array.isArray(schedule?.openDays) || !schedule.openDays.length ||
          schedule.openDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
          typeof schedule.openTime !== "string" || typeof schedule.closeTime !== "string" ||
          typeof schedule.manuallyClosed !== "boolean" ||
          typeof result.isOpen !== "boolean" ||
          !(result.currentHours === null || typeof result.currentHours === "string") ||
          !(result.nextOpenAt === null || typeof result.nextOpenAt === "string") ||
          !(result.nextTransitionAt === null || typeof result.nextTransitionAt === "string")) {
          throw new Error("Market hours settings are invalid.");
        }
        if (!active) return;
        if (boundaryTimer !== undefined) window.clearTimeout(boundaryTimer);
        if (result.nextTransitionAt) {
          const delay = Date.parse(result.nextTransitionAt) - Date.now() + 250;
          if (Number.isFinite(delay) && delay > 0) {
            boundaryTimer = window.setTimeout(() => void refreshMarketHours(), delay);
          }
        }
        setMarketHours(schedule);
        if (!marketHoursDraftDirty.current) setMarketHoursDraft(schedule);
        setMarketIsOpen(result.isOpen);
        setCurrentMarketHours(result.currentHours);
        setNextMarketOpenAt(result.nextOpenAt);
        setMarketHoursError("");
        setMarketHoursLoaded(true);
      } catch (error) {
        if (!active) return;
        if (boundaryTimer !== undefined) window.clearTimeout(boundaryTimer);
        setMarketIsOpen(false);
        setCurrentMarketHours(null);
        setNextMarketOpenAt(null);
        setMarketHoursError(error instanceof Error ? error.message : "Could not verify market hours.");
        setMarketHoursLoaded(true);
      }
    };
    void refreshMarketHours();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshMarketHours();
    }, 15_000);
    const removeResumeListener = onBrowserResume(refreshMarketHours);
    return () => {
      active = false;
      window.clearInterval(interval);
      if (boundaryTimer !== undefined) window.clearTimeout(boundaryTimer);
      removeResumeListener();
    };
  }, []);
  const chooseLanguage = (nextLanguage: Language) => {
    if (!swahiliEnabled && nextLanguage === "sw") return;
    setLanguage(nextLanguage);
    try {
      localStorage.setItem("madinimarket:language:v1", nextLanguage);
    } catch {
      setNotice("This browser could not save your language preference.");
    }
  };
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".market-shell");
    if (!root) return;
    const apply = () => applyVisibleTranslations(root, language, translationPairs);
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["placeholder"] });
    return () => observer.disconnect();
  }, [language, translationPairs, role]);
  useEffect(() => {
    if (isSupabaseConfigured) {
      let active = true;
      const supabase = getSupabaseBrowserClient();
      const hydrate = async (session: Session | null) => {
        try {
          let isAdmin = false;
          let hasWebsiteAccount = false;
          if (session) {
            const { data: profile, error: profileError } = await supabase
              .from("profiles")
              .select("id, username, role")
              .eq("id", session.user.id)
              .maybeSingle();
            if (profileError) throw profileError;
            isAdmin = profile?.role === "admin";
            if (isAdmin && active) {
              setUser(profile?.username ?? "");
              setDisplayName(profile?.username ?? "");
              setUserId(session.user.id);
              setRole("admin");
            }
            if (!isAdmin) await supabase.auth.signOut({ scope: "local" });
          }
          if (!isAdmin) {
            const response = await fetchWithWebsiteSession("/api/auth/website-session", { cache: "no-store" });
            const result = response.ok ? await response.json() : null;
            hasWebsiteAccount = Boolean(result?.account);
            if (!result?.account) clearWebsiteSessionToken();
            if (active) {
              setUser(result?.account?.username ?? "");
              setDisplayName(result?.account?.display_name ?? "");
              setUserId(result?.account?.id ?? "");
              setRole(result?.account ? "user" : null);
              if (!result?.account) setCertificates({});
            }
            if (result?.account) {
              const certificateResponse = await fetchWithWebsiteSession("/api/website-certificates", { cache: "no-store" });
              if (certificateResponse.ok) {
                const certificateResult = await certificateResponse.json();
                const nextCertificates: Partial<Record<CertificateKind, CertificateSubmission>> = {};
                for (const certificate of certificateResult.certificates as CertificateSubmission[]) nextCertificates[certificate.kind] = certificate;
                if (active) setCertificates(nextCertificates);
              }
            }
          }
          try {
            const listings = await loadMarketplaceListings(hasWebsiteAccount, isAdmin ? session?.access_token : undefined);
            if (active) {
              setSellers(listings.sellers);
              setBuyers(listings.buyers);
              setLastUpdated(new Date());
              setStorageReady(true);
            }
          } catch {
            if (active) {
              setNotice("Could not load marketplace data from Supabase.");
              setStorageReady(true);
            }
          }
          if (active && isAdmin && session) {
            const adminLoadLabels = ["accounts", "licences", "translations", "site settings", "subscriptions"];
            void Promise.allSettled([
              loadAdminAccounts(session.access_token).then(setWebsiteAccounts),
              loadAdminCertificates(session.access_token).then(setAdminCertificates),
              loadAdminTranslations(session.access_token).then(setTranslationPairs),
              loadAdminSiteContent(session.access_token).then((siteContent) => {
                setSwahiliEnabled(siteContent.swahiliEnabled);
                setAccountCreationDisabled(siteContent.accountCreationDisabled);
                setNonAdminSignInDisabled(siteContent.nonAdminSignInDisabled);
                setHomepageAnnouncement(siteContent.homepageAnnouncement);
                if (!homepageAnnouncementDirty.current) setHomepageAnnouncementDraft(siteContent.homepageAnnouncement);
                setHomepageHeadlineFontSize(siteContent.headlineFontSize);
                setHomepageHeadlineFontSizeInput(String(siteContent.headlineFontSize));
                setSiteContentLoaded(true);
                setHomepageHeadlines(siteContent.headlines);
              }),
              loadAdminSubscriptions(session.access_token).then((subscriptions) => {
                setSubscriptionPlans(subscriptions.plans);
                setPendingSubscriptions(subscriptions.pendingSubscriptions);
              }),
            ]).then((results) => {
              const failures = results.map((result, index) => result.status === "rejected" ? { label: adminLoadLabels[index], result } : null).filter((item): item is { label: string; result: PromiseRejectedResult } => item !== null);
              if (failures.length && active) {
                const first = failures[0];
                const detail = first.result.reason instanceof Error ? first.result.reason.message : "";
                setNotice(detail ? `${detail} (${first.label})` : `Could not load admin ${first.label}. Refresh or retry this panel.`);
              }
            });
          }
        } catch {
          if (active) {
            setNotice("Could not load marketplace data from Supabase.");
            setStorageReady(true);
          }
        }
      };
      void supabase.auth.getSession().then(({ data }) => hydrate(data.session));
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        window.setTimeout(() => void hydrate(session), 0);
      });
      const interval = window.setInterval(() => {
        if (document.visibilityState !== "visible") return;
        void supabase.auth.getSession().then(({ data }) => hydrate(data.session));
      }, 60_000);
      const refreshSession = async () => {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        await hydrate(data.session);
      };
      const removeResumeListener = onBrowserResume(() => refreshSession().catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : "Could not refresh the current session.");
      }));
      return () => {
        active = false;
        subscription.unsubscribe();
        window.clearInterval(interval);
        removeResumeListener();
      };
    }

    const hydrationTimer = window.setTimeout(() => {
      setSellers(readStoredArray<Seller>(SELLERS_STORAGE_KEY));
      setBuyers(readStoredArray<Buyer>(BUYERS_STORAGE_KEY));
      try {
        const storedUser = localStorage.getItem(USER_STORAGE_KEY) ?? "";
        setUser(storedUser);
        setDisplayName(storedUser);
        setUserId(storedUser);
        setRole(storedUser ? "user" : null);
      } catch {
        setUser("");
      }
      setStorageReady(true);
    }, 0);
    return () => window.clearTimeout(hydrationTimer);
  }, []);
  useEffect(() => {
    if (!isSupabaseConfigured || role !== "admin" || activeAdminPanel !== "ledger") return;
    let active = true;
    let isLoading = false;
    const refreshSalesLedger = async () => {
      if (isLoading || document.visibilityState !== "visible") return;
      isLoading = true;
      try {
        const { data: { session }, error } = await getSupabaseBrowserClient().auth.getSession();
        if (error) throw error;
        if (!session) throw new Error("Your admin session has expired. Sign in again to view the sales ledger.");
        const salesLedger = await loadAdminSalesLedger(session.access_token);
        if (active) {
          setAdminSalesLedger(salesLedger);
          setAdminSalesLedgerError("");
        }
      } catch (error) {
        if (active) setAdminSalesLedgerError(error instanceof Error ? error.message : "Could not refresh the sales ledger.");
      } finally {
        isLoading = false;
      }
    };
    void refreshSalesLedger();
    const interval = window.setInterval(() => void refreshSalesLedger(), 60_000);
    let realtimeRefreshTimer: number | undefined;
    const scheduleRefresh = () => {
      if (document.visibilityState !== "visible" || realtimeRefreshTimer !== undefined) return;
      realtimeRefreshTimer = window.setTimeout(() => {
        realtimeRefreshTimer = undefined;
        void refreshSalesLedger();
      }, 250);
    };
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel("marketplace-sales-ledger-updates")
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "marketplace_orders",
        filter: "payment_status=eq.paid",
      }, scheduleRefresh)
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(`Sales ledger Realtime subscription status: ${status}. Polling remains enabled.`);
        }
      });
    const removeResumeListener = onBrowserResume(refreshSalesLedger);
    return () => {
      active = false;
      window.clearInterval(interval);
      if (realtimeRefreshTimer !== undefined) window.clearTimeout(realtimeRefreshTimer);
      void supabase.removeChannel(channel);
      removeResumeListener();
    };
  }, [role, activeAdminPanel]);
  useEffect(() => {
    if (!storageReady || isSupabaseConfigured) return;
    try {
      localStorage.setItem(SELLERS_STORAGE_KEY, JSON.stringify(sellers));
      localStorage.setItem(BUYERS_STORAGE_KEY, JSON.stringify(buyers));
      if (user) localStorage.setItem(USER_STORAGE_KEY, user);
      else localStorage.removeItem(USER_STORAGE_KEY);
    } catch {
      window.setTimeout(() => setNotice("This browser could not save your marketplace changes."), 0);
    }
  }, [storageReady, sellers, buyers, user]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const resetUserAccountList = () => {
    setUserAccountListSearch("");
    setUserAccountListFilter("all");
    setUserAccountListPage(1);
    accountListScroll.current = { submissions: 0, market: 0, wanted: 0 };
  };
  const openDialog = (next: Exclude<Dialog, null>) => {
    setMenuOpen(false);
    if (next === "submissions") resetUserAccountList();
    setDialog(next);
  };
  const setOwnedWantedMinerals = (requests: AccountWantedRequest[]) => {
    setMyWantedMinerals(requests.map((item) => ({
      id: Number(item.id), mineral: item.mineral_name, weight: String(item.weight), unit: item.unit,
      color: item.color, shape: item.shape, quality: item.quality, offer: String(item.offer),
      currency: item.currency, location: item.location, marketplace_status: item.marketplace_status ?? "available",
    })));
  };
  const openAccountMarket = async (next: "my-market-minerals" | "my-wanted-minerals") => {
    setMenuOpen(false);
    resetUserAccountList();
    await withProgress(`load-${next}`, async () => {
      try {
        if (isSupabaseConfigured && role === "user") {
          const response = await fetchWithWebsiteSession("/api/website-submissions", { cache: "no-store" });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? "Could not load your approved market items.");
          setMyMarketMinerals((result.marketSellers ?? []).map((item: {
            id: number; mineral_name: string; listing_type?: ListingType; weight: string | number; unit: Unit;
            smallest_stone_weight?: string | number | null; largest_stone_weight?: string | number | null; stone_weight_unit?: StoneWeightUnit | null; price: string | number;
            seller_price?: string | number | null; platform_fee_rate?: number | null; platform_fee_amount?: string | number | null;
            currency: Currency; country: string; region: string; district: string; signed_image_url: string;
          }) => ({
            id: Number(item.id), mineral: item.mineral_name, listing_type: item.listing_type,
            weight: String(item.weight), unit: item.unit,
            smallest_stone_weight: item.smallest_stone_weight == null ? undefined : String(item.smallest_stone_weight),
            largest_stone_weight: item.largest_stone_weight == null ? undefined : String(item.largest_stone_weight),
            stone_weight_unit: item.stone_weight_unit ?? undefined,
            seller_price: item.seller_price == null ? undefined : String(item.seller_price),
            platform_fee_rate: item.platform_fee_rate == null ? undefined : Number(item.platform_fee_rate),
            platform_fee_amount: item.platform_fee_amount == null ? undefined : String(item.platform_fee_amount),
            price: String(item.price), currency: item.currency,
            location: [item.district, item.region, item.country].filter(Boolean).join(", "),
            image: item.signed_image_url,
          })));
          setOwnedWantedMinerals(result.marketBuyers ?? []);
        } else {
          setMyMarketMinerals(sellers.filter((item) => item.user_id === userId && item.status === "approved").map((item) => ({
            id: item.id, mineral: item.mineral, listing_type: item.listing_type, weight: item.weight, unit: item.unit,
            smallest_stone_weight: item.smallest_stone_weight, largest_stone_weight: item.largest_stone_weight,
            stone_weight_unit: item.stone_weight_unit, seller_price: item.seller_price,
            platform_fee_rate: item.platform_fee_rate, platform_fee_amount: item.platform_fee_amount, price: item.price,
            currency: item.currency, location: item.location, image: item.image,
          })));
          setMyWantedMinerals(buyers.filter((item) => item.user_id === userId && item.status === "approved").map((item) => ({
            id: item.id, mineral: item.mineral, weight: item.weight, unit: item.unit, color: item.color,
            shape: item.shape, quality: item.quality, offer: item.offer, currency: item.currency, location: item.location,
            marketplace_status: "available" as const,
          })));
        }
        openDialog(next);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not load your approved market items.");
      }
    });
  };
  const refreshCertificates = async () => {
    const response = await fetchWithWebsiteSession("/api/website-certificates", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not load your licences.");
    const nextCertificates: Partial<Record<CertificateKind, CertificateSubmission>> = {};
    for (const certificate of result.certificates as CertificateSubmission[]) nextCertificates[certificate.kind] = certificate;
    setCertificates(nextCertificates);
  };
  const openAccountLicences = async () => {
    setMenuOpen(false);
    try {
      if (isSupabaseConfigured && role === "user") await refreshCertificates();
      openDialog("my-licenses");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load your licences.");
    }
  };
  const hasApprovedCertificate = Boolean(certificates.dealer?.status === "approved" || certificates.broker?.status === "approved");
  const openListing = async (type: "sell" | "buy") => {
    await withProgress(`open-${type}`, async () => {
    if (!user) { setNotice("Sign in first to post."); openDialog("signin"); return; }
    if (type === "sell" && role === "user" && !hasApprovedCertificate) {
      setNotice("An approved dealer or broker licence is required before listing a mineral.");
      await openAccountLicences();
      return;
    }
    if (isSupabaseConfigured && role === "user") await refreshWebsiteDrafts().catch(() => {});
    setSellerImagePreview(null);
    setEditingSubmission(null);
    setSellerListingType("single");
    openDialog(type);
    });
  };
  const scrollRail = (rail: HTMLDivElement | null, direction: number) => rail?.scrollBy({ left: direction * 360, behavior: "smooth" });
  const visibleSellers = sellers.filter((item) => item.status === "approved" && `${item.mineral} ${item.location}`.toLowerCase().includes(query.toLowerCase()));
  const visibleBuyers = buyers.filter((item) => item.status === "approved" && `${item.mineral} ${item.location}`.toLowerCase().includes(query.toLowerCase()));
  const refreshRemoteListings = async (includeOwnSubmissions = role === "user") => {
    let adminAccessToken: string | undefined;
    if (role === "admin") {
      const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
      adminAccessToken = session?.access_token;
    }
    const listings = await loadMarketplaceListings(includeOwnSubmissions, adminAccessToken);
    setSellers(listings.sellers);
    setBuyers(listings.buyers);
    setLastUpdated(new Date());
    return listings;
  };
  const refreshOwnedWantedMinerals = useEffectEvent(async () => {
    if (role !== "user" || dialog !== "my-wanted-minerals") return;
    const response = await fetchWithWebsiteSession("/api/website-submissions", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not refresh your approved buying requests.");
    setOwnedWantedMinerals(result.marketBuyers ?? []);
  });
  const refreshListingsFromRealtime = useEffectEvent(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      await refreshRemoteListings(role === "user");
      await refreshOwnedWantedMinerals();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not refresh marketplace data.");
    }
  });
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabaseBrowserClient();
    let refreshTimer: number | undefined;
    const scheduleRefresh = () => {
      if (document.visibilityState !== "visible" || refreshTimer !== undefined) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        refreshListingsFromRealtime();
      }, 250);
    };
    const channel = supabase
      .channel("marketplace-live-updates")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "listings" }, scheduleRefresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "listings" }, scheduleRefresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "buy_requests" }, scheduleRefresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "buy_requests" }, scheduleRefresh)
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(`Supabase Realtime subscription status: ${status}. Polling remains enabled.`);
        }
      });
    return () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, []);
  const refreshWebsiteDrafts = async () => {
    const response = await fetchWithWebsiteSession("/api/website-drafts", { cache: "no-store" });
    if (!response.ok) return;
    const result = await response.json();
    const next = { seller: null, buyer: null } as { seller: WebsiteDraft | null; buyer: WebsiteDraft | null };
    for (const draft of result.drafts as WebsiteDraft[]) next[draft.kind] = draft;
    setWebsiteDrafts((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
  };
  const persistWebsiteDraft = async (kind: "seller" | "buyer", formElement: HTMLFormElement, saveImage: boolean, keepalive = false) => {
    if (!isSupabaseConfigured || role !== "user" || !userId) return;
    const form = new FormData(formElement);
    const payload: Record<string, string | number> = {};
    for (const [key, value] of form.entries()) if (typeof value === "string") payload[key] = value;
    if (editingSubmission?.kind === kind) payload.submissionId = editingSubmission.item.id;
    const imageFile = form.get("image");
    let imageData: string | undefined;
    if (kind === "seller" && saveImage && imageFile instanceof File && imageFile.size) {
      try {
        imageData = await storeMineralPhoto(imageFile);
      } catch {
        setNotice("The photo could not be saved as a draft. Please try another PNG or JPG.");
        return;
      }
    }
    try {
      const response = await fetchWithWebsiteSession("/api/website-drafts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, payload, imageData }),
        keepalive,
      });
      const result = await response.json();
      if (!response.ok) { setNotice(result.error ?? "Your draft could not be saved."); return; }
      setWebsiteDrafts((current) => ({ ...current, [kind]: result.draft as WebsiteDraft }));
    } catch {
      setNotice("Your draft could not be synchronized. Keep this page open and try again.");
    }
  };
  const queueWebsiteDraftSave = (kind: "seller" | "buyer", formElement: HTMLFormElement, saveImage = false) => {
    if (!isSupabaseConfigured || role !== "user") return;
    const previousTimer = draftSaveTimers.current[kind];
    if (previousTimer !== null) window.clearTimeout(previousTimer);
    if (saveImage) {
      draftSaveTimers.current[kind] = null;
      void persistWebsiteDraft(kind, formElement, true);
      return;
    }
    draftSaveTimers.current[kind] = window.setTimeout(() => {
      draftSaveTimers.current[kind] = null;
      void persistWebsiteDraft(kind, formElement, false);
    }, 350);
  };
  const queueWebsiteDraftSaveEvent = useEffectEvent(queueWebsiteDraftSave);
  const persistWebsiteDraftEvent = useEffectEvent(persistWebsiteDraft);
  useEffect(() => {
    const saveFormChange = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
      const form = target.closest<HTMLFormElement>("form.form-scroll");
      if (!form) return;
      const kind = form.elements.namedItem("seller") ? "seller" : form.elements.namedItem("buyer") ? "buyer" : null;
      if (!kind) return;
      const saveImage = event.type === "change" && target instanceof HTMLInputElement && target.type === "file" && target.name === "image";
      if (saveImage && target instanceof HTMLInputElement) {
        const file = target.files?.[0];
        setSellerImagePreview(file ? URL.createObjectURL(file) : null);
      }
      queueWebsiteDraftSaveEvent(kind, form, saveImage);
    };
    const flushOpenDraft = () => {
      const form = document.querySelector<HTMLFormElement>(".dialog-panel form.form-scroll");
      if (!form) return;
      const kind = form.elements.namedItem("seller") ? "seller" : form.elements.namedItem("buyer") ? "buyer" : null;
      if (kind) void persistWebsiteDraftEvent(kind, form, false, true);
    };
    document.addEventListener("input", saveFormChange);
    document.addEventListener("change", saveFormChange);
    window.addEventListener("pagehide", flushOpenDraft);
    return () => {
      document.removeEventListener("input", saveFormChange);
      document.removeEventListener("change", saveFormChange);
      window.removeEventListener("pagehide", flushOpenDraft);
    };
  }, [role, userId]);
  useEffect(() => {
    if (dialog !== "sell" && dialog !== "buy") {
      draftRestoreDialog.current = null;
      return;
    }
    if (draftRestoreDialog.current === dialog) return;
    draftRestoreDialog.current = dialog;
    if (editingSubmission) return;
    const kind = dialog === "sell" ? "seller" : "buyer";
    const draft = websiteDrafts[kind];
    if (!draft) return;
    const form = document.querySelector<HTMLFormElement>(".dialog-panel form.form-scroll");
    if (!form) return;
    for (const [name, value] of Object.entries(draft.payload)) {
      if (name === "submissionId") continue;
      const field = form.elements.namedItem(name);
      if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = String(value);
      if (kind === "seller" && name === "listing_type" && (value === "single" || value === "batch") && field instanceof HTMLSelectElement) {
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    if (kind === "seller" && draft.image_path) {
      const imageInput = form.elements.namedItem("image");
      if (imageInput instanceof HTMLInputElement) imageInput.required = false;
      const imageLabel = form.querySelector<HTMLElement>(".file-drop > span");
      if (imageLabel) imageLabel.textContent = "Saved draft photo will be used";
    }
  }, [dialog, editingSubmission, websiteDrafts]);
      useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    let syncing = false;

    const synchronize = async () => {
      if (!active || syncing || document.visibilityState !== "visible") return;
      syncing = true;

      try {
        let adminAccessToken: string | undefined;
        if (role === "admin") {
          const { data: { session }, error } = await getSupabaseBrowserClient().auth.getSession();
          if (error) throw error;
          adminAccessToken = session?.access_token;
        }
        const listings = await loadMarketplaceListings(role === "user", adminAccessToken);

        if (active && role === "user") {
          setSellers(listings.sellers);
          setBuyers(listings.buyers);
          setLastUpdated(new Date());
        } else if (active) {
          setSellers((previous) => {
            const retained = previous.filter(
              (item) => item.status === "pending" || item.status === "rejected"
            );
            const pendingFromFresh = listings.sellers.filter(
              (item) => item.status === "pending"
            );
            const approvedFromFresh = listings.sellers.filter(
              (item) => item.status === "approved"
            );

            const merged = [...retained, ...pendingFromFresh, ...approvedFromFresh];
            const seen = new Set<number>();

            return merged.filter((item) => {
              if (seen.has(item.id)) return false;
              seen.add(item.id);
              return true;
            });
          });

          setBuyers((previous) => {
            const retained = previous.filter(
              (item) => item.status === "pending" || item.status === "rejected"
            );
            const pendingFromFresh = listings.buyers.filter(
              (item) => item.status === "pending"
            );
            const approvedFromFresh = listings.buyers.filter(
              (item) => item.status === "approved"
            );

            const merged = [...retained, ...pendingFromFresh, ...approvedFromFresh];
            const seen = new Set<number>();

            return merged.filter((item) => {
              if (seen.has(item.id)) return false;
              seen.add(item.id);
              return true;
            });
          });

          setLastUpdated(new Date());
        }
      } catch {
        // Keep the last successful Supabase snapshot when a poll fails.
      }
      if (active && role === "user") {
        await Promise.all([refreshWebsiteDrafts(), refreshCertificates()]).catch(() => {});
      }
      syncing = false;
    };

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void synchronize();
    }, 5000);
    const removeResumeListener = onBrowserResume(synchronize);
    return () => {
      active = false;
      window.clearInterval(interval);
      removeResumeListener();
    };
  }, [role, userId]);
  const updateReviewMessage = (key: string, message: string) => {
    setRejectionMessages((current) => ({ ...current, [key]: message }));
  };
  const reviewSubmission = async (kind: "seller" | "buyer", id: number, approved: boolean) => {
    if (role !== "admin" || !isSupabaseConfigured) return;
    const key = `${kind}-${id}`;
    const message = rejectionMessages[key]?.trim() ?? "";
    if (!approved && !message) { setNotice("Add a rejection message before rejecting this submission."); return; }
    const supabase = getSupabaseBrowserClient();
    const { error } = kind === "seller"
      ? await supabase.rpc("review_listing", { p_id: id, p_approved: approved, p_message: message || null })
      : await supabase.rpc("review_buy_request", { p_id: id, p_approved: approved, p_message: message || null });
    if (error) { setNotice(error.message); return; }
    void refreshRemoteListings().catch(() => setNotice("Review saved, but the queue could not be refreshed."));
    updateReviewMessage(key, "");
    setNotice(approved ? "Submission approved and published." : "Submission rejected and returned to its owner.");
  };
  const refreshAdminAccounts = async () => {
    const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
    if (!session) throw new Error("Admin session expired.");
    const accounts = await loadAdminAccounts(session.access_token);
    accountListScrollTop.current = accountListRef.current?.scrollTop ?? 0;
    setWebsiteAccounts(accounts);
  };
  const updateListingFee = async () => {
    const feePercent = Number(listingFeePercentInput);
    if (!listingFeePercentInput.trim() || !Number.isFinite(feePercent) || feePercent < 0 || feePercent > 100 ||
      Math.abs(feePercent * 100 - Math.round(feePercent * 100)) > 1e-8) {
      setNotice("Enter a fee from 0% to 100%, with up to two decimal places.");
      return;
    }
    await withProgress("listing-fee-setting", async () => {
      try {
        const { data: { session }, error } = await getSupabaseBrowserClient().auth.getSession();
        if (error) throw error;
        if (!session) throw new Error("Admin session expired.");
        const response = await fetch("/api/listing-fee-settings", {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ feePercent }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not update the mineral listing fee.");
        if (typeof result.feePercent !== "number" || !Number.isFinite(result.feePercent)) {
          throw new Error("Mineral listing fee settings are invalid.");
        }
        setListingFeePercent(result.feePercent);
        setListingFeePercentInput(formatFeePercent(result.feePercent));
        setListingFeeUpdatedAt(typeof result.updatedAt === "string" ? result.updatedAt : null);
        setListingFeeSettingsLoaded(true);
        listingFeeDraftDirty.current = false;
        setNotice(`The ${formatFeePercent(result.feePercent)}% listing fee now applies to new listings. Existing listings keep their saved fee.`);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not update the mineral listing fee.");
      }
    });
  };
  const cancelListingFeeEdit = () => {
    setListingFeePercentInput(formatFeePercent(listingFeePercent));
    listingFeeDraftDirty.current = false;
  };
  const cancelMarketHoursEdit = () => {
    setMarketHoursDraft(marketHours);
    marketHoursDraftDirty.current = false;
  };
  const updateMarketHoursDraftTime = (field: "openTime" | "closeTime", time: string) => {
    setMarketHoursDraft((current) => {
      const next = { ...current, [field]: time };
      marketHoursDraftDirty.current = next.openTime !== marketHours.openTime ||
        next.closeTime !== marketHours.closeTime ||
        next.openDays.length !== marketHours.openDays.length ||
        next.openDays.some((day) => !marketHours.openDays.includes(day));
      return next;
    });
  };
  const updateMarketHours = async () => {
    if (!marketHoursDraft.openDays.length) {
      setNotice("Select at least one day when the market is open.");
      return;
    }
    await withProgress("market-hours-setting", async () => {
      try {
        const { data: { session }, error } = await getSupabaseBrowserClient().auth.getSession();
        if (error) throw error;
        if (!session) throw new Error("Admin session expired.");
        const response = await fetch("/api/market-hours", {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            openDays: marketHoursDraft.openDays,
            openTime: marketHoursDraft.openTime,
            closeTime: marketHoursDraft.closeTime,
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not update market hours.");
        const savedSchedule = result.schedule as MarketHoursSchedule;
        if (!Array.isArray(savedSchedule?.openDays) || !savedSchedule.openDays.length ||
          typeof savedSchedule.openTime !== "string" || typeof savedSchedule.closeTime !== "string" ||
          typeof savedSchedule.manuallyClosed !== "boolean" ||
          typeof result.isOpen !== "boolean" ||
          !(result.currentHours === null || typeof result.currentHours === "string") ||
          !(result.nextOpenAt === null || typeof result.nextOpenAt === "string")) {
          throw new Error("The saved market hours response is invalid.");
        }
        setMarketHours(savedSchedule);
        setMarketHoursDraft(savedSchedule);
        setMarketHoursLoaded(true);
        setMarketIsOpen(result.isOpen);
        setCurrentMarketHours(result.currentHours);
        setNextMarketOpenAt(result.nextOpenAt);
        setMarketHoursError("");
        marketHoursDraftDirty.current = false;
        setNotice("Weekly market hours updated.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not update market hours.");
      }
    });
  };
  const updateManualMarketClosure = async (manuallyClosed: boolean) => {
    if (manuallyClosed && !window.confirm("Close the market now? It will remain closed regardless of the saved weekly schedule.")) return;
    await withProgress("market-hours-setting", async () => {
      try {
        const { data: { session }, error } = await getSupabaseBrowserClient().auth.getSession();
        if (error) throw error;
        if (!session) throw new Error("Admin session expired.");
        const response = await fetch("/api/market-hours", {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ manuallyClosed }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not update the manual market closure.");
        const savedSchedule = result.schedule as MarketHoursSchedule;
        if (!savedSchedule || typeof savedSchedule.manuallyClosed !== "boolean" || typeof result.isOpen !== "boolean") {
          throw new Error("The manual market closure response is invalid.");
        }
        setMarketHours(savedSchedule);
        setMarketHoursDraft(savedSchedule);
        setMarketIsOpen(result.isOpen);
        setCurrentMarketHours(result.currentHours);
        setNextMarketOpenAt(result.nextOpenAt);
        setMarketHoursLoaded(true);
        setMarketHoursError("");
        marketHoursDraftDirty.current = false;
        setNotice(manuallyClosed ? "Market closed manually." : "Manual closure removed; the saved schedule is active again.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not update the manual market closure.");
      }
    });
  };
  const updateUsdAvailability = async (enabled: boolean) => {
    await withProgress("currency-setting", async () => {
      try {
        const { data: { session }, error } = await getSupabaseBrowserClient().auth.getSession();
        if (error) throw error;
        if (!session) throw new Error("Admin session expired.");
        const response = await fetch("/api/currency-settings", {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ usdEnabled: enabled }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not update marketplace currency settings.");
        if (typeof result.usdEnabled !== "boolean") throw new Error("Marketplace currency settings are invalid.");
        setUsdEnabled(result.usdEnabled);
        setNotice(result.usdEnabled ? "USD currency is enabled for sellers and buyers." : "USD currency is disabled. TSh is the only available currency.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not update marketplace currency settings.");
      }
    });
  };
  const refreshAdminCertificates = async () => {
    const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
    if (!session) throw new Error("Admin session expired.");
    setAdminCertificates(await loadAdminCertificates(session.access_token));
  };
  const refreshAdminTranslations = async () => {
    const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
    if (!session) throw new Error("Admin session expired.");
    setTranslationPairs(await loadAdminTranslations(session.access_token));
  };
  const refreshAdminSiteContent = async () => {
    const { data: { session }, error } = await getSupabaseBrowserClient().auth.getSession();
    if (error) throw error;
    if (!session) throw new Error("Admin session expired.");
    const content = await loadAdminSiteContent(session.access_token);
    setSwahiliEnabled(content.swahiliEnabled);
    setAccountCreationDisabled(content.accountCreationDisabled);
    setNonAdminSignInDisabled(content.nonAdminSignInDisabled);
    setHomepageAnnouncement(content.homepageAnnouncement);
    if (!homepageAnnouncementDirty.current) setHomepageAnnouncementDraft(content.homepageAnnouncement);
    setHomepageHeadlineFontSize(content.headlineFontSize);
    setHomepageHeadlineFontSizeInput(String(content.headlineFontSize));
    setSiteContentLoaded(true);
    setHomepageHeadlines(content.headlines);
  };
  const saveHomepageHeadlineFontSize = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fontSize = Number(homepageHeadlineFontSizeInput);
    if (!Number.isInteger(fontSize) || fontSize < 24 || fontSize > 72) {
      setNotice("Choose a headline font size between 24 and 72 pixels.");
      return;
    }
    await withProgress("homepage-headline-font-size", async () => {
      try {
        const { data: { session }, error } = await getSupabaseBrowserClient().auth.getSession();
        if (error) throw error;
        if (!session) throw new Error("Admin session expired.");
        const response = await fetch("/api/admin/site-content", {
          method: "PATCH",
          headers: { Authorization: ["Bearer", session.access_token].join(" "), "Content-Type": "application/json" },
          body: JSON.stringify({ headlineFontSize: fontSize }),
        });
        const result = await response.json();
        if (!response.ok || !Number.isInteger(result.headlineFontSize) || result.headlineFontSize < 24 || result.headlineFontSize > 72) {
          throw new Error(result.error ?? "Could not save the headline font size.");
        }
        setHomepageHeadlineFontSize(result.headlineFontSize);
        setHomepageHeadlineFontSizeInput(String(result.headlineFontSize));
        setNotice("Homepage headline font size saved.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not save the headline font size.");
      }
    });
  };
  const updateSwahiliAvailability = async (enabled: boolean) => {
    await withProgress("swahili-setting", async () => {
      try {
        const { data: { session }, error } = await getSupabaseBrowserClient().auth.getSession();
        if (error) throw error;
        if (!session) throw new Error("Admin session expired.");
        const response = await fetch("/api/admin/site-content", {
          method: "PATCH",
          headers: { Authorization: ["Bearer", session.access_token].join(" "), "Content-Type": "application/json" },
          body: JSON.stringify({ swahiliEnabled: enabled }),
        });
        const result = await response.json();
        if (!response.ok || typeof result.swahiliEnabled !== "boolean") {
          throw new Error(result.error ?? "Could not update the language setting.");
        }
        setSwahiliEnabled(result.swahiliEnabled);
        setSiteContentLoaded(true);
        if (!result.swahiliEnabled) {
          setLanguage("en");
          try {
            localStorage.setItem("madinimarket:language:v1", "en");
          } catch {
            setNotice("Language access was updated, but this browser could not save its English preference.");
            return;
          }
        }
        setNotice(result.swahiliEnabled ? "Swahili language switching is available to visitors." : "Swahili language switching is hidden from visitors.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not update the language setting.");
      }
    });
  };
  const updateAccountCreationAvailability = async (disabled: boolean) => {
    await withProgress("account-creation-setting", async () => {
      try {
        const { data: { session }, error } = await getSupabaseBrowserClient().auth.getSession();
        if (error) throw error;
        if (!session) throw new Error("Admin session expired.");
        const response = await fetch("/api/admin/site-content", {
          method: "PATCH",
          headers: { Authorization: ["Bearer", session.access_token].join(" "), "Content-Type": "application/json" },
          body: JSON.stringify({ accountCreationDisabled: disabled }),
        });
        const result = await response.json();
        if (!response.ok || typeof result.accountCreationDisabled !== "boolean") throw new Error(result.error ?? "Could not update account creation access.");
        setAccountCreationDisabled(result.accountCreationDisabled);
        setNotice(result.accountCreationDisabled ? "Account creation is now suspended." : "Account creation is enabled again.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not update account creation access.");
      }
    });
  };
  const updateNonAdminSignInAvailability = async (disabled: boolean) => {
    await withProgress("non-admin-signin-setting", async () => {
      try {
        const { data: { session }, error } = await getSupabaseBrowserClient().auth.getSession();
        if (error) throw error;
        if (!session) throw new Error("Admin session expired.");
        const response = await fetch("/api/admin/site-content", {
          method: "PATCH",
          headers: { Authorization: ["Bearer", session.access_token].join(" "), "Content-Type": "application/json" },
          body: JSON.stringify({ nonAdminSignInDisabled: disabled }),
        });
        const result = await response.json();
        if (!response.ok || typeof result.nonAdminSignInDisabled !== "boolean") throw new Error(result.error ?? "Could not update sign-in access.");
        setNonAdminSignInDisabled(result.nonAdminSignInDisabled);
        setNotice(result.nonAdminSignInDisabled ? "Non-administrator sign-in is now suspended." : "Sign-in access is enabled again.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not update sign-in access.");
      }
    });
  };
  const signOutAllUsers = async () => {
    if (!window.confirm("Sign out all currently signed-in users? Administrator accounts will remain signed in.")) return;
    await withProgress("sign-out-all-users", async () => {
      try {
        setSignOutAllUsersAction(true);
        const { data: { session }, error } = await getSupabaseBrowserClient().auth.getSession();
        if (error) throw error;
        if (!session) throw new Error("Admin session expired.");
        const response = await fetch("/api/admin/site-content", {
          method: "PATCH",
          headers: { Authorization: ["Bearer", session.access_token].join(" "), "Content-Type": "application/json" },
          body: JSON.stringify({ signOutAllUsers: true }),
        });
        const result = await response.json();
        if (!response.ok || !Number.isInteger(result.signedOutUsers)) throw new Error(result.error ?? "Could not sign out all users.");
        setNotice(`All ${result.signedOutUsers} signed-in user sessions have been ended.`);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not sign out all users.");
      } finally {
        window.setTimeout(() => setSignOutAllUsersAction(false), 500);
      }
    });
  };
  const saveHomepageAnnouncement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await withProgress("homepage-announcement-save", async () => {
      try {
        const { data: { session }, error } = await getSupabaseBrowserClient().auth.getSession();
        if (error) throw error;
        if (!session) throw new Error("Admin session expired.");
        const response = await fetch("/api/admin/site-content", {
          method: "PATCH",
          headers: { Authorization: ["Bearer", session.access_token].join(" "), "Content-Type": "application/json" },
          body: JSON.stringify({ homepageAnnouncement: homepageAnnouncementDraft }),
        });
        const result = await response.json();
        if (!response.ok || typeof result.homepageAnnouncement !== "string") throw new Error(result.error ?? "Could not save the homepage message.");
        setHomepageAnnouncement(result.homepageAnnouncement);
        setHomepageAnnouncementDraft(result.homepageAnnouncement);
        homepageAnnouncementDirty.current = false;
        setNotice(result.homepageAnnouncement ? "Homepage announcement saved." : "Homepage announcement cleared.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not save the homepage message.");
      }
    });
  };
  const clearHomepageAnnouncement = async () => {
    await withProgress("homepage-announcement-save", async () => {
      try {
        const { data: { session }, error } = await getSupabaseBrowserClient().auth.getSession();
        if (error) throw error;
        if (!session) throw new Error("Admin session expired.");
        const response = await fetch("/api/admin/site-content", {
          method: "PATCH",
          headers: { Authorization: ["Bearer", session.access_token].join(" "), "Content-Type": "application/json" },
          body: JSON.stringify({ homepageAnnouncement: "" }),
        });
        const result = await response.json();
        if (!response.ok || typeof result.homepageAnnouncement !== "string") throw new Error(result.error ?? "Could not clear the homepage message.");
        setHomepageAnnouncement("");
        setHomepageAnnouncementDraft("");
        homepageAnnouncementDirty.current = false;
        setNotice("Homepage announcement cleared.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not clear the homepage message.");
      }
    });
  };
  const saveHomepageHeadline = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await withProgress("homepage-headline-save", async () => {
      try {
        const { data: { session }, error } = await getSupabaseBrowserClient().auth.getSession();
        if (error) throw error;
        if (!session) throw new Error("Admin session expired.");
        const response = await fetch("/api/admin/site-content", {
          method: "POST",
          headers: { Authorization: ["Bearer", session.access_token].join(" "), "Content-Type": "application/json" },
          body: JSON.stringify(homepageHeadlineForm),
        });
        const result = await response.json();
        if (!response.ok || !result.headline) throw new Error(result.error ?? "Could not save the homepage phrase.");
        setHomepageHeadlines((current) => [...current, result.headline as HomepageHeadline]);
        setHomepageHeadlineForm({ mainPhrase: "", accentPhrase: "" });
        setNotice("Homepage phrase saved.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not save the homepage phrase.");
      }
    });
  };
  const deleteHomepageHeadline = async (headline: HomepageHeadline) => {
    await withProgress(`homepage-headline-delete-${headline.id}`, async () => {
      try {
        const { data: { session }, error } = await getSupabaseBrowserClient().auth.getSession();
        if (error) throw error;
        if (!session) throw new Error("Admin session expired.");
        const response = await fetch("/api/admin/site-content", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ id: headline.id }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not delete the homepage phrase.");
        setHomepageHeadlines((current) => current.filter((item) => item.id !== headline.id));
        setNotice("Homepage phrase deleted.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not delete the homepage phrase.");
      }
    });
  };
  const refreshAdminSubscriptions = async () => {
    const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
    if (!session) throw new Error("Admin session expired.");
    const subscriptions = await loadAdminSubscriptions(session.access_token);
    setSubscriptionPlans(subscriptions.plans);
    setPendingSubscriptions(subscriptions.pendingSubscriptions);
  };
  const loadUserSubscriptions = async (backgroundRefresh = false) => {
    if (!backgroundRefresh) {
      setUserSubscriptionLoaded(false);
      setUserSubscriptionError("");
    }
    try {
      const response = await fetchWithWebsiteSession("/api/subscriptions", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not load subscription options.");
      setUserSubscriptionPlans(result.plans as SubscriptionPlan[]);
      setSubscriptionPaymentMethods(Array.isArray(result.paymentMethods)
        ? result.paymentMethods.filter((method: unknown): method is SubscriptionPaymentMethod =>
          typeof method === "object" && method !== null &&
          typeof (method as SubscriptionPaymentMethod).method === "string" &&
          typeof (method as SubscriptionPaymentMethod).accountNumber === "string")
        : []);
      setSubscriptionPaymentInstructions(typeof result.paymentInstructions === "string" ? result.paymentInstructions : "");
      setActiveSubscription(result.activeSubscription as AccountSubscription | null);
      setScheduledSubscription(result.scheduledSubscription as AccountSubscription | null);
      setPendingUserSubscription(result.pendingSubscription as AccountSubscription | null);
      setPreviousSubscription(result.previousSubscription as AccountSubscription | null);
      if (result.activeSubscription || result.scheduledSubscription || result.pendingSubscription) {
        setSelectedSubscriptionRequest(null);
        setSubscriptionReceiptName("");
      }
      setUserSubscriptionError("");
      setUserSubscriptionLoaded(true);
    } catch (error) {
      setUserSubscriptionError(error instanceof Error ? error.message : "Could not load subscription options.");
      setUserSubscriptionLoaded(true);
    }
  };
  useEffect(() => {
    if (!isSupabaseConfigured || role !== "user" || dialog !== "subscription") return;
    let active = true;
    let isLoading = false;
    const refreshSubscription = async () => {
      if (!active || isLoading || document.visibilityState !== "visible") return;
      isLoading = true;
      await loadUserSubscriptions(true);
      isLoading = false;
    };
    void refreshSubscription();
    const interval = window.setInterval(() => void refreshSubscription(), 30_000);
    const removeResumeListener = onBrowserResume(refreshSubscription);
    return () => {
      active = false;
      window.clearInterval(interval);
      removeResumeListener();
    };
  }, [role, dialog]);
  useEffect(() => {
    if (!isSupabaseConfigured || role !== "admin" || activeAdminPanel !== "accounts") return;
    let active = true;
    let isLoading = false;
    const refreshAccountSubscriptions = async () => {
      if (!active || isLoading || document.visibilityState !== "visible") return;
      isLoading = true;
      try {
        const { data: { session }, error } = await getSupabaseBrowserClient().auth.getSession();
        if (error) throw error;
        if (!session) throw new Error("Admin session expired.");
        const accounts = await loadAdminAccounts(session.access_token);
        if (active) setWebsiteAccounts(accounts);
      } catch (error) {
        if (active) setNotice(error instanceof Error ? error.message : "Could not refresh account subscription statuses.");
      } finally {
        isLoading = false;
      }
    };
    void refreshAccountSubscriptions();
    const interval = window.setInterval(() => void refreshAccountSubscriptions(), 60_000);
    const removeResumeListener = onBrowserResume(refreshAccountSubscriptions);
    return () => {
      active = false;
      window.clearInterval(interval);
      removeResumeListener();
    };
  }, [role, activeAdminPanel]);
  const saveSubscriptionPlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await withProgress("subscription-plan-save", async () => {
      try {
        const { data: { session }, error } = await getSupabaseBrowserClient().auth.getSession();
        if (error) throw error;
        if (!session) throw new Error("Admin session expired.");
        const response = await fetch("/api/admin/subscriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify(subscriptionPlanForm),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not save subscription plan.");
        setSubscriptionPlanForm({ months: "", price_tzs: "", price_usd: "" });
        setEditingSubscriptionPlanId(null);
        await refreshAdminSubscriptions();
        setNotice(`The ${result.plan.months}-month subscription plan is saved and available to users.`);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not save subscription plan.");
      }
    });
  };
  const reviewSubscriptionPayment = async (subscription: AccountSubscription, paid: boolean) => {
    const reviewNote = subscriptionRejectionNotes[subscription.id]?.trim() ?? "";
    if (!paid && !reviewNote) {
      setNotice("Enter a reason before rejecting this request.");
      return;
    }
    await withProgress(`subscription-review-${subscription.id}`, async () => {
      try {
        const { data: { session }, error } = await getSupabaseBrowserClient().auth.getSession();
        if (error) throw error;
        if (!session) throw new Error("Admin session expired.");
        const response = await fetch("/api/admin/subscriptions", {
          method: "PATCH",
          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ subscriptionId: subscription.id, paid, reviewNote }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not update subscription payment.");
        await refreshAdminSubscriptions();
        setSubscriptionRejectionNotes((current) => {
          const next = { ...current };
          delete next[subscription.id];
          return next;
        });
        setNotice(paid
          ? `Payment confirmed for ${subscription.account?.username ?? "user"} (${subscription.months} month${subscription.months === 1 ? "" : "s"}); the subscription is active now or scheduled after their current term.`
          : `Subscription request from ${subscription.account?.username ?? "user"} was rejected. Reason: ${reviewNote}`);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not update subscription payment.");
      }
    });
  };
  const requestSubscription = async (event: FormEvent<HTMLFormElement>, plan: SubscriptionPlan) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    await withProgress(`subscription-request-${plan.id}`, async () => {
      try {
        const response = await fetchWithWebsiteSession("/api/subscriptions", {
          method: "POST",
          body: formData,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not request this subscription.");
        setPendingUserSubscription(result.subscription as AccountSubscription);
        setPreviousSubscription(null);
        setSelectedSubscriptionRequest(null);
        setSubscriptionReceiptName("");
        setNotice("Subscription requested. Your plan starts after the admin confirms your payment.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not request this subscription.");
        await loadUserSubscriptions();
      }
    });
  };
  const saveTranslation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await withProgress("translation-save", async () => {
      try {
        const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
        if (!session) throw new Error("Admin session expired.");
        const response = await fetch("/api/admin/translations", {
          method: editingTranslationId ? "PATCH" : "POST",
          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ...translationForm, ...(editingTranslationId ? { id: editingTranslationId } : {}) }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not save the translation pair.");
        await refreshAdminTranslations();
        setTranslationForm({ english_phrase: "", swahili_phrase: "" });
        setEditingTranslationId(null);
        setNotice(editingTranslationId ? "Translation pair updated." : "Translation pair added.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not save the translation pair.");
      }
    });
  };
  const deleteTranslation = async (pair: TranslationPair) => {
    await withProgress(`translation-delete-${pair.id}`, async () => {
      try {
        const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
        if (!session) throw new Error("Admin session expired.");
        const response = await fetch("/api/admin/translations", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ id: pair.id }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not delete the translation pair.");
        setTranslationPairs((current) => current.filter((item) => item.id !== pair.id));
        if (editingTranslationId === pair.id) {
          setEditingTranslationId(null);
          setTranslationForm({ english_phrase: "", swahili_phrase: "" });
        }
        setNotice("Translation pair deleted.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not delete the translation pair.");
      }
    });
  };
  const submitCertificate = async (kind: CertificateKind) => {
    const file = certificateFiles[kind];
    if (!file || role !== "user") return;
    setBusyCertificate(kind);
    try {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", file);
      const response = await fetchWithWebsiteSession("/api/website-certificates", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not submit the licence.");
      setCertificates((current) => ({ ...current, [kind]: result.certificate as CertificateSubmission }));
      setCertificateFiles((current) => ({ ...current, [kind]: undefined }));
      setNotice("Licence received by the admin for verification.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not submit the licence.");
    } finally {
      setBusyCertificate(null);
    }
  };
  const reviewCertificate = async (certificate: AdminCertificate, approved: boolean) => {
    const message = certificateRejectionMessages[certificate.id]?.trim() ?? "";
    if (!approved && !message) { setNotice("Add a rejection reason before rejecting this licence."); return; }
    setBusyCertificate(certificate.id);
    try {
      const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
      if (!session) throw new Error("Admin session expired.");
      const response = await fetch("/api/admin/certificates", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: certificate.id, approved, message }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save the licence review.");
      setCertificateRejectionMessages((current) => ({ ...current, [certificate.id]: "" }));
      await refreshAdminCertificates();
      setNotice(approved ? "Licence approved. The account can now list minerals." : "Licence rejected and returned with your reason.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save the licence review.");
    } finally {
      setBusyCertificate(null);
    }
  };
  const updateWebsiteAccount = async (account: WebsiteAccount, isActive: boolean) => {
    const action = isActive ? "activate" : "deactivate";
    if (!window.confirm(`Are you sure you want to ${action} ${account.username}?`)) return;
    setBusyAccountId(account.id);
    try {
      const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
      if (!session) throw new Error("Admin session expired.");
      const response = await fetch("/api/admin/website-accounts", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: account.id, is_active: isActive }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not update account.");
      await refreshAdminAccounts();
      setNotice(`Account ${account.username} ${isActive ? "activated" : "deactivated"}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update account.");
    } finally {
      setBusyAccountId(null);
    }
  };
  const deleteWebsiteAccount = async (account: WebsiteAccount) => {
    if (!window.confirm(`Permanently delete ${account.username} and all of its submissions and drafts? This cannot be undone.`)) return;
    setBusyAccountId(account.id);
    try {
      const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
      if (!session) throw new Error("Admin session expired.");
      const response = await fetch("/api/admin/website-accounts", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: account.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not delete account.");
      setWebsiteAccounts((current) => current.filter((item) => item.id !== account.id));
      setNotice(`Account ${account.username} deleted.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not delete account.");
    } finally {
      setBusyAccountId(null);
    }
  };
  const deleteSubmission = async (kind: "seller" | "buyer", item: Seller | Buyer) => {
    if (isSupabaseConfigured && role === "user") {
      const response = await fetchWithWebsiteSession("/api/website-submissions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id: item.id }),
      });
      const result = await response.json();
      if (!response.ok) { setNotice(result.error ?? "The submission could not be deleted."); return; }
      void refreshRemoteListings().catch(() => setNotice("Deleted, but the list could not be refreshed."));
    } else if (isSupabaseConfigured) {
      const supabase = getSupabaseBrowserClient();
      const table = kind === "seller" ? "listings" : "buy_requests";
      const { error } = await supabase.from(table).delete().eq("id", item.id);
      if (error) { setNotice(error.message); return; }
      if (kind === "seller" && "image_path" in item && item.image_path) {
        await supabase.storage.from("mineral-images").remove([item.image_path]);
      }
      void refreshRemoteListings().catch(() => setNotice("Deleted, but the list could not be refreshed."));
    } else if (kind === "seller") {
      setSellers((current) => current.filter((listing) => listing.id !== item.id));
    } else {
      setBuyers((current) => current.filter((request) => request.id !== item.id));
    }
    setNotice("Submission deleted.");
  };
  const editSubmission = async (kind: "seller" | "buyer", item: Seller | Buyer) => {
    await withProgress(`submission-edit-${kind}-${item.id}`, async () => {
      let currentItem = item;
      if (isSupabaseConfigured && role === "user") {
        try {
          const listings = await refreshRemoteListings(true);
          const latestItem = (kind === "seller" ? listings.sellers : listings.buyers).find((submission) => submission.id === item.id);
          if (!latestItem || latestItem.status === "approved") {
            setNotice("This submission is no longer available to edit.");
            return;
          }
          if (latestItem.status === "pending") {
            setNotice("This submission is still waiting for review and cannot be edited yet.");
            return;
          }
          currentItem = latestItem;
        } catch {
          setNotice("Could not load the latest submission. Please try again.");
          return;
        }
      }
      setSellerImagePreview(null);
      setEditingSubmission(kind === "seller" ? { kind, item: currentItem as Seller } : { kind, item: currentItem as Buyer });
      if (kind === "seller") setSellerListingType((currentItem as Seller).listing_type ?? "single");
      setDialog(kind === "seller" ? "sell" : "buy");
    });
  };
  const mySellers = sellers.filter((item) => item.user_id === userId && item.status !== "approved");
  const myBuyers = buyers.filter((item) => item.user_id === userId && item.status !== "approved");
  const userAccountPageSize = 10;
  const accountSubmissionEntries = [
    ...mySellers.map((item) => ({ kind: "seller" as const, item })),
    ...myBuyers.map((item) => ({ kind: "buyer" as const, item })),
  ];
  const filteredAccountSubmissions = accountSubmissionEntries.filter(({ kind, item }) => {
    const matchesStatus = userAccountListFilter === "all" || item.status === userAccountListFilter;
    const matchesSearch = !userAccountListSearch.trim() ||
      `${item.mineral} ${kind} ${item.status}`.toLocaleLowerCase().includes(userAccountListSearch.trim().toLocaleLowerCase());
    return matchesStatus && matchesSearch;
  });
  const filteredMarketMinerals = myMarketMinerals.filter((item) =>
    !userAccountListSearch.trim() || `${item.mineral} ${item.location}`.toLocaleLowerCase().includes(userAccountListSearch.trim().toLocaleLowerCase()));
  const filteredWantedMinerals = myWantedMinerals.filter((item) =>
    !userAccountListSearch.trim() || `${item.mineral} ${item.location} ${item.color} ${item.shape} ${item.quality}`.toLocaleLowerCase().includes(userAccountListSearch.trim().toLocaleLowerCase()));
  const activeUserAccountList = dialog === "submissions" ? filteredAccountSubmissions
    : dialog === "my-market-minerals" ? filteredMarketMinerals
      : dialog === "my-wanted-minerals" ? filteredWantedMinerals : [];
  const userAccountPageCount = Math.max(1, Math.ceil(activeUserAccountList.length / userAccountPageSize));
  const activeUserAccountPage = Math.min(userAccountListPage, userAccountPageCount);
  const userAccountListStart = (activeUserAccountPage - 1) * userAccountPageSize;
  const visibleAccountSubmissions = filteredAccountSubmissions.slice(userAccountListStart, userAccountListStart + userAccountPageSize);
  const visibleMarketMinerals = filteredMarketMinerals.slice(userAccountListStart, userAccountListStart + userAccountPageSize);
  const visibleWantedMinerals = filteredWantedMinerals.slice(userAccountListStart, userAccountListStart + userAccountPageSize);
  useLayoutEffect(() => {
    if (dialog === "submissions" && submissionsListRef.current) {
      submissionsListRef.current.scrollTop = accountListScroll.current.submissions;
    }
  }, [dialog, mySellers, myBuyers, userAccountListPage]);
  useLayoutEffect(() => {
    if (dialog === "my-market-minerals" && marketListRef.current) {
      marketListRef.current.scrollTop = accountListScroll.current.market;
    }
  }, [dialog, myMarketMinerals, userAccountListPage]);
  useLayoutEffect(() => {
    if (dialog === "my-wanted-minerals" && wantedListRef.current) {
      wantedListRef.current.scrollTop = accountListScroll.current.wanted;
    }
  }, [dialog, myWantedMinerals, userAccountListPage]);
  const pendingSellers = role === "admin" ? sellers.filter((item) => item.status === "pending") : [];
  const pendingBuyers = role === "admin" ? buyers.filter((item) => item.status === "pending") : [];

  const openAccountCreation = () => {
    if (accountCreationDisabled) {
      setNotice("Account creation is suspended for now. Please try again later.");
      return;
    }
    returnToCertificateAfterSignIn.current = null;
    setDialog("create");
  };

  const createAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (accountCreationDisabled) {
      setNotice("Account creation is suspended for now. Please try again later.");
      return;
    }
    returnToCertificateAfterSignIn.current = null;
    const formElement = event.currentTarget;
    await withProgress("account-create", async () => {
      const form = new FormData(formElement);
      if (isSupabaseConfigured) {
        const response = await fetch("/api/auth/website-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            firstName: form.get("firstName"), surname: form.get("surname"), email: form.get("email"),
            phone: form.get("phone"), password: form.get("password"),
            country: form.get("deliveryCountry"), region: form.get("deliveryRegion"),
            district: form.get("deliveryDistrict"), address: form.get("deliveryAddress"),
          }),
        });
        const result = await response.json();
        if (!response.ok) {
          setNotice(result.error ?? "Account creation failed.");
          return;
        }
        formElement.reset();
        setDialog("signin");
        setNotice(`Account created. Your username has been sent to ${result.email}. Sign in to continue.`);
        return;
      }
      setNotice("Account creation is unavailable until the account service is connected.");
    });
  };
  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    await withProgress("account-signin", async () => {
      const form = new FormData(formElement);
      const username = String(form.get("username") ?? "").trim();
      const password = String(form.get("password") ?? "");
      let signedInRole: "user" | "admin" = "user";
      if (isSupabaseConfigured) {
        try {
          let websiteAccount: { id: string; username: string; displayName: string; accessToken: string } | null = null;
          if (/^MM-\d{4}$/i.test(username)) {
            const websiteResponse = await fetch("/api/auth/website-login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ username, password }),
            });
            if (websiteResponse.ok) websiteAccount = await websiteResponse.json();
          }
          if (websiteAccount) {
            setWebsiteSessionToken(websiteAccount.accessToken);
            setUser(websiteAccount.username);
            setDisplayName(websiteAccount.displayName);
            setUserId(websiteAccount.id);
            setRole("user");
            await refreshCertificates().catch(() => {});
            await refreshRemoteListings(true);
            setNotice("Signed in successfully.");
            formElement.reset();
            const certificateListingId = returnToCertificateAfterSignIn.current;
            if (certificateListingId !== null) {
              returnToCertificateAfterSignIn.current = null;
              setCertificateReadyListingId(certificateListingId);
              setDialog("certificate-ready");
              return;
            }
            const shouldOpenOrders = returnToOrdersAfterSignIn.current;
            returnToOrdersAfterSignIn.current = false;
            setDialog(shouldOpenOrders ? "commerce" : null);
            return;
          }
          const response = await fetch("/api/auth/username-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? "Username or password is incorrect.");
          const supabase = getSupabaseBrowserClient();
          const { data, error } = await supabase.auth.setSession({ access_token: result.accessToken, refresh_token: result.refreshToken });
          if (error || !data.session) throw error ?? new Error("Sign-in failed.");
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("id, username, role")
            .eq("id", data.session.user.id)
            .single();
          if (profileError) throw profileError;
          setUser(profile.username);
          setDisplayName(profile.username);
          setUserId(profile.id);
          if (profile.role !== "admin") throw new Error("Username or password is incorrect.");
          signedInRole = "admin";
          setRole(signedInRole);
          await refreshRemoteListings();
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "Sign-in failed.");
          return;
        }
        setNotice(signedInRole === "admin" ? "Signed in to the admin account." : `Signed in as ${username}.`);
      } else {
        setUser(username);
        setDisplayName(username);
        setUserId(username);
        setRole("user");
        setNotice(`Local demo session started as ${username}.`);
      }
      formElement.reset();
      const certificateListingId = signedInRole === "user" ? returnToCertificateAfterSignIn.current : null;
      returnToCertificateAfterSignIn.current = null;
      if (certificateListingId !== null) {
        setCertificateReadyListingId(certificateListingId);
        setDialog("certificate-ready");
        return;
      }
      const shouldOpenOrders = signedInRole === "user" && returnToOrdersAfterSignIn.current;
      returnToOrdersAfterSignIn.current = false;
      setDialog(shouldOpenOrders ? "commerce" : null);
    });
  };
  const requestPasswordReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    await withProgress("password-reset-request", async () => {
      try {
        const form = new FormData(formElement);
        const response = await fetch("/api/auth/website-password-reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: form.get("email") }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not request a password reset.");
        formElement.reset();
        setDialog("signin");
        setNotice(result.message);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not request a password reset.");
      }
    });
  };
  const signOut = async () => {
    if (isSupabaseConfigured) {
      if (role === "admin") await getSupabaseBrowserClient().auth.signOut({ scope: "local" });
    }
    clearWebsiteSessionToken();
    setUser("");
    setDisplayName("");
    setUserId("");
    setRole(null);
    setSellerOpenOrdersCount(0);
    setBuyerOpenOrdersCount(0);
    setPrivateOffersCount(0);
    setSellingCount(0);
    setBuyingCount(0);
    setCertificates({});
    setCertificateFiles({});
    setDialog(null);
  };
  const addSeller = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    await withProgress("seller-submit", async () => {
    const form = new FormData(formElement);
    const file = form.get("image");
    const existing = editingSubmission?.kind === "seller" ? editingSubmission.item : null;
    const listingType = form.get("listing_type") === "batch" ? "batch" : "single";
    const totalWeight = Number(form.get("weight"));
    const smallestStoneWeight = Number(form.get("smallest_stone_weight"));
    const largestStoneWeight = Number(form.get("largest_stone_weight"));
    const stoneWeightUnit = form.get("stone_weight_unit");
    const sellerPrice = Number(form.get("price"));
    const currency = form.get("currency") as Currency;
    if (!Number.isFinite(sellerPrice) || sellerPrice <= 0 || !["TZS", "USD"].includes(currency) || (currency === "USD" && (!currencySettingsLoaded || !usdEnabled))) {
      if (currency === "USD" && (!currencySettingsLoaded || !usdEnabled)) {
        setNotice("USD is disabled. Select TSh to submit this listing.");
        return;
      }
      setNotice("Enter a valid seller price and currency.");
      return;
    }
    if (listingType === "batch" && (
      !Number.isFinite(smallestStoneWeight) ||
      !Number.isFinite(largestStoneWeight) ||
      !["carats", "g", "kg"].includes(String(stoneWeightUnit)) ||
      !isValidBatchWeightRange(totalWeight, form.get("unit") as Unit, smallestStoneWeight, largestStoneWeight, stoneWeightUnit as StoneWeightUnit)
    )) {
      setNotice("Check the smallest and largest stone weights. The smallest must not exceed the largest, and the largest must fit within the total batch weight.");
      return;
    }
    let image = existing?.image ?? "";
    let imagePath = existing?.image_path ?? null;
    let imageData = "";
    if (file instanceof File && file.size) {
      try {
        image = await storeMineralPhoto(file);
        imageData = image;
      } catch {
        setNotice("That image could not be processed. Please try another PNG or JPG.");
        return;
      }
    }
    if (isSupabaseConfigured && !existing && !listingFeeSettingsLoaded) {
      setNotice("The current mineral listing fee is still loading. Please try again.");
      return;
    }
    const feeRate = existing?.platform_fee_rate ?? listingFeePercent / 100;
    const pricing = calculateListingPrice(sellerPrice, currency, feeRate);
    const listing: Seller = {
      id: existing?.id ?? Date.now(), mineral: String(form.get("mineral")), weight: String(form.get("weight")), unit: form.get("unit") as Unit,
      listing_type: listingType,
      smallest_stone_weight: listingType === "batch" ? String(smallestStoneWeight) : undefined,
      largest_stone_weight: listingType === "batch" ? String(largestStoneWeight) : undefined,
      stone_weight_unit: listingType === "batch" ? stoneWeightUnit as StoneWeightUnit : undefined,
      seller_price: String(pricing.sellerPrice), platform_fee_rate: pricing.platformFeeRate,
      platform_fee_amount: String(pricing.platformFeeAmount), price: String(pricing.marketPrice),
      currency, seller: String(form.get("seller")),
      location: [form.get("street"), form.get("district"), form.get("region"), form.get("country")].filter(Boolean).join(", "),
      country: String(form.get("country")), region: String(form.get("region")), district: String(form.get("district")), street: String(form.get("street")),
      email: String(form.get("email")), phone: String(form.get("phone")), image, image_path: null, accent: "#448363",
      user_id: userId, status: "pending", review_message: null,
    };
    if (isSupabaseConfigured && role === "user") {
      if (!userId) { setNotice("Sign in again before submitting this listing."); return; }
      const stoneCertificate = form.get("stoneCertificate");
      const submission = new FormData();
      submission.set("kind", "seller");
      if (existing?.id) submission.set("id", String(existing.id));
      submission.set("imageData", imageData);
      submission.set("values", JSON.stringify({
        mineral_name: listing.mineral, listing_type: listing.listing_type, weight: listing.weight, unit: listing.unit,
        smallest_stone_weight: listing.smallest_stone_weight, largest_stone_weight: listing.largest_stone_weight,
        stone_weight_unit: listing.stone_weight_unit, price: listing.seller_price,
        currency: listing.currency, seller_name: listing.seller, country: listing.country, region: listing.region,
        district: listing.district, street: listing.street, email: listing.email, phone: listing.phone,
      }));
      if (stoneCertificate instanceof File && stoneCertificate.size) submission.set("stoneCertificate", stoneCertificate);
      const response = await fetchWithWebsiteSession("/api/website-submissions", {
        method: "POST",
        body: submission,
      });
      const result = await response.json();
      if (!response.ok) { setNotice(result.error ?? "The listing could not be saved."); return; }
      setWebsiteDrafts((current) => ({ ...current, seller: null }));
      void refreshRemoteListings().catch(() => setNotice("Submitted, but the listings could not be refreshed."));
      setNotice(existing ? "Listing updated and resubmitted for admin approval." : "Seller listing submitted for admin approval.");
    } else if (isSupabaseConfigured) {
      if (!userId) { setNotice("Sign in again before submitting this listing."); return; }
      const supabase = getSupabaseBrowserClient();
      if (file instanceof File && file.size) {
        const path = `${userId}/${crypto.randomUUID()}.jpg`;
        const imageBlob = await (await fetch(image)).blob();
        const { error: uploadError } = await supabase.storage.from("mineral-images").upload(path, imageBlob, { contentType: "image/jpeg" });
        if (uploadError) { setNotice(uploadError.message); return; }
        imagePath = path;
      }
      const values = {
        user_id: userId, mineral_name: listing.mineral, listing_type: listing.listing_type,
        weight: listing.weight, unit: listing.unit, smallest_stone_weight: listing.smallest_stone_weight ?? null,
        largest_stone_weight: listing.largest_stone_weight ?? null, stone_weight_unit: listing.stone_weight_unit ?? null,
        seller_price: listing.seller_price, platform_fee_rate: listing.platform_fee_rate,
        platform_fee_amount: listing.platform_fee_amount, price: listing.price,
        currency: listing.currency, seller_name: listing.seller,
        country: listing.country, region: listing.region, district: listing.district, street: listing.street,
        email: listing.email, phone: listing.phone, image_path: imagePath,
        status: "pending", review_message: null, reviewed_by: null, reviewed_at: null,
      };
      const result = existing
        ? await supabase.from("listings").update(values).eq("id", existing.id).select("id").maybeSingle()
        : await supabase.from("listings").insert(values);
      const error = result.error;
      if (error) { setNotice(error.message); return; }
      if (existing?.image_path && existing.image_path !== imagePath) {
        await supabase.storage.from("mineral-images").remove([existing.image_path]);
      }
      void refreshRemoteListings().catch(() => setNotice("Submitted, but the listings could not be refreshed."));
      setNotice(existing ? "Listing updated and resubmitted for admin approval." : "Seller listing submitted for admin approval.");
    } else {
      setSellers((current) => existing ? current.map((item) => item.id === existing.id ? listing : item) : [listing, ...current]);
      setLastUpdated(new Date());
      setNotice(existing ? "Listing updated in this browser." : "Saved in this browser as pending. Connect Supabase to enable real admin review.");
    }
    formElement.reset();
    setSellerImagePreview(null);
    setEditingSubmission(null);
    setDialog(null);
    });
  };
  const addBuyer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    await withProgress("buyer-submit", async () => {
    const form = new FormData(formElement);
    const existing = editingSubmission?.kind === "buyer" ? editingSubmission.item : null;
    const currency = form.get("currency") as Currency;
    if (!["TZS", "USD"].includes(currency) || (currency === "USD" && (!currencySettingsLoaded || !usdEnabled))) {
      setNotice(currency === "USD" ? "USD is disabled. Select TSh to submit this request." : "Select a valid currency before submitting this request.");
      return;
    }
    const listing: Buyer = {
      id: existing?.id ?? Date.now(), mineral: String(form.get("mineral")), weight: String(form.get("weight")), unit: form.get("unit") as Unit,
      color: String(form.get("color")), shape: form.get("shape") as "Cut" | "Uncut", quality: String(form.get("quality")),
      offer: String(form.get("offer")), currency, buyer: String(form.get("buyer")),
      location: String(form.get("location")), email: String(form.get("email")), phone: String(form.get("phone")),
      user_id: userId, status: "pending", review_message: null,
    };
    if (isSupabaseConfigured && role === "user") {
      if (!userId) { setNotice("Sign in again before submitting this request."); return; }
      const response = await fetchWithWebsiteSession("/api/website-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "buyer", id: existing?.id,
          values: {
            mineral_name: listing.mineral, weight: listing.weight, unit: listing.unit, color: listing.color,
            shape: listing.shape, quality: listing.quality, offer: listing.offer, currency: listing.currency,
            buyer_name: listing.buyer, location: listing.location, email: listing.email, phone: listing.phone,
          },
        }),
      });
      const result = await response.json();
      if (!response.ok) { setNotice(result.error ?? "The request could not be saved."); return; }
      setWebsiteDrafts((current) => ({ ...current, buyer: null }));
      void refreshRemoteListings().catch(() => setNotice("Submitted, but the listings could not be refreshed."));
      setNotice(existing ? "Request updated and resubmitted for admin approval." : "Buying request submitted for admin approval.");
    } else if (isSupabaseConfigured) {
      if (!userId) { setNotice("Sign in again before submitting this request."); return; }
      const supabase = getSupabaseBrowserClient();
      const values = {
        user_id: userId, mineral_name: listing.mineral, weight: listing.weight, unit: listing.unit,
        color: listing.color, shape: listing.shape, quality: listing.quality, offer: listing.offer,
        currency: listing.currency, buyer_name: listing.buyer, location: listing.location,
        email: listing.email, phone: listing.phone, status: "pending",
        review_message: null, reviewed_by: null, reviewed_at: null,
      };
      const result = existing
        ? await supabase.from("buy_requests").update(values).eq("id", existing.id).select("id").maybeSingle()
        : await supabase.from("buy_requests").insert(values);
      const error = result.error;
      if (error) { setNotice(error.message); return; }
      void refreshRemoteListings().catch(() => setNotice("Submitted, but the listings could not be refreshed."));
      setNotice(existing ? "Request updated and resubmitted for admin approval." : "Buying request submitted for admin approval.");
    } else {
      setBuyers((current) => existing ? current.map((item) => item.id === existing.id ? listing : item) : [listing, ...current]);
      setLastUpdated(new Date());
      setNotice("Saved in this browser as pending. Connect Supabase to enable real admin review.");
    }
    formElement.reset();
    setEditingSubmission(null);
    setDialog(null);
    });
  };
  const editingSeller = editingSubmission?.kind === "seller" ? editingSubmission.item : null;
  const editingBuyer = editingSubmission?.kind === "buyer" ? editingSubmission.item : null;
  const sellerImagePreviewUrl = sellerImagePreview ?? editingSeller?.image ?? websiteDrafts.seller?.image_url ?? "";

  if (isAdminRole(role)) {
    const pendingTotal = pendingSellers.length + pendingBuyers.length;
    const formatLedgerMoney = (amount: number, currency: Currency) => money(
      new Intl.NumberFormat("en-US", {
        minimumFractionDigits: currency === "USD" ? 2 : 0,
        maximumFractionDigits: currency === "USD" ? 2 : 0,
      }).format(amount),
      currency,
    );
    const salesPeriods = [
      { key: "today", label: "Daily total" },
      { key: "thisWeek", label: "Weekly total" },
      { key: "thisMonth", label: "Monthly total" },
      { key: "thisYear", label: "Yearly total" },
    ] as const;
    return <main className="admin-shell">
      {appUpdateAvailable && <div className="app-update-banner" role="status">
        <span>A new version of Madinimarket is available.</span>
        <button type="button" onClick={() => window.location.reload()}>Reload to update</button>
      </div>}
      <header className="admin-header">
        <a className="admin-brand" href="#admin-home"><Image src="/madinimarket-designer-logo.png" alt="" width={42} height={42} /> <span className="admin-brand-name">MADINIMARKET</span><span>ADMIN</span></a>
        <div className="admin-menu-wrap">
          <button className="admin-menu-trigger" type="button" aria-label={adminMenuOpen ? "Close admin menu" : "Open admin menu"} aria-expanded={adminMenuOpen} aria-controls="admin-panel-menu" onClick={() => setAdminMenuOpen((open) => !open)}>
            {adminMenuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          {adminMenuOpen && <>
            <button className="admin-menu-dismiss" type="button" aria-label="Close admin menu" onClick={() => setAdminMenuOpen(false)} />
            <nav className="admin-menu-popover" id="admin-panel-menu" aria-label="Admin panels">
              <span className="admin-menu-heading">ADMIN PANELS</span>
              <button className={activeAdminPanel === "review" ? "is-active" : ""} type="button" onClick={() => { setActiveAdminPanel("review"); setAdminMenuOpen(false); }}>Review submissions<span>{pendingSellers.length + pendingBuyers.length}</span></button>
              <button className={activeAdminPanel === "ledger" ? "is-active" : ""} type="button" onClick={() => { setActiveAdminPanel("ledger"); setAdminMenuOpen(false); }}>Seller price ledger</button>
              <button className={activeAdminPanel === "accounts" ? "is-active" : ""} type="button" onClick={() => { setActiveAdminPanel("accounts"); setAdminMenuOpen(false); }}>Accounts<span>{websiteAccounts.length}</span></button>
              <button className={activeAdminPanel === "support" ? "is-active" : ""} type="button" onClick={() => { setActiveAdminPanel("support"); setAdminMenuOpen(false); }}>Support inbox</button>
              <button className={activeAdminPanel === "translations" ? "is-active" : ""} type="button" onClick={() => { setActiveAdminPanel("translations"); setAdminMenuOpen(false); }}>English–Swahili translations</button>
              <button className={activeAdminPanel === "homepage" ? "is-active" : ""} type="button" onClick={() => { setActiveAdminPanel("homepage"); setAdminMenuOpen(false); }}>Homepage headlines</button>
              <button className={activeAdminPanel === "subscriptions" ? "is-active" : ""} type="button" onClick={() => { setActiveAdminPanel("subscriptions"); setAdminMenuOpen(false); void withProgress("subscription-refresh", async () => { try { await refreshAdminSubscriptions(); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not load subscriptions."); } }); }}>Seller/buyer subscription<span>{pendingSubscriptions.length}</span></button>
              <button className={activeAdminPanel === "listing-fee" ? "is-active" : ""} type="button" onClick={() => { setActiveAdminPanel("listing-fee"); setAdminMenuOpen(false); }}>New mineral listing fee</button>
              <button className={activeAdminPanel === "market-hours" ? "is-active" : ""} type="button" onClick={() => { setActiveAdminPanel("market-hours"); setAdminMenuOpen(false); }}>Market hours</button>
              <button className={activeAdminPanel === "orders" ? "is-active" : ""} type="button" onClick={() => { setActiveAdminPanel("orders"); setAdminMenuOpen(false); }}>Marketplace orders<span aria-label={`${marketplaceOrdersNeedingAction} orders needing admin action`}>{marketplaceOrdersNeedingAction}</span></button>
              <button className={activeAdminPanel === "order-time-limits" ? "is-active" : ""} type="button" onClick={() => { setActiveAdminPanel("order-time-limits"); setAdminMenuOpen(false); }}>Order time limits</button>
              <button className={activeAdminPanel === "payment-instructions" ? "is-active" : ""} type="button" onClick={() => { setActiveAdminPanel("payment-instructions"); setAdminMenuOpen(false); }}>Buyer payment instructions</button>
              <div className="admin-menu-currency">
                <div><strong>US dollar currency</strong><span>{!currencySettingsLoaded ? "Loading currency settings…" : usdEnabled ? "USD and TSh are available." : "Only TSh is available."}</span></div>
                <button className={`admin-currency-switch${usdEnabled ? " is-on" : ""}`} type="button" role="switch" aria-checked={usdEnabled} aria-label="Allow US dollar currency" disabled={!currencySettingsLoaded || busyActions.has("currency-setting")} onClick={() => void updateUsdAvailability(!usdEnabled)}>
                  <span />
                </button>
              </div>
            </nav>
          </>}
        </div>
        <div className="admin-header-actions"><span className="admin-account">{user}</span><button className="text-button" type="button" onClick={() => setDialog("signout")}>Sign out</button></div>
      </header>
      <div className="admin-content" id="admin-home">
        {activeAdminPanel === "support" && <section className="admin-support-panel" aria-labelledby="admin-support-heading"><div className="admin-page-heading"><div><div className="dialog-kicker">USER COMMUNICATION</div><h1 id="admin-support-heading">Support inbox</h1><p>Review complaints, reply to users, and manage internal follow-up.</p></div></div><SupportInbox admin onNotice={setNotice} /></section>}
        {activeAdminPanel === "listing-fee" && <section className="admin-listing-fee-panel" aria-labelledby="admin-listing-fee-heading">
          <div className="admin-page-heading">
            <div><div className="dialog-kicker">MARKETPLACE SETTINGS</div><h1 id="admin-listing-fee-heading">New mineral listing fee</h1><p>Set the fee that will be applied to new mineral listings. Existing listings keep their saved fee and price.</p></div>
          </div>
          <div className="admin-listing-fee-editor">
            <label className="field-label" htmlFor="admin-listing-fee">Listing fee percentage</label>
            <div className="admin-listing-fee-input">
              <input className="text-input" id="admin-listing-fee" type="number" min="0" max="100" step="0.01" value={listingFeePercentInput}
                disabled={!listingFeeSettingsLoaded || busyActions.has("listing-fee-setting")}
                onChange={(event) => {
                  setListingFeePercentInput(event.target.value);
                  listingFeeDraftDirty.current = event.target.value.trim() === "" || Number(event.target.value) !== listingFeePercent;
                }} />
              <span>%</span>
            </div>
            <p>Enter a value from 0.00% to 100.00%, with up to two decimal places.</p>
            <div className="admin-listing-fee-actions">
              <button className="button button-dark" type="button"
                disabled={!listingFeeSettingsLoaded || busyActions.has("listing-fee-setting") ||
                  (listingFeePercentInput.trim() !== "" && Number(listingFeePercentInput) === listingFeePercent)}
                onClick={() => void updateListingFee()}>
                {busyActions.has("listing-fee-setting") ? "Saving…" : "Save"}
              </button>
              <button className="button button-outline" type="button"
                disabled={!listingFeeSettingsLoaded || busyActions.has("listing-fee-setting") ||
                  (listingFeePercentInput.trim() !== "" && Number(listingFeePercentInput) === listingFeePercent)}
                onClick={cancelListingFeeEdit}>
                Cancel
              </button>
            </div>
          </div>
          <div className="admin-listing-fee-current" aria-live="polite">
            <div className="admin-listing-fee-current-heading">
              <div><span>SAVED SETTING</span><h2>Current fee</h2></div>
              <span className="admin-listing-fee-status">Current</span>
            </div>
            {listingFeeSettingsLoaded
              ? <><strong className="admin-listing-fee-current-value">{formatFeePercent(listingFeePercent)}%</strong>
                <small>{listingFeeUpdatedAt
                  ? `Updated on ${new Date(listingFeeUpdatedAt).toLocaleString()}`
                  : "Update date and time unavailable"}</small></>
              : <small>Loading saved fee…</small>}
          </div>
        </section>}
        {activeAdminPanel === "market-hours" && <section className="admin-listing-fee-panel admin-market-hours-panel" aria-labelledby="admin-market-hours-heading">
          <div className="admin-page-heading">
            <div><div className="dialog-kicker">MARKETPLACE SETTINGS</div><h1 id="admin-market-hours-heading">Market hours</h1><p>Set a recurring weekly schedule. Mineral listings and buyer requests are visible only while the market is open.</p></div>
          </div>
          <div className="admin-market-hours-status" aria-live="polite">
            <div><span>MARKET STATUS</span><strong className={marketHoursLoaded && marketIsOpen ? "is-open" : "is-closed"}>
              {!marketHoursLoaded ? "Checking schedule…" : marketHoursError ? "Unavailable" : marketIsOpen ? "Open" : "Closed"}
            </strong></div>
            <small>{marketHoursLoaded && !marketHoursError && marketHours.manuallyClosed
              ? "Closed manually; turning this off restores the saved schedule"
              : marketHoursLoaded && !marketHoursError && !marketIsOpen && nextMarketOpenAt
                ? `Opens ${formatMarketOpening(nextMarketOpenAt)} Tanzania time`
                : marketHoursError || "Schedule time zone: Africa/Dar_es_Salaam"}</small>
          </div>
          <div className="admin-market-manual-control">
            <div><strong>Close market manually</strong><span>{marketHours.manuallyClosed ? "The market is closed now, regardless of saved hours." : "When off, the market follows the saved weekly schedule."}</span></div>
            <button className={`admin-currency-switch${marketHours.manuallyClosed ? " is-on" : ""}`} type="button" role="switch" aria-checked={marketHours.manuallyClosed} aria-label="Close market manually" disabled={!marketHoursLoaded || busyActions.has("market-hours-setting")} onClick={() => void updateManualMarketClosure(!marketHours.manuallyClosed)}><span /></button>
          </div>
          <div className="admin-listing-fee-editor admin-market-hours-editor">
            <fieldset className="admin-market-days">
              <legend>Days open</legend>
              <div>{marketWeekdays.map(({ day, label }) => <label key={day}>
                <input type="checkbox" checked={marketHoursDraft.openDays.includes(day)} disabled={!marketHoursLoaded || busyActions.has("market-hours-setting")}
                  onChange={(event) => setMarketHoursDraft((current) => {
                    const openDays = event.target.checked
                      ? [...current.openDays, day].sort((a, b) => a - b)
                      : current.openDays.filter((value) => value !== day);
                    marketHoursDraftDirty.current = openDays.length !== marketHours.openDays.length ||
                      openDays.some((value) => !marketHours.openDays.includes(value)) ||
                      current.openTime !== marketHours.openTime ||
                      current.closeTime !== marketHours.closeTime;
                    return { ...current, openDays };
                  })} />
                <span>{label}</span>
              </label>)}</div>
            </fieldset>
            <div className="admin-market-time-fields">
              {([
                { field: "openTime", id: "market-open-time", label: "Opening time", value: marketHoursDraft.openTime },
                { field: "closeTime", id: "market-close-time", label: "Closing time", value: marketHoursDraft.closeTime },
              ] as const).map(({ field, id, label, value }) => {
                const [hour, minute] = value.split(":");
                const disabled = !marketHoursLoaded || busyActions.has("market-hours-setting");
                return <fieldset className="admin-market-time-control" key={field} disabled={disabled}>
                  <legend>{label} (Tanzania)</legend>
                  <div className="admin-market-time-selects">
                      <label htmlFor={`${id}-hour`}>Hour (00–23)
                        <select id={`${id}-hour`} aria-label={`${label} hour (24-hour clock)`} value={hour}
                          onChange={(event) => updateMarketHoursDraftTime(field, `${event.target.value}:${minute}`)}>
                          {Array.from({ length: 24 }, (_, value) => String(value).padStart(2, "0")).map((value) =>
                            <option key={value} value={value}>{value}</option>)}
                      </select>
                      </label>
                      <label htmlFor={`${id}-minute`}>Minute
                        <select id={`${id}-minute`} aria-label={`${label} minute`} value={minute}
                          onChange={(event) => updateMarketHoursDraftTime(field, `${hour}:${event.target.value}`)}>
                          {Array.from({ length: 60 }, (_, value) => String(value).padStart(2, "0")).map((value) =>
                            <option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                  </div>
                  <small className="admin-market-time-preview">{value} Tanzania time (24-hour clock)</small>
                </fieldset>;
              })}
            </div>
            <p>Enter times using the 24-hour clock (00:00–23:59) in East Africa Time (Africa/Dar_es_Salaam). If opening and closing times are the same, the market stays open all day on selected days. A closing time earlier than opening time means the market closes the following day.</p>
            <div className="admin-listing-fee-actions">
              <button className="button button-dark" type="button" disabled={!marketHoursLoaded || busyActions.has("market-hours-setting") || !marketHoursChanged}
                onClick={() => void updateMarketHours()}>
                {busyActions.has("market-hours-setting") ? "Saving…" : "Save"}
              </button>
              <button className="button button-outline" type="button" disabled={!marketHoursLoaded || busyActions.has("market-hours-setting") || !marketHoursChanged}
                onClick={cancelMarketHoursEdit}>Cancel</button>
            </div>
          </div>
          <div className="admin-listing-fee-current admin-market-hours-current" aria-live="polite">
            <div className="admin-listing-fee-current-heading">
              <div><span>SAVED SETTING</span><h2>Weekly schedule</h2></div>
              <span className={`admin-listing-fee-status${marketHoursLoaded && marketIsOpen ? "" : " is-closed"}`}>
                {!marketHoursLoaded ? "Checking" : marketHoursError ? "Unavailable" : marketIsOpen ? "Open now" : "Closed now"}
              </span>
            </div>
            {marketHoursLoaded ? <>
              <strong className="admin-market-hours-summary">{marketWeekdays.filter(({ day }) => marketHours.openDays.includes(day)).map(({ label }) => label).join(", ")}</strong>
              <small>{marketHours.openTime}–{marketHours.closeTime} Tanzania time (24-hour clock)</small>
              <small>{marketHours.updatedAt
                ? `Updated on ${new Date(marketHours.updatedAt).toLocaleString()}`
                : "Update date and time unavailable"}</small>
            </> : <small>Loading saved schedule…</small>}
          </div>
        </section>}
        {activeAdminPanel === "review" && <>
        <section className="admin-overview">
          <div className="admin-page-heading"><div><div className="dialog-kicker">ADMIN WORKSPACE</div><h1>Review submissions</h1><p>Approve licences, listings, and buyer requests before they appear in the market.</p></div><button className="button button-outline" type="button" disabled={busyActions.has("admin-refresh")} onClick={() => void withProgress("admin-refresh", async () => { try { await Promise.all([refreshRemoteListings(), refreshAdminAccounts(), refreshAdminCertificates(), refreshAdminTranslations(), refreshAdminSiteContent(), refreshAdminSubscriptions()]); } catch { setNotice("Could not refresh admin data."); } })}>{busyActions.has("admin-refresh") ? "Refreshing…" : <><RefreshCw size={15} /> Refresh</>}</button></div>
          <div className="admin-summary">
            <div><span>SELLER LISTINGS</span><strong>{pendingSellers.length}</strong><small>Awaiting review</small></div>
            <div><span>BUYER REQUESTS</span><strong>{pendingBuyers.length}</strong><small>Awaiting review</small></div>
            <div><span>TOTAL PENDING</span><strong>{pendingTotal}</strong><small>Across both queues</small></div>
          </div>
        </section>
        <div className="admin-queues">
          <section className="admin-queue" aria-labelledby="admin-sellers-heading">
            <div className="admin-queue-heading"><div><span>SELLERS</span><h2 id="admin-sellers-heading">Mineral listings</h2></div><strong>{pendingSellers.length}</strong></div>
            {pendingSellers.length ? <div className="admin-queue-list">{pendingSellers.map((item) => <details className="admin-review-item admin-submission-disclosure" key={`admin-seller-${item.id}`}>
              <summary className="admin-review-title admin-submission-toggle"><div><span>SELLER LISTING</span><h3>{item.mineral}</h3><small>{item.seller} · {item.weight} {item.unit} · {item.location}</small></div><strong>{money(item.price, item.currency)}</strong><ChevronDown className="admin-submission-chevron" size={17} /></summary>
              <div className="admin-submission-details">
                <p>{item.listing_type === "batch" ? "Batch total: " : ""}{item.weight} {item.unit} · {item.seller}</p>
                {item.platform_fee_rate ? <p>{sellerPriceDetails(item)} ({(item.platform_fee_rate * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}% fee)</p> : null}
                {item.listing_type === "batch" && <p>Stone weights: {item.smallest_stone_weight}–{item.largest_stone_weight} {item.stone_weight_unit}</p>}
                <p>{item.location} · {item.phone} · {item.email}</p>
                {item.image ? <div className="admin-mineral-image"><Image src={item.image} alt={`${item.mineral} mineral submitted by ${item.seller}`} fill sizes="(max-width: 720px) 100vw, 420px" unoptimized /></div> : <p className="admin-image-missing">No mineral photo attached.</p>}
                {item.stone_certificate_url && <p><a className="certificate-file-link" href={item.stone_certificate_url} target="_blank" rel="noreferrer">Review stone certificate</a></p>}
                <textarea className="review-message" aria-label={`Rejection message for ${item.mineral}`} placeholder="Message to seller (required to reject)" value={rejectionMessages[`seller-${item.id}`] ?? ""} onChange={(event) => updateReviewMessage(`seller-${item.id}`, event.target.value)} />
                <div className="submission-actions"><button className="button button-dark" type="button" disabled={busyActions.has(`review-seller-${item.id}-approve`) || busyActions.has(`review-seller-${item.id}-reject`)} onClick={() => void withProgress(`review-seller-${item.id}-approve`, () => reviewSubmission("seller", item.id, true))}>{busyActions.has(`review-seller-${item.id}-approve`) ? "Approving…" : "Approve"}</button><button className="button button-outline" type="button" disabled={busyActions.has(`review-seller-${item.id}-approve`) || busyActions.has(`review-seller-${item.id}-reject`)} onClick={() => void withProgress(`review-seller-${item.id}-reject`, () => reviewSubmission("seller", item.id, false))}>{busyActions.has(`review-seller-${item.id}-reject`) ? "Rejecting…" : "Reject"}</button></div>
              </div>
            </details>)}</div> : <p className="admin-empty">No seller listings are waiting for review.</p>}
          </section>
          <section className="admin-queue" aria-labelledby="admin-buyers-heading">
            <div className="admin-queue-heading"><div><span>BUYERS</span><h2 id="admin-buyers-heading">Buying requests</h2></div><strong>{pendingBuyers.length}</strong></div>
            {pendingBuyers.length ? <div className="admin-queue-list">{pendingBuyers.map((item) => <details className="admin-review-item admin-submission-disclosure" key={`admin-buyer-${item.id}`}>
              <summary className="admin-review-title admin-submission-toggle"><div><span>BUYER REQUEST</span><h3>{item.mineral}</h3><small>{item.buyer} · {item.weight} {item.unit} · {item.location}</small></div><strong>{money(item.offer, item.currency)}</strong><ChevronDown className="admin-submission-chevron" size={17} /></summary>
              <div className="admin-submission-details">
                <p>{item.weight} {item.unit} · {item.color} · {item.shape} · {item.quality}</p><p>{item.location} · {item.buyer} · {item.phone} · {item.email}</p>
                <textarea className="review-message" aria-label={`Rejection message for ${item.mineral}`} placeholder="Message to buyer (required to reject)" value={rejectionMessages[`buyer-${item.id}`] ?? ""} onChange={(event) => updateReviewMessage(`buyer-${item.id}`, event.target.value)} />
                <div className="submission-actions"><button className="button button-dark" type="button" disabled={busyActions.has(`review-buyer-${item.id}-approve`) || busyActions.has(`review-buyer-${item.id}-reject`)} onClick={() => void withProgress(`review-buyer-${item.id}-approve`, () => reviewSubmission("buyer", item.id, true))}>{busyActions.has(`review-buyer-${item.id}-approve`) ? "Approving…" : "Approve"}</button><button className="button button-outline" type="button" disabled={busyActions.has(`review-buyer-${item.id}-approve`) || busyActions.has(`review-buyer-${item.id}-reject`)} onClick={() => void withProgress(`review-buyer-${item.id}-reject`, () => reviewSubmission("buyer", item.id, false))}>{busyActions.has(`review-buyer-${item.id}-reject`) ? "Rejecting…" : "Reject"}</button></div>
              </div>
            </details>)}</div> : <p className="admin-empty">No buyer requests are waiting for review.</p>}
          </section>
        </div>
        </>}
        {activeAdminPanel === "ledger" && <section className="admin-ledger" aria-labelledby="admin-ledger-heading">
          <div className="admin-queue-heading admin-ledger-heading">
            <div><span>MARKETPLACE SALES</span><h2 id="admin-ledger-heading">Seller price ledger</h2></div>
            <div className="admin-ledger-live"><span className="admin-ledger-live-dot" /> Live · refreshes every 60 seconds</div>
          </div>
          <section className="admin-sales-ledger" aria-labelledby="admin-sales-ledger-heading">
            <div className="admin-queue-heading">
              <div><span>VERIFIED MARKETPLACE ORDERS</span><h2 id="admin-sales-ledger-heading">Verified payments</h2></div>
              <strong>{filteredSalesLedgerTransactions.length}</strong>
            </div>
            {adminSalesLedgerError && <p className="admin-ledger-error" role="alert">{adminSalesLedgerError}</p>}
            {adminSalesLedger
              ? <>
                <div className="admin-sales-period-grid">
                  {salesPeriods.map(({ key, label }) => <article className="admin-sales-period" key={key}>
                    <h3>{label}</h3>
                    {(["TZS", "USD"] as const).map((currency) => {
                      const totals = adminSalesLedger.periods[key][currency];
                      return <div className="admin-sales-currency" key={currency}>
                        <div className="admin-sales-currency-heading"><strong>{currency}</strong><span>{totals.transactions} item{totals.transactions === 1 ? "" : "s"}</span></div>
                        <dl>
                          <div><dt>Gross sales</dt><dd>{formatLedgerMoney(totals.grossSales, currency)}</dd></div>
                          <div><dt>Seller amount</dt><dd>{formatLedgerMoney(totals.sellerAmount, currency)}</dd></div>
                          <div><dt>Madinimarket fee</dt><dd>{formatLedgerMoney(totals.marketplaceFee, currency)}</dd></div>
                        </dl>
                      </div>;
                    })}
                  </article>)}
                </div>
                <div className="admin-sales-tools">
                  <form className="admin-sales-search" onSubmit={(event) => {
                    event.preventDefault();
                    setSalesLedgerPage(1);
                    setSalesLedgerSearch(salesLedgerSearchInput.trim());
                  }}>
                    <label className="field-label">Search sales
                      <input className="text-input" value={salesLedgerSearchInput} maxLength={80} placeholder="Order number or mineral" onChange={(event) => setSalesLedgerSearchInput(event.target.value)} />
                    </label>
                    <button className="button button-dark" type="submit">Search</button>
                    {salesLedgerSearch && <button className="button button-outline" type="button" onClick={() => {
                      setSalesLedgerSearch("");
                      setSalesLedgerSearchInput("");
                      setSalesLedgerPage(1);
                    }}>Clear</button>}
                  </form>
                  <div className="admin-sales-filters">
                    <label className="field-label">Period
                      <select className="text-input" value={salesLedgerPeriod} onChange={(event) => {
                        setSalesLedgerPeriod(event.target.value as SalesLedgerPeriodFilter);
                        setSalesLedgerPage(1);
                      }}>
                        <option value="all">All time</option>
                        <option value="today">Today</option>
                        <option value="thisWeek">This week</option>
                        <option value="thisMonth">This month</option>
                        <option value="thisYear">This year</option>
                      </select>
                    </label>
                    <label className="field-label">Currency
                      <select className="text-input" value={salesLedgerCurrency} onChange={(event) => {
                        setSalesLedgerCurrency(event.target.value as "all" | Currency);
                        setSalesLedgerPage(1);
                      }}>
                        <option value="all">All currencies</option>
                        <option value="TZS">TZS</option>
                        <option value="USD">USD</option>
                      </select>
                    </label>
                    <label className="field-label">Status
                      <select className="text-input" value={salesLedgerStatus} onChange={(event) => {
                        setSalesLedgerStatus(event.target.value);
                        setSalesLedgerPage(1);
                      }}>
                        <option value="all">All statuses</option>
                        {Array.from(new Set([...adminSalesLedger.transactions.map((transaction) => transaction.status), "completed"])).sort().map((status) =>
                          <option value={status} key={status}>{status.replaceAll("_", " ")}</option>,
                        )}
                      </select>
                    </label>
                  </div>
                </div>
                {visibleSalesLedgerTransactions.length ? <div className="admin-sales-transaction-list">
                  {visibleSalesLedgerTransactions.map((transaction) => <details className="admin-sales-transaction" key={transaction.itemId}>
                    <summary className="admin-sales-transaction-summary">
                      <strong>{transaction.controlNumber}</strong>
                      <span>{transaction.mineralName}</span>
                      <span>{new Date(transaction.verifiedAt).toLocaleString("en-GB", { timeZone: adminSalesLedger.timeZone })}</span>
                      <span className="admin-ledger-status is-approved">{transaction.status.replaceAll("_", " ")}</span>
                      <strong>{formatLedgerMoney(transaction.grossSales, transaction.currency)}</strong>
                    </summary>
                    <div className="admin-sales-transaction-details">
                      <span>Order item · {transaction.mineralName}</span>
                      <span>Seller amount <strong>{formatLedgerMoney(transaction.sellerAmount, transaction.currency)}</strong></span>
                      <span>Madinimarket fee <strong>{formatLedgerMoney(transaction.marketplaceFee, transaction.currency)} ({(transaction.feeRate * 100).toFixed(0)}%)</strong></span>
                      <span>Gross sale <strong>{formatLedgerMoney(transaction.grossSales, transaction.currency)}</strong></span>
                    </div>
                  </details>)}
                </div> : <p className="admin-ledger-empty">{adminSalesLedger.transactions.length ? "No sales match these filters." : "No verified marketplace sales yet."}</p>}
                <div className="admin-sales-pagination">
                  <span>{filteredSalesLedgerTransactions.length ? `Showing ${(activeSalesLedgerPage - 1) * SALES_LEDGER_PAGE_SIZE + 1}–${Math.min(activeSalesLedgerPage * SALES_LEDGER_PAGE_SIZE, filteredSalesLedgerTransactions.length)} of ${filteredSalesLedgerTransactions.length} sales` : "No matching sales"}</span>
                  <div>
                    <button className="button button-outline" type="button" disabled={activeSalesLedgerPage <= 1} onClick={() => setSalesLedgerPage((current) => Math.max(1, current - 1))}>Previous</button>
                    <span>Page {activeSalesLedgerPage} of {salesLedgerPageCount}</span>
                    <button className="button button-outline" type="button" disabled={activeSalesLedgerPage >= salesLedgerPageCount} onClick={() => setSalesLedgerPage((current) => Math.min(salesLedgerPageCount, current + 1))}>Next</button>
                  </div>
                </div>
              </>
              : !adminSalesLedgerError && <p className="admin-ledger-updated">Loading verified sales…</p>}
          </section>
        </section>}
        {activeAdminPanel === "translations" && <section className="admin-translations" aria-labelledby="admin-translations-heading">
          <div className="admin-queue-heading"><div><span>LANGUAGE SETTINGS</span><h2 id="admin-translations-heading">English–Swahili translations</h2></div><strong>{translationPairs.length}</strong></div>
          <div className="admin-site-setting">
            <div><strong>Allow visitors to switch to Swahili</strong><span>{siteContentLoaded ? swahiliEnabled ? "The language switch is visible in the visitor menu." : "The language switch is hidden; visitors use English." : "Loading language settings…"}</span></div>
            <button className={`admin-currency-switch${swahiliEnabled ? " is-on" : ""}`} type="button" role="switch" aria-checked={swahiliEnabled} aria-label="Allow visitors to switch to Swahili" disabled={!siteContentLoaded || busyActions.has("swahili-setting")} onClick={() => void updateSwahiliAvailability(!swahiliEnabled)}><span /></button>
          </div>
          <p className="admin-translation-help">Add a complete English interface phrase and its Swahili equivalent. The phrase must exist in the public interface. A translation applies only when the entire text block or placeholder matches it, so it will not change the same word inside a longer phrase. Matching ignores letter case and extra spaces, and preserves capitalization. Submitted mineral names and descriptions stay unchanged.</p>
          <form className="admin-translation-form" onSubmit={(event) => void saveTranslation(event)}>
            <label className="field-label">Complete English interface phrase<input className="text-input" value={translationForm.english_phrase} maxLength={120} required onChange={(event) => setTranslationForm((current) => ({ ...current, english_phrase: event.target.value }))} /></label>
            <label className="field-label">Swahili translation<input className="text-input" value={translationForm.swahili_phrase} maxLength={120} required onChange={(event) => setTranslationForm((current) => ({ ...current, swahili_phrase: event.target.value }))} /></label>
            <div className="admin-translation-form-actions"><button className="button button-dark" type="submit" disabled={busyActions.has("translation-save")}>{busyActions.has("translation-save") ? "Saving…" : editingTranslationId ? "Update pair" : "Add pair"}</button>{editingTranslationId && <button className="button button-outline" type="button" onClick={() => { setEditingTranslationId(null); setTranslationForm({ english_phrase: "", swahili_phrase: "" }); }}>Cancel</button>}</div>
          </form>
          {translationPairs.length ? <div className="admin-translation-list">{translationPairs.map((pair) => <article className="admin-translation-row" key={pair.id}><div><strong>{pair.english_phrase}</strong><span>{pair.swahili_phrase}</span></div><button className="button button-outline" type="button" onClick={() => { setEditingTranslationId(pair.id); setTranslationForm({ english_phrase: pair.english_phrase, swahili_phrase: pair.swahili_phrase }); }}>Edit</button><button className="button button-danger" type="button" disabled={busyActions.has(`translation-delete-${pair.id}`)} onClick={() => void deleteTranslation(pair)}>{busyActions.has(`translation-delete-${pair.id}`) ? "Deleting…" : "Delete"}</button></article>)}</div> : <p className="admin-empty">No translation pairs have been added.</p>}
        </section>}
        {activeAdminPanel === "homepage" && <section className="admin-homepage-panel" aria-labelledby="admin-homepage-headlines-heading">
          <div className="admin-queue-heading"><div><span>HOMEPAGE DISPLAY</span><h2 id="admin-homepage-headlines-heading">Rotating headline phrases</h2></div><strong>{homepageHeadlines.length}</strong></div>
          <p className="admin-translation-help">Add the regular and highlighted parts separately. The highlighted part uses the homepage’s green accent. Saved phrases rotate every minute; if all are deleted, the homepage shows no headline.</p>
          <form className="admin-homepage-font-size" onSubmit={(event) => void saveHomepageHeadlineFontSize(event)}>
            <label className="field-label" htmlFor="admin-homepage-headline-font-size">Headline font size (pixels)
              <input className="text-input" id="admin-homepage-headline-font-size" type="number" min={24} max={72} step={1} required value={homepageHeadlineFontSizeInput} onChange={(event) => setHomepageHeadlineFontSizeInput(event.target.value)} />
            </label>
            <button className="button button-dark" type="submit" disabled={!siteContentLoaded || busyActions.has("homepage-headline-font-size") || Number(homepageHeadlineFontSizeInput) === homepageHeadlineFontSize}>{busyActions.has("homepage-headline-font-size") ? "Saving…" : "Save font size"}</button>
            <span>Choose from 24–72 px. On narrow screens, the headline scales down to fit.</span>
          </form>
          <form className="admin-homepage-headline-form" onSubmit={(event) => void saveHomepageHeadline(event)}>
            <label className="field-label">Regular phrase<input className="text-input" value={homepageHeadlineForm.mainPhrase} maxLength={120} placeholder="Find your next" onChange={(event) => setHomepageHeadlineForm((current) => ({ ...current, mainPhrase: event.target.value }))} /></label>
            <label className="field-label">Highlighted phrase<input className="text-input" value={homepageHeadlineForm.accentPhrase} maxLength={120} placeholder="good stone." onChange={(event) => setHomepageHeadlineForm((current) => ({ ...current, accentPhrase: event.target.value }))} /></label>
            <button className="button button-dark" type="submit" disabled={busyActions.has("homepage-headline-save") || (!homepageHeadlineForm.mainPhrase.trim() && !homepageHeadlineForm.accentPhrase.trim())}>{busyActions.has("homepage-headline-save") ? "Saving…" : "Save phrase"}</button>
          </form>
          {homepageHeadlines.length ? <div className="admin-homepage-headline-list">{homepageHeadlines.map((headline) => <article className="admin-homepage-headline-row" key={headline.id}><div><span>{headline.main_phrase}</span>{headline.main_phrase && headline.accent_phrase ? " " : ""}<em>{headline.accent_phrase}</em></div><button className="button button-danger" type="button" disabled={busyActions.has(`homepage-headline-delete-${headline.id}`)} onClick={() => void deleteHomepageHeadline(headline)}>{busyActions.has(`homepage-headline-delete-${headline.id}`) ? "Deleting…" : "Delete"}</button></article>)}</div> : <p className="admin-empty">No homepage phrases have been saved.</p>}
        </section>}
        {activeAdminPanel === "accounts" && <section className="admin-accounts" aria-labelledby="admin-accounts-heading">
          <div className="admin-queue-heading"><div><span>WEBSITE USERS</span><h2 id="admin-accounts-heading">Accounts</h2></div><strong>{websiteAccounts.length}</strong></div>
          <div className="admin-account-controls">
            <div className="admin-account-control-row">
              <div><strong>Account creation</strong><span>{!siteContentLoaded ? "Loading account settings…" : accountCreationDisabled ? "New account creation is suspended." : "New account creation is enabled."}</span></div>
              <button className={`admin-currency-switch${accountCreationDisabled ? " is-on" : ""}`} type="button" role="switch" aria-checked={accountCreationDisabled} aria-label="Suspend new account creation" disabled={!siteContentLoaded || busyActions.has("account-creation-setting")} onClick={() => void updateAccountCreationAvailability(!accountCreationDisabled)}><span /></button>
            </div>
            <div className="admin-account-control-row">
              <div><strong>User sign-in</strong><span>{!siteContentLoaded ? "Loading sign-in settings…" : nonAdminSignInDisabled ? "Non-administrator sign-in is suspended." : "User sign-in is enabled."}</span></div>
              <button className={`admin-currency-switch${nonAdminSignInDisabled ? " is-on" : ""}`} type="button" role="switch" aria-checked={nonAdminSignInDisabled} aria-label="Suspend non-administrator sign-in" disabled={!siteContentLoaded || busyActions.has("non-admin-signin-setting")} onClick={() => void updateNonAdminSignInAvailability(!nonAdminSignInDisabled)}><span /></button>
            </div>
            <div className="admin-account-control-row">
              <div><strong>Sign out all users</strong><span>{signOutAllUsersAction ? "Ending all user sessions…" : "Ends every normal user session; admin stays signed in."}</span></div>
              <button className={`admin-currency-switch${signOutAllUsersAction ? " is-on" : ""}`} type="button" role="switch" aria-checked={signOutAllUsersAction} aria-label="Sign out all users" disabled={!siteContentLoaded || busyActions.has("sign-out-all-users")} onClick={() => void signOutAllUsers()}><span /></button>
            </div>
            <details className="admin-homepage-announcement-disclosure">
              <summary className="admin-homepage-announcement-toggle">
                <div><strong>Homepage announcement</strong><span>{!siteContentLoaded ? "Loading announcement settings…" : homepageAnnouncement ? "Message is currently displayed" : "No message is displayed"}</span></div>
                <ChevronDown className="admin-homepage-announcement-chevron" size={17} aria-hidden="true" />
              </summary>
              <form className="admin-homepage-announcement-form" onSubmit={(event) => void saveHomepageAnnouncement(event)}>
                <label className="field-label" htmlFor="admin-homepage-announcement">Message</label>
                <textarea className="text-input" id="admin-homepage-announcement" rows={3} maxLength={500} value={homepageAnnouncementDraft} placeholder="The website is under development…" onChange={(event) => { homepageAnnouncementDirty.current = true; setHomepageAnnouncementDraft(event.target.value); }} />
                <div className="admin-homepage-announcement-actions"><span>{homepageAnnouncement ? "Currently displayed on the homepage" : "No homepage announcement is displayed"}</span><button className="button button-outline" type="button" disabled={!homepageAnnouncementDraft && !homepageAnnouncement || busyActions.has("homepage-announcement-save")} onClick={() => void clearHomepageAnnouncement()}>Clear</button><button className="button button-dark" type="submit" disabled={!siteContentLoaded || busyActions.has("homepage-announcement-save") || homepageAnnouncementDraft.trim() === homepageAnnouncement}>Save message</button></div>
              </form>
            </details>
          </div>
          <label className="admin-account-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search accounts by name, username, email, or ID" placeholder="Search name, username, email, or ID" value={accountSearch} onChange={(event) => { setAccountSearch(event.target.value); setAccountPage(1); if (accountListRef.current) accountListRef.current.scrollTop = 0; }} /></label>
          <div className="admin-account-filters" aria-label="Filter accounts">
            {([
              ["all", "All"],
              ["active", "Active"],
              ["deactivated", "Deactivated"],
              ["approvedLicence", "Approved licence"],
              ["subscribed", "Subscribed"],
              ["notSubscribed", "Not subscribed"],
              ["noApprovedLicence", "No approved licence"],
              ["licencePending", "Licence pending"],
            ] as const).map(([value, label]) => <button className={accountFilter === value ? "is-selected" : ""} type="button" key={value} aria-pressed={accountFilter === value} onClick={() => { setAccountFilter(value); setAccountPage(1); if (accountListRef.current) accountListRef.current.scrollTop = 0; }}>{label}</button>)}
          </div>
          {websiteAccounts.length ? filteredWebsiteAccounts.length ? <>
            <div className="admin-account-list-scroll" ref={accountListRef}><div className="admin-account-list">{visibleWebsiteAccounts.map((account) => {
            const totalPosts = account.listings.total + account.buying_requests.total;
            const accountCertificates = adminCertificates.filter((certificate) => certificate.website_user_id === account.id);
            const pendingAccountCertificates = accountCertificates.filter((certificate) => certificate.status === "pending");
            const approvedAccountCertificates = accountCertificates.filter((certificate) => certificate.status === "approved");
            const busy = busyAccountId === account.id;
            return <details className="admin-account-disclosure" key={account.id}>
              <summary className="admin-account-summary">
                <span className="admin-account-summary-identity"><strong>{account.display_name}</strong><small>{account.username} · {account.email}</small></span>
                <span className="admin-account-summary-statuses">
                  <span className={`admin-account-status ${account.is_active ? "is-active" : "is-inactive"}`}>{account.is_active ? "Active" : "Deactivated"}</span>
                  <span className={`admin-account-status ${account.subscription ? "is-subscribed" : "is-not-subscribed"}`}>{account.subscription ? "Subscribed" : "Not subscribed"}</span>
                  <span className={`admin-account-status ${approvedAccountCertificates.length ? "is-license-approved" : "is-license-unavailable"}`}>{approvedAccountCertificates.length ? "Approved licence" : "No approved licence"}</span>
                  {pendingAccountCertificates.length > 0 && <span className="admin-account-status is-license-pending">Licence pending</span>}
                </span>
                <ChevronDown className="admin-account-disclosure-chevron" size={16} aria-hidden="true" />
              </summary>
              <article className="admin-account-row">
              <div className="admin-account-identity"><strong>{account.display_name}</strong><span>{account.username} · {account.email}</span><small>{account.phone || "No phone number"}</small></div>
              <div className="admin-account-counts">
                <span><strong>{totalPosts}</strong> total posted</span>
                <span>Selling: <strong>{account.listings.total}</strong> ({account.listings.pending} pending · {account.listings.approved} approved · {account.listings.rejected} rejected)</span>
                <span>Buying: <strong>{account.buying_requests.total}</strong> ({account.buying_requests.pending} pending · {account.buying_requests.approved} approved · {account.buying_requests.rejected} rejected)</span>
                {account.subscription && <span className="admin-account-subscription-details">
                  <strong>Subscription:</strong> {account.subscription.months} month{account.subscription.months === 1 ? "" : "s"} · Starts {new Date(account.subscription.starts_at).toLocaleString()} · Ends {new Date(account.subscription.expires_at).toLocaleString()}
                </span>}
              </div>
              <div className="admin-account-status-group">
                {pendingAccountCertificates.length > 0 && <button className="admin-account-status is-license-pending" type="button" aria-label={`Open pending licences for ${account.display_name}`} onClick={() => {
                  const panel = document.getElementById(`account-certificates-${account.id}`);
                  if (panel instanceof HTMLDetailsElement) {
                    panel.open = true;
                    panel.scrollIntoView({ behavior: "smooth", block: "center" });
                  }
                }}>Licence pending</button>}
                {approvedAccountCertificates.length > 0 ? approvedAccountCertificates.map((certificate) => <a className="admin-account-status is-license-approved" key={certificate.id} href={certificate.signed_url} target="_blank" rel="noreferrer" aria-label={`Open approved ${certificate.kind} licence for ${account.display_name}`} title={`Approved ${certificate.kind} licence`}>Approved licence</a>) : <button className="admin-account-status is-license-unavailable" type="button" disabled>Approved licence</button>}
                <span className={`admin-account-status ${account.is_active ? "is-active" : "is-inactive"}`}>{account.is_active ? "Active" : "Inactive"}</span>
                <span className={`admin-account-status ${account.subscription ? "is-subscribed" : "is-not-subscribed"}`}>{account.subscription ? "Subscribed" : "Not subscribed"}</span>
              </div>
              <div className="admin-account-actions">
                <button className="button button-outline" type="button" disabled={busy || account.is_active} onClick={() => void withProgress(`account-${account.id}-activate`, () => updateWebsiteAccount(account, true))}>{busyActions.has(`account-${account.id}-activate`) ? "Activating…" : "Activate"}</button>
                <button className="button button-outline" type="button" disabled={busy || !account.is_active} onClick={() => void withProgress(`account-${account.id}-deactivate`, () => updateWebsiteAccount(account, false))}>{busyActions.has(`account-${account.id}-deactivate`) ? "Deactivating…" : "Deactivate"}</button>
                <button className="button button-danger" type="button" disabled={busy} onClick={() => void withProgress(`account-${account.id}-delete`, () => deleteWebsiteAccount(account))}>{busyActions.has(`account-${account.id}-delete`) ? "Deleting…" : "Delete"}</button>
              </div>
              {pendingAccountCertificates.length > 0 && <details className="admin-account-certificates" id={`account-certificates-${account.id}`}>
                <summary className="admin-account-certificates-toggle"><span>Pending licences</span><strong>{pendingAccountCertificates.length}</strong><ChevronDown className="admin-submission-chevron" size={16} /></summary>
                <div className="admin-account-certificate-list">{pendingAccountCertificates.map((certificate) => <article className="admin-account-certificate" key={certificate.id}>
                  <div className="admin-review-title"><div><span>{certificate.kind === "dealer" ? "DEALER LICENCE" : "BROKER LICENCE"}</span><h3>{certificate.account?.display_name ?? account.display_name}</h3></div><span className="submission-status status-pending">Pending</span></div>
                  <a className="certificate-file-link" href={certificate.signed_url} target="_blank" rel="noreferrer">Review {certificate.file_name}</a>
                  <textarea className="review-message" aria-label={`Rejection reason for ${certificate.file_name}`} placeholder="Reason for rejection (required to reject)" value={certificateRejectionMessages[certificate.id] ?? ""} onChange={(event) => setCertificateRejectionMessages((current) => ({ ...current, [certificate.id]: event.target.value }))} />
                  <div className="submission-actions"><button className="button button-dark" type="button" disabled={busyCertificate === certificate.id} onClick={() => void withProgress(`certificate-${certificate.id}-verify`, () => reviewCertificate(certificate, true))}>{busyActions.has(`certificate-${certificate.id}-verify`) ? "Verifying…" : "Verify"}</button><button className="button button-outline" type="button" disabled={busyCertificate === certificate.id || !certificateRejectionMessages[certificate.id]?.trim()} onClick={() => void withProgress(`certificate-${certificate.id}-reject`, () => reviewCertificate(certificate, false))}>{busyActions.has(`certificate-${certificate.id}-reject`) ? "Rejecting…" : "Reject"}</button></div>
                </article>)}</div>
              </details>}
              </article>
            </details>;
          })}</div></div>
            <div className="admin-account-pagination">
              <span>{`Showing ${(activeAccountPage - 1) * accountPageSize + 1}–${Math.min(activeAccountPage * accountPageSize, filteredWebsiteAccounts.length)} of ${filteredWebsiteAccounts.length} accounts`}</span>
              <div><button className="button button-outline" type="button" disabled={activeAccountPage <= 1} onClick={() => { setAccountPage((current) => Math.max(1, current - 1)); if (accountListRef.current) accountListRef.current.scrollTop = 0; }}>Previous</button><span>Page {activeAccountPage} of {accountPageCount}</span><button className="button button-outline" type="button" disabled={activeAccountPage >= accountPageCount} onClick={() => { setAccountPage((current) => Math.min(accountPageCount, current + 1)); if (accountListRef.current) accountListRef.current.scrollTop = 0; }}>Next</button></div>
            </div>
          </> : <p className="admin-empty">No accounts match the selected filters{accountSearch.trim() ? ` and “${accountSearch.trim()}”` : ""}.</p> : <p className="admin-empty">No website accounts have been created.</p>}
        </section>}
        {activeAdminPanel === "orders" && <AdminMarketplaceOrders onNotice={setNotice} marketplaceOrdersNeedingAction={marketplaceOrdersNeedingAction} />}
        {activeAdminPanel === "order-time-limits" && <AdminOrderTimeLimits onNotice={setNotice} />}
        {activeAdminPanel === "payment-instructions" && <AdminPaymentInstructions onNotice={setNotice} />}
        {activeAdminPanel === "subscriptions" && <section className="admin-subscriptions" aria-labelledby="admin-subscriptions-heading">
          <div className="admin-queue-heading"><div><span>SELLER AND BUYER ACCESS</span><h2 id="admin-subscriptions-heading">Seller/buyer subscription</h2></div><button className="button button-outline" type="button" disabled={busyActions.has("subscription-refresh")} onClick={() => void withProgress("subscription-refresh", async () => { try { await refreshAdminSubscriptions(); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not refresh subscriptions."); } })}><RefreshCw size={14} /> Refresh</button></div>
          <p className="admin-subscription-help">Plans use 30-day months. Saving a duration that already exists updates its price; previous subscriptions keep their original price and duration.</p>
          <form className="admin-subscription-plan-form" onSubmit={(event) => void saveSubscriptionPlan(event)}>
            <label className="field-label">Months<input className="text-input" type="number" name="months" min="1" max="120" step="1" required value={subscriptionPlanForm.months} onChange={(event) => setSubscriptionPlanForm((current) => ({ ...current, months: event.target.value }))} /></label>
            <label className="field-label">Amount in TSh<input className="text-input" type="number" name="price_tzs" min="0.01" step="0.01" required value={subscriptionPlanForm.price_tzs} onChange={(event) => setSubscriptionPlanForm((current) => ({ ...current, price_tzs: event.target.value }))} /></label>
            <label className="field-label">Amount in USD<input className="text-input" type="number" name="price_usd" min="0.01" step="0.01" required value={subscriptionPlanForm.price_usd} onChange={(event) => setSubscriptionPlanForm((current) => ({ ...current, price_usd: event.target.value }))} /></label>
            <div className="admin-subscription-plan-actions"><button className="button button-dark" type="submit" disabled={busyActions.has("subscription-plan-save")}>{busyActions.has("subscription-plan-save") ? "Saving…" : editingSubscriptionPlanId ? "Update plan" : "Save plan"}</button>{editingSubscriptionPlanId && <button className="button button-outline" type="button" onClick={() => { setEditingSubscriptionPlanId(null); setSubscriptionPlanForm({ months: "", price_tzs: "", price_usd: "" }); }}>Cancel</button>}</div>
          </form>
          <div className="admin-subscription-plans">
            <div className="admin-queue-heading"><div><span>AVAILABLE PLANS</span><h3>Saved durations</h3></div><strong>{subscriptionPlans.length}</strong></div>
            {subscriptionPlans.length ? <div className="admin-subscription-plan-list">{subscriptionPlans.map((plan) => <article className="admin-subscription-plan" key={plan.id}>
              <div><strong>{plan.months} month{plan.months === 1 ? "" : "s"}</strong><span>{money(plan.price_tzs, "TZS")} · ${Number(plan.price_usd).toFixed(2)} USD</span></div>
              <button className="button button-outline" type="button" onClick={() => { setEditingSubscriptionPlanId(plan.id); setSubscriptionPlanForm({ months: String(plan.months), price_tzs: String(plan.price_tzs), price_usd: String(plan.price_usd) }); }}>Edit</button>
            </article>)}</div> : <p className="admin-empty">No subscription plans saved yet.</p>}
          </div>
          <div className="admin-subscription-requests">
            <div className="admin-queue-heading"><div><span>PAYMENT CONFIRMATION</span><h3>Pending user requests</h3></div><strong>{pendingSubscriptions.length}</strong></div>
            {pendingSubscriptions.length ? <div className="admin-subscription-request-list">{pendingSubscriptions.map((subscription) => <article className="admin-subscription-request" key={subscription.id}>
              <div className="admin-subscription-request-heading"><div><strong>{subscription.account?.display_name ?? "Account"}</strong><span>{subscription.account?.username ?? "Unknown user"} · {subscription.account?.email ?? ""}</span></div><span className="admin-subscription-pending">Payment pending</span></div>
              <p>{subscription.months} month{subscription.months === 1 ? "" : "s"} · {money(Number(subscription.amount).toFixed(subscription.currency === "USD" ? 2 : 0), subscription.currency)} · Requested {new Date(subscription.requested_at).toLocaleString()}</p>
              <p><strong>Payment reference:</strong> {subscription.payment_reference || "Not provided for this older request"}</p>
              {subscription.payment_receipt_url ? <p><a href={subscription.payment_receipt_url} target="_blank" rel="noopener noreferrer">Open uploaded payment receipt</a></p> : <p>No receipt was attached to this older request.</p>}
              <label className="field-label admin-subscription-review-note">Rejection reason<textarea className="text-input" rows={2} maxLength={500} value={subscriptionRejectionNotes[subscription.id] ?? ""} onChange={(event) => setSubscriptionRejectionNotes((current) => ({ ...current, [subscription.id]: event.target.value }))} placeholder="Explain what needs to be corrected" /></label>
              <div className="admin-subscription-request-actions">
                <button className="button button-dark" type="button" disabled={busyActions.has(`subscription-review-${subscription.id}`)} onClick={() => void reviewSubscriptionPayment(subscription, true)}>{busyActions.has(`subscription-review-${subscription.id}`) ? "Updating…" : "Confirm payment"}</button>
                <button className="button button-outline" type="button" disabled={busyActions.has(`subscription-review-${subscription.id}`) || !(subscriptionRejectionNotes[subscription.id] ?? "").trim()} onClick={() => void reviewSubscriptionPayment(subscription, false)}>Reject request</button>
              </div>
            </article>)}</div> : <p className="admin-empty">No subscription payments are waiting for confirmation.</p>}
          </div>
        </section>}
      </div>
      {notice && <div className="toast" role="status"><span className="toast-mark"><Check size={15} /></span>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={15} /></button></div>}
      {dialog === "signout" && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><section className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button className="dialog-close" type="button" aria-label="Close dialog" onClick={() => setDialog(null)}><X size={19} /></button><div className="dialog-brand"><Image src="/madinimarket-designer-logo.png" alt="" width={42} height={42} /><span>MADINIMARKET</span></div><div className="dialog-kicker">ACCOUNT</div><h2 id="dialog-title">Sign out?</h2><p className="dialog-copy">Are you sure you want to sign out?</p><div className="signout-actions"><button className="button button-outline" type="button" onClick={() => setDialog(null)}>Cancel</button><button className="button button-dark" type="button" onClick={() => void signOut()}>Sign out</button></div></section></div>}
    </main>;
  }

  return <main className={`market-shell${role === "user" && !hasApprovedCertificate ? " seller-locked" : ""}`}>
    {appUpdateAvailable && <div className="app-update-banner" role="status">
      <span>A new version of Madinimarket is available.</span>
      <button type="button" onClick={() => window.location.reload()}>Reload to update</button>
    </div>}
    <div className="prototype-bar" style={{ display: 'none' }} aria-hidden="true" />
    <header className="site-header">
      <div className="header-left"><div className="menu-wrap">
        <button className="icon-button menu-trigger" type="button" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X size={21} /> : <Menu size={22} />}</button>
        {menuOpen && <><button className="menu-dismiss" aria-label="Close menu" onClick={() => setMenuOpen(false)} /><div className="menu-popover"><span className="menu-kicker">YOUR ACCOUNT</span>{user ? <><button type="button" onClick={() => openDialog("submissions")}>My submissions <ArrowUpRight size={15} /></button><button type="button" onClick={() => { setDialog("support"); setMenuOpen(false); }}>Help / Contact admin <ArrowUpRight size={15} /></button>{role === "user" && <><button type="button" onClick={() => { setDialog("commerce"); setMenuOpen(false); }}>Orders and Cart <span className="account-menu-counts"><small><strong>{privateOffersCount}</strong> offers</small><small><strong>{buyerOpenOrdersCount}</strong> buying active</small><small><strong>{sellerOpenOrdersCount}</strong> selling active</small></span></button><button type="button" onClick={() => { setDialog("subscription"); setMenuOpen(false); void loadUserSubscriptions(); }}>Subscription <ArrowUpRight size={15} /></button><button type="button" disabled={busyActions.has("load-my-market-minerals")} onClick={() => void openAccountMarket("my-market-minerals")}>{busyActions.has("load-my-market-minerals") ? "Loading minerals…" : <>Selling <span className="account-menu-count"><strong>{sellingCount}</strong><small>listed</small></span></>}</button><button type="button" disabled={busyActions.has("load-my-wanted-minerals")} onClick={() => void openAccountMarket("my-wanted-minerals")}>{busyActions.has("load-my-wanted-minerals") ? "Loading requests…" : <>Buying <span className="account-menu-count"><strong>{buyingCount}</strong><small>requests</small></span></>}</button><button type="button" onClick={() => void openAccountLicences()}>My licence <ArrowUpRight size={15} /></button></>}<button type="button" onClick={() => openDialog("signout")}>Sign out <ArrowUpRight size={15} /></button></> : <><button type="button" disabled={accountCreationDisabled} onClick={openAccountCreation}>{accountCreationDisabled ? "Account creation suspended" : <>Create account <ArrowUpRight size={15} /></>}</button><button type="button" onClick={() => openDialog("signin")}>Sign in <ArrowUpRight size={15} /></button></>}{siteContentLoaded && swahiliEnabled && <div className="menu-language"><span>Language</span><button className={`language-switch${language === "sw" ? " is-swahili" : ""}`} type="button" role="switch" aria-checked={language === "sw"} aria-label={`Language: ${language === "sw" ? "Swahili" : "English"}. Switch to ${language === "sw" ? "English" : "Swahili"}`} onClick={() => chooseLanguage(language === "sw" ? "en" : "sw")}><span>English</span><span>Swahili</span><span className="language-switch-thumb" aria-hidden="true" /></button></div>}<div className="menu-foot"><ShieldCheck size={15} /> One account. Buy or sell.</div></div></>}
      </div><a className="wordmark" href="#top" aria-label="Madinimarket home"><Image src="/madinimarket-logo.png" alt="" width={1254} height={1254} priority /><span>madini<span className="wordmark-market">market</span></span></a></div>
      <div className="header-search"><Search size={17} /><input aria-label="Search minerals and locations" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search minerals and places" /><kbd>/</kbd></div>
      {user && <div className="header-actions"><div className="user-chip" title={displayName}><span className="user-avatar">{displayName.slice(0, 2).toUpperCase()}</span><span data-no-translate>{displayName}</span></div><button className="text-button header-signout" type="button" onClick={() => openDialog("signout")}>Sign out</button></div>}
    </header>

    <div className="market-content" id="top">
      {homepageAnnouncement && <div className="market-announcement" role="status"><span>{homepageAnnouncement}</span></div>}
      <section className="market-intro"><div><div className="eyebrow"><span className="eyebrow-line" /> TANZANIA & BEYOND <span className="eyebrow-year">EST. 2025</span></div>{activeHomepageHeadline && <h1 style={{ "--homepage-headline-font-size": `${homepageHeadlineFontSize}px` } as CSSProperties & { "--homepage-headline-font-size": string }}><span>{activeHomepageHeadline.main_phrase}</span>{activeHomepageHeadline.main_phrase && activeHomepageHeadline.accent_phrase ? " " : ""}<em>{activeHomepageHeadline.accent_phrase}</em></h1>}</div><div className="market-intro-tools"><div className="header-search mobile-market-search"><Search size={17} /><input aria-label="Search minerals and locations" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search minerals here" /></div><div className={`market-status${marketHoursLoaded && !marketIsOpen ? " is-closed" : ""}`}><div><strong>{!marketHoursLoaded ? "Checking market hours…" : marketHoursError ? "Market status unavailable" : marketIsOpen ? "Market open" : "Market closed"}</strong><small>{!marketHoursLoaded ? "Tanzania time" : marketHoursError ? "Please try again shortly." : marketIsOpen ? currentMarketHours ? `Hours: ${currentMarketHours} Tanzania time` : "Today's hours are unavailable." : nextMarketOpenAt ? `Reopens ${formatMarketOpening(nextMarketOpenAt)} Tanzania time` : "No upcoming opening is scheduled."}</small></div></div></div></section>

      {!marketHoursLoaded ? <section className="market-closed-notice"><span>MARKET STATUS</span><h2>Checking market hours</h2><p>Listings will appear once the current market schedule is verified.</p></section>
        : marketIsOpen ? <>
      <section className="listing-section seller-section" aria-labelledby="seller-heading"><div className="section-head"><div className="section-title-wrap"><span className="section-index">01</span><div><div className="section-kicker">LISTED MINERALS</div><h2 id="seller-heading">On the market <span className="count-badge">{visibleSellers.length}</span></h2></div></div><div className="section-controls"><button className="button button-outline section-post" type="button" disabled={busyActions.has("open-sell")} onClick={() => void openListing("sell")}>{busyActions.has("open-sell") ? "Opening…" : <><Plus size={15} /> Sell a mineral</>}</button><button className="round-control" type="button" aria-label="Scroll seller listings left" onClick={() => scrollRail(sellerRail.current, -1)}><ArrowLeft size={17} /></button><button className="round-control" type="button" aria-label="Scroll seller listings right" onClick={() => scrollRail(sellerRail.current, 1)}><ArrowRight size={17} /></button></div></div>
        {visibleSellers.length ? <div className="seller-rail" ref={sellerRail}>{visibleSellers.map((listing) => {
          const isReserved = Boolean(listing.reservation_status) || listing.marketplace_state === "reserved";
          const isCheckoutUnavailable = (listing.marketplace_state != null && listing.marketplace_state !== "available") || listing.is_active === false || listing.status !== "approved";
          const reservationLabel = listing.reservation_status === "availability_pending"
            ? "Temporarily reserved — availability being confirmed"
            : "Reserved for a buyer";
          const isInCart = role === "user" && cartListingAccountId === userId && cartListingIds.has(listing.id);
          const hasImage = Boolean(listing.image) && !failedSellerImageIds.has(listing.id);
          return <article className="seller-card" key={listing.id}><div className="seller-photo" style={{ backgroundColor: listing.accent }} role="img" aria-label={`${listing.mineral} for sale`}>{!hasImage && <Gem size={38} strokeWidth={1.2} />}{hasImage && <Image className="seller-photo-image" src={listing.image} alt="" fill sizes="(max-width: 650px) 78vw, 320px" unoptimized onError={() => setFailedSellerImageIds((current) => new Set(current).add(listing.id))} />}{listing.verified_seller && <span className="photo-tag"><span /> VERIFIED SELLER</span>}{isReserved && <span className="photo-tag reservation-photo-tag">{reservationLabel}</span>}</div><div className="seller-card-info"><div className="seller-name-row"><h3 data-no-translate>{listing.mineral}</h3><span className="weight-tag" data-no-translate>{listing.listing_type === "batch" ? "Batch · " : ""}{listing.weight} {listing.unit}</span></div><div className="seller-price">{money(listing.price, listing.currency)}</div><div className="seller-meta"><span data-no-translate>{listing.location}</span>{listing.stone_certificate_path && <a className="seller-certificate-link" href={`/api/listing-certificate?id=${listing.id}`} target="_blank" rel="noreferrer" onClick={(event) => openStoneCertificate(event, listing.id)}>See certificate</a>}</div><button className="button button-dark add-to-cart-button" type="button" disabled={isCheckoutUnavailable || isReserved || isInCart || !listing.website_account_seller || busyActions.has(`cart-add-${listing.id}`)} onClick={() => void addMineralToCart(listing)}>{busyActions.has(`cart-add-${listing.id}`) ? "Adding…" : isReserved || isCheckoutUnavailable ? "Temporarily unavailable" : isInCart ? "In your cart" : listing.website_account_seller ? "Add to cart" : "Checkout unavailable"}</button></div></article>;
        })}</div> : <div className="empty-search">{query ? `No minerals match “${query}”.` : "No mineral listings yet."}</div>}
        <div className="rail-hint"><span>SCROLL TO EXPLORE</span><span className="rail-line" /><ArrowRight size={14} /></div>
      </section>

      <section className="listing-section buyer-section" aria-labelledby="buyer-heading"><div className="section-head"><div className="section-title-wrap"><span className="section-index buyer-index">02</span><div><div className="section-kicker">WANTED BY THE COMMUNITY</div><h2 id="buyer-heading">Buyers looking <span className="count-badge count-badge-light">{visibleBuyers.length}</span></h2></div></div><div className="section-controls"><button className="button button-lime section-post" type="button" disabled={busyActions.has("open-buy")} onClick={() => void openListing("buy")}>{busyActions.has("open-buy") ? "Opening…" : <><Plus size={15} /> Post a request</>}</button><button className="round-control round-control-light" type="button" aria-label="Scroll buyer requests left" onClick={() => scrollRail(buyerRail.current, -1)}><ArrowLeft size={17} /></button><button className="round-control round-control-light" type="button" aria-label="Scroll buyer requests right" onClick={() => scrollRail(buyerRail.current, 1)}><ArrowRight size={17} /></button></div></div>
        {visibleBuyers.length ? <div className="buyer-rail" ref={buyerRail}>{visibleBuyers.map((request, index) => <article className="buyer-card" key={request.id} style={{ animationDelay: `${index * 70}ms` }}><div className="buyer-card-top"><span className="wanted-tag"><ArrowDownRight size={14} /> WANTED</span><span className="buyer-location" data-no-translate>{request.location}</span></div><h3><span data-no-translate>{request.mineral}</span><span className="buyer-shape" data-no-translate>{request.shape}</span></h3><div className="buyer-specs"><div><span>WEIGHT</span><strong data-no-translate>{request.weight} {request.unit}</strong></div><div><span>COLOUR</span><strong data-no-translate>{request.color}</strong></div><div><span>QUALITY</span><strong data-no-translate>{request.quality}</strong></div></div><div className="buyer-card-bottom"><div><span>OFFER</span><strong data-no-translate>{money(request.offer, request.currency)}</strong></div>{request.offer_enabled && <button className="private-offer-button" type="button" onClick={() => openPrivateOfferForm(request)}>Send private offer</button>}</div></article>)}</div> : <div className="empty-search empty-search-dark">{query ? `No requests match “${query}”.` : "No buying requests yet."}</div>}
        <div className="buyer-rail-hint"><span>HAVE WHAT THEY NEED?</span><span className="rail-line" /><button type="button" disabled={busyActions.has("open-sell")} onClick={() => void openListing("sell")}>{busyActions.has("open-sell") ? "Opening…" : <>List a mineral <ArrowUpRight size={14} /></>}</button></div>
      </section>
        </> : <section className="market-closed-notice"><span>MARKET CLOSED</span><h2>{marketHoursError ? "Market status unavailable" : "The market is closed"}</h2><p>{marketHoursError
          ? "We can't verify the market schedule right now. Please try again shortly."
          : nextMarketOpenAt
            ? `The market will reopen on ${formatMarketOpening(nextMarketOpenAt)} Tanzania time.`
            : "No upcoming opening is currently scheduled."}</p></section>}
      <footer className="site-footer"><span><Image src="/madinimarket-logo.png" alt="" width={906} height={672} /> MADINIMARKET</span><span>Built for a fairer mineral trade.</span><span>PREVIEW MARKET · 2025—26</span></footer>
    </div>

    {notice && <div className="toast" role="status"><span className="toast-mark"><Check size={15} /></span>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={15} /></button></div>}
    {dialog && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setDialog(null); setEditingSubmission(null); } }}><section className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button className="dialog-close" type="button" aria-label="Close dialog" onClick={() => { setDialog(null); setEditingSubmission(null); }}><X size={19} /></button><div className="dialog-brand"><Image src="/madinimarket-designer-logo.png" alt="" width={42} height={42} /><span>MADINIMARKET</span></div>
      {dialog === "signout" && <><div className="dialog-kicker">ACCOUNT</div><h2 id="dialog-title">Sign out?</h2><p className="dialog-copy">Are you sure you want to sign out?</p><div className="signout-actions"><button className="button button-outline" type="button" onClick={() => setDialog(null)}>Cancel</button><button className="button button-dark" type="button" disabled={busyActions.has("account-signout")} onClick={() => void withProgress("account-signout", signOut)}>{busyActions.has("account-signout") ? "Signing out…" : "Sign out"}</button></div></>}
      {dialog === "create" && <><div className="dialog-kicker">ONE ACCOUNT, BOTH SIDES</div><h2 id="dialog-title">Join the market.</h2>{accountCreationDisabled ? <p className="dialog-copy">Account creation is suspended for now. Please try again later.</p> : <><p className="dialog-copy">Create your account to buy, sell, or both. Your delivery address is shared with a seller only after payment is verified for an order.</p><form className="form-stack form-scroll" onSubmit={createAccount}><div className="field-row"><Field label="First name" name="firstName" required autoComplete="given-name" /><Field label="Surname" name="surname" required autoComplete="family-name" /></div><Field label="Email address" name="email" type="email" required autoComplete="email" /><Field label="Phone number" name="phone" type="tel" required autoComplete="tel" /><div className="field-row"><Field label="Country" name="deliveryCountry" required autoComplete="country-name" /><Field label="Region" name="deliveryRegion" required autoComplete="address-level1" /></div><div className="field-row"><Field label="District" name="deliveryDistrict" required autoComplete="address-level2" /><Field label="Street / delivery address" name="deliveryAddress" required autoComplete="street-address" /></div><Field label="Password" name="password" type="password" required minLength={8} autoComplete="new-password" /><button className="button button-dark form-submit" type="submit" disabled={accountCreationDisabled || busyActions.has("account-create")}>{busyActions.has("account-create") ? "Creating account…" : <>Create account <ArrowUpRight size={16} /></>}</button></form><p className="form-footnote">We’ll email your username to the address you provide.</p><button className="switch-dialog" type="button" onClick={() => setDialog("signin")}>      Already registered? <strong>Sign in</strong></button></>}</>}
      {dialog === "signin" && <><div className="dialog-kicker">WELCOME BACK</div><h2 id="dialog-title">Good to see you.</h2><p className="dialog-copy">Sign in with your Madinimarket username.</p><form className="form-stack" onSubmit={signIn}><Field label="Username" name="username" placeholder="MM-1254" required autoComplete="username" /><Field label="Password" name="password" type="password" required autoComplete="current-password" /><button className="button button-dark form-submit" type="submit" disabled={busyActions.has("account-signin")}>{busyActions.has("account-signin") ? "Signing in…" : <>Sign in <ArrowUpRight size={16} /></>}</button></form><p className="form-footnote">{isSupabaseConfigured ? "Use your account username and password to continue." : "Supabase is not configured. This local sign-in is for interface preview only."}</p><button className="switch-dialog" type="button" disabled={nonAdminSignInDisabled} onClick={() => setDialog("forgot-password")}>{nonAdminSignInDisabled ? "Password recovery is currently unavailable" : "Forgot your password?"}</button><button className="switch-dialog" type="button" disabled={accountCreationDisabled} onClick={openAccountCreation}>{accountCreationDisabled ? "Account creation is currently suspended" : <>New to the market? <strong>Create account</strong></>}</button></>}
      {dialog === "forgot-password" && <><div className="dialog-kicker">ACCOUNT RECOVERY</div><h2 id="dialog-title">Reset your password.</h2>{nonAdminSignInDisabled ? <><p className="dialog-copy">Password recovery is currently unavailable while user sign-in is not enabled.</p><button className="switch-dialog" type="button" onClick={() => setDialog("signin")}>Return to <strong>Sign in</strong></button></> : <><p className="dialog-copy">Enter the email address registered to your account. If it matches an active account, we’ll email a secure, one-time reset link. We never email passwords.</p><form className="form-stack" onSubmit={requestPasswordReset}><Field label="Registered email address" name="email" type="email" required autoComplete="email" /><button className="button button-dark form-submit" type="submit" disabled={busyActions.has("password-reset-request")}>{busyActions.has("password-reset-request") ? "Sending link…" : <>Email reset link <ArrowUpRight size={16} /></>}</button></form><button className="switch-dialog" type="button" onClick={() => setDialog("signin")}>Remembered your password? <strong>Sign in</strong></button></>}</>}
      {dialog === "certificate-ready" && <><div className="dialog-kicker">SIGN-IN COMPLETE</div><h2 id="dialog-title">Your certificate is ready.</h2><p className="dialog-copy">The certificate will open in a new tab. Your marketplace dashboard will stay open here.</p><button className="button button-dark form-submit" type="button" onClick={() => { if (certificateReadyListingId !== null) { const certificateTab = window.open("about:blank", "_blank"); if (!certificateTab) setNotice("Allow pop-ups to open this certificate."); else void fetchWithWebsiteSession(`/api/listing-certificate?id=${certificateReadyListingId}`).then(async (response) => { if (!response.ok) throw new Error("Could not open this certificate."); const url = URL.createObjectURL(await response.blob()); certificateTab.location.href = url; window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }).catch((error: unknown) => { certificateTab.close(); setNotice(error instanceof Error ? error.message : "Could not open this certificate."); }); } setCertificateReadyListingId(null); setDialog(null); }}>Open certificate <ArrowUpRight size={16} /></button></>}
      {dialog === "sell" && <>
        <div className="dialog-kicker">SELL A MINERAL</div>
        <h2 id="dialog-title">{editingSeller ? "Edit your listing." : "Submit a listing."}</h2>
        <p className="dialog-copy">An admin must approve the listing before it appears on the market.</p>
        <form className="form-stack form-scroll" onSubmit={addSeller}>
          <Field label="Mineral name" name="mineral" placeholder="e.g. Tanzanite" defaultValue={editingSeller?.mineral ?? ""} required />
          <SelectField label="Listing type" name="listing_type" defaultValue={editingSeller?.listing_type ?? "single"} options={[["single", "Single piece"], ["batch", "Batch"]]} onChange={(value) => setSellerListingType(value as ListingType)} />
          <div className="field-row field-row-weight">
            <Field label={sellerListingType === "batch" ? "Total weight of batch" : "Weight"} name="weight" type="number" min="0.01" step="any" defaultValue={editingSeller?.weight ?? ""} required />
            <SelectField label="Unit" name="unit" defaultValue={editingSeller?.unit ?? ""} options={[["carats", "Carats"], ["g", "Grams"], ["kg", "Kilograms"], ["tons", "Tons"]]} />
          </div>
          {sellerListingType === "batch" && <>
            <div className="field-row field-row-weight">
              <Field label="Smallest stone weight" name="smallest_stone_weight" type="number" min="0.01" step="any" defaultValue={editingSeller?.smallest_stone_weight ?? ""} required />
              <Field label="Largest stone weight" name="largest_stone_weight" type="number" min="0.01" step="any" defaultValue={editingSeller?.largest_stone_weight ?? ""} required />
            </div>
            <SelectField label="Stone weight unit" name="stone_weight_unit" defaultValue={editingSeller?.stone_weight_unit ?? ""} options={[["carats", "Carats"], ["g", "Grams"], ["kg", "Kilograms"]]} />
          </>}
          <div className="field-row field-row-weight">
            <Field label={`Your price (before ${sellerFeePercent.toLocaleString(undefined, { maximumFractionDigits: 2 })}% fee)`} name="price" type="number" min="0.01" step="any" defaultValue={editingSeller?.seller_price ?? editingSeller?.price ?? ""} required />
            <SelectField label="Currency" name="currency" defaultValue={currencyOptions.length > 1 ? editingSeller?.currency ?? "" : editingSeller?.currency === "TZS" ? "TZS" : ""} options={currencyOptions} />
          </div>
          <p className="form-footnote">{editingSeller ? `The original ${sellerFeePercent.toLocaleString(undefined, { maximumFractionDigits: 2 })}% fee stays on this listing. ` : `A ${sellerFeePercent.toLocaleString(undefined, { maximumFractionDigits: 2 })}% fee applies to new listings. `}Buyers see the total; your entered amount is the seller portion.</p>
          {sellerImagePreviewUrl && <figure className="seller-image-preview"><Image src={sellerImagePreviewUrl} fill sizes="180px" unoptimized alt="Selected mineral" /></figure>}
          <label className="field-label">Square mineral photo<input className="file-input" name="image" type="file" accept="image/png,image/jpeg" required={!editingSeller?.image && !editingSeller?.image_path} /><span className="file-drop"><Plus size={17} /><span>{editingSeller?.image || editingSeller?.image_path ? "Choose a replacement PNG or JPG" : "Choose PNG or JPG"}</span><small>Square crop looks best</small></span></label>
          <StoneCertificateField />
          <Field label="Seller name" name="seller" defaultValue={editingSeller?.seller ?? ""} required />
          <div className="field-row">
            <Field label="Country" name="country" defaultValue={editingSeller?.country ?? ""} required />
            <Field label="Region" name="region" defaultValue={editingSeller?.region ?? ""} required />
          </div>
          <div className="field-row">
            <Field label="District" name="district" defaultValue={editingSeller?.district ?? ""} required />
            <Field label="Street" name="street" defaultValue={editingSeller?.street ?? ""} required />
          </div>
          <div className="field-row">
            <Field label="Email address" name="email" type="email" defaultValue={editingSeller?.email ?? ""} required />
            <Field label="Phone number" name="phone" type="tel" defaultValue={editingSeller?.phone ?? ""} required />
          </div>
          <button className="button button-dark form-submit" type="submit" disabled={busyActions.has("seller-submit")}>{busyActions.has("seller-submit") ? (editingSeller ? "Resubmitting listing…" : "Submitting for approval…") : editingSeller ? "Resubmit for approval" : <>Submit for approval <ArrowUpRight size={16} /></>}</button>
          {editingSeller && <button className="button button-outline form-submit" type="button" disabled={busyActions.has("seller-submit")} onClick={() => { setEditingSubmission(null); setSellerImagePreview(null); setDialog("submissions"); }}>Cancel</button>}
        </form>
      </>}
      {dialog === "buy" && <>
        <div className="dialog-kicker">POST A BUYING REQUEST</div>
        <h2 id="dialog-title">{editingBuyer ? "Edit your request." : "Submit a request."}</h2>
        <p className="dialog-copy">An admin must approve the request before it appears on the market.</p>
        <form className="form-stack form-scroll" onSubmit={addBuyer}>
          <Field label="Mineral name" name="mineral" placeholder="e.g. Blue sapphire" defaultValue={editingBuyer?.mineral ?? ""} required />
          <div className="field-row field-row-weight">
            <Field label="Desired weight" name="weight" placeholder="e.g. 25–50" defaultValue={editingBuyer?.weight ?? ""} required />
            <SelectField label="Unit" name="unit" defaultValue={editingBuyer?.unit ?? ""} options={[["carats", "Carats"], ["g", "Grams"], ["kg", "Kilograms"], ["tons", "Tons"]]} />
          </div>
          <div className="field-row">
            <Field label="Colour" name="color" placeholder="e.g. Deep blue" defaultValue={editingBuyer?.color ?? ""} required />
            <SelectField label="Shape" name="shape" defaultValue={editingBuyer?.shape ?? ""} options={[["Cut", "Cut"], ["Uncut", "Uncut"]]} />
          </div>
          <Field label="Quality" name="quality" placeholder="e.g. Eye-clean, AAA" defaultValue={editingBuyer?.quality ?? ""} required />
          <div className="field-row field-row-weight">
            <Field label="Offer price" name="offer" type="number" min="0.01" step="any" defaultValue={editingBuyer?.offer ?? ""} required />
            <SelectField label="Currency" name="currency" defaultValue={currencyOptions.length > 1 ? editingBuyer?.currency ?? "" : editingBuyer?.currency === "TZS" ? "TZS" : ""} options={currencyOptions} />
          </div>
          <Field label="Buyer name" name="buyer" defaultValue={editingBuyer?.buyer ?? ""} required />
          <Field label="Location" name="location" placeholder="City, region" defaultValue={editingBuyer?.location ?? ""} required />
          <div className="field-row">
            <Field label="Email address" name="email" type="email" defaultValue={editingBuyer?.email ?? ""} required />
            <Field label="Phone number" name="phone" type="tel" defaultValue={editingBuyer?.phone ?? ""} required />
          </div>
          <button className="button button-dark form-submit" type="submit" disabled={busyActions.has("buyer-submit")}>{busyActions.has("buyer-submit") ? (editingBuyer ? "Updating request…" : "Submitting request…") : editingBuyer ? "Resubmit for approval" : <>Submit for approval <ArrowUpRight size={16} /></>}</button>
          {editingBuyer && <button className="button button-outline form-submit" type="button" disabled={busyActions.has("buyer-submit")} onClick={() => { setEditingSubmission(null); setDialog("submissions"); }}>Cancel</button>}
        </form>
      </>}
      {dialog === "subscription" && role === "user" && <>
        <div className="dialog-kicker">YOUR ACCOUNT</div>
        <h2 id="dialog-title">Seller/buyer subscription</h2>
        <p className="dialog-copy">An approved listing or buying request appears on the market only while your account subscription is active. Each month is 30 days; the subscription begins when the admin confirms your payment.</p>
        {!userSubscriptionLoaded ? <p className="admin-empty">Loading subscription options…</p> : userSubscriptionError ? <div className="user-subscription-status is-rejected"><strong>Could not load subscription information</strong><span>{userSubscriptionError}</span><button className="button button-outline" type="button" onClick={() => void loadUserSubscriptions()}>Try again</button></div> : <>
          <section className="subscription-payment-instructions" aria-labelledby="subscription-payment-heading">
            <h3 id="subscription-payment-heading">Payment methods and instructions</h3>
            {subscriptionPaymentMethods.length ? <div className="commerce-payment-method-list">{subscriptionPaymentMethods.map((method, index) => <details className="commerce-payment-method" key={`${method.method}-${index}`}>
              <summary>{method.method}</summary><span>{method.accountNumber}</span>
            </details>)}</div> : <p>No payment methods have been added yet. Please check back later.</p>}
            {subscriptionPaymentInstructions && <div className="commerce-payment-general-instructions"><strong>Additional instructions</strong><p>{subscriptionPaymentInstructions}</p></div>}
          </section>
          {activeSubscription && <div className="user-subscription-status is-active">
            <strong>Subscription active · {activeSubscription.months} month{activeSubscription.months === 1 ? "" : "s"}</strong>
            <span>Started {activeSubscription.starts_at ? new Date(activeSubscription.starts_at).toLocaleString() : "—"} · Expires {activeSubscription.expires_at ? new Date(activeSubscription.expires_at).toLocaleString() : "—"}</span>
            <span>Paid {money(Number(activeSubscription.amount).toFixed(activeSubscription.currency === "USD" ? 2 : 0), activeSubscription.currency)}</span>
          </div>}
          {scheduledSubscription && <div className="user-subscription-status is-scheduled">
            <strong>Next subscription scheduled · {scheduledSubscription.months} month{scheduledSubscription.months === 1 ? "" : "s"}</strong>
            <span>Starts {scheduledSubscription.starts_at ? new Date(scheduledSubscription.starts_at).toLocaleString() : "—"} · Expires {scheduledSubscription.expires_at ? new Date(scheduledSubscription.expires_at).toLocaleString() : "—"}</span>
            <span>Your current subscription remains active until its expiry. Paid {money(Number(scheduledSubscription.amount).toFixed(scheduledSubscription.currency === "USD" ? 2 : 0), scheduledSubscription.currency)}.</span>
          </div>}
          {pendingUserSubscription && <div className="user-subscription-status is-pending">
            <strong>Payment awaiting admin confirmation</strong>
            <span>{pendingUserSubscription.months} month{pendingUserSubscription.months === 1 ? "" : "s"} · {money(Number(pendingUserSubscription.amount).toFixed(pendingUserSubscription.currency === "USD" ? 2 : 0), pendingUserSubscription.currency)} · Requested {new Date(pendingUserSubscription.requested_at).toLocaleString()}</span>
            {pendingUserSubscription.payment_reference && <span>Payment reference: {pendingUserSubscription.payment_reference}</span>}
            <span>Your subscription period starts after the admin confirms the payment.</span>
          </div>}
          {!activeSubscription && !pendingUserSubscription && previousSubscription && <div className={`user-subscription-status is-${previousSubscription.status}`}>
            <strong>{previousSubscription.status === "expired" ? "Your subscription has expired" : "Subscription request rejected — you are not subscribed"}</strong>
            {previousSubscription.status === "expired" && previousSubscription.expires_at && <span>It expired {new Date(previousSubscription.expires_at).toLocaleString()}.</span>}
            {previousSubscription.status === "rejected" && previousSubscription.review_note && <span>Admin’s reason: {previousSubscription.review_note}</span>}
            {previousSubscription.status === "rejected" && <span>The rejection ends that payment request. Submit a corrected request with a new payment reference and receipt.</span>}
          </div>}
          <div className="user-subscription-plan-list">
            {userSubscriptionPlans.map((plan) => {
              const now = lastUpdated?.getTime() ?? 0;
              const currentActive = Boolean(activeSubscription?.expires_at && Date.parse(activeSubscription.expires_at) > now);
              const hasValidScheduled = Boolean(scheduledSubscription?.expires_at && Date.parse(scheduledSubscription.expires_at) > now);
              const isCurrentPlan = (currentActive && activeSubscription?.plan_id === plan.id) || (hasValidScheduled && scheduledSubscription?.plan_id === plan.id);
              const planLocked = Boolean(pendingUserSubscription) || hasValidScheduled || currentActive;
              const planStatus = currentActive && activeSubscription?.plan_id === plan.id
                ? "Current plan"
                : hasValidScheduled && scheduledSubscription?.plan_id === plan.id
                  ? "Scheduled plan"
                  : null;
              return <article className={`user-subscription-plan${isCurrentPlan ? " is-current" : ""}`} key={plan.id}>
                <div className="user-subscription-plan-heading"><strong>{plan.months} month{plan.months === 1 ? "" : "s"}</strong>{planStatus && <span>{planStatus}</span>}</div>
                <div className="user-subscription-prices"><span>{money(Number(plan.price_tzs).toFixed(0), "TZS")}</span><span>${Number(plan.price_usd).toFixed(2)} USD</span></div>
                <div className="user-subscription-actions">
                  <button className="button button-dark" type="button" disabled={planLocked || busyActions.has(`subscription-request-${plan.id}`)} onClick={() => { setSelectedSubscriptionRequest({ planId: plan.id, currency: "TZS" }); setSubscriptionReceiptName(""); }}>{currentActive ? "Already subscribed" : hasValidScheduled ? "Already scheduled" : pendingUserSubscription ? "Awaiting confirmation" : "Choose TSh"}</button>
                  <button className="button button-outline" type="button" disabled={planLocked || !usdEnabled || busyActions.has(`subscription-request-${plan.id}`)} onClick={() => { setSelectedSubscriptionRequest({ planId: plan.id, currency: "USD" }); setSubscriptionReceiptName(""); }}>{currentActive ? "Already subscribed" : hasValidScheduled ? "Already scheduled" : pendingUserSubscription ? "Awaiting confirmation" : !usdEnabled ? "USD unavailable" : "Choose USD"}</button>
                </div>
                {selectedSubscriptionRequest?.planId === plan.id && !planLocked && <form className="user-subscription-request-form" onSubmit={(event) => void requestSubscription(event, plan)}>
                  <input type="hidden" name="planId" value={plan.id} />
                  <input type="hidden" name="currency" value={selectedSubscriptionRequest.currency} />
                  <p>After paying <strong>{money(Number(selectedSubscriptionRequest.currency === "USD" ? plan.price_usd : plan.price_tzs).toFixed(selectedSubscriptionRequest.currency === "USD" ? 2 : 0), selectedSubscriptionRequest.currency)}</strong>, enter the transaction reference and attach the receipt.</p>
                  <label className="field-label">Payment reference<input className="text-input" name="paymentReference" type="text" minLength={3} maxLength={120} required autoComplete="off" /></label>
                  <label className="field-label">Payment receipt (PDF, JPEG, or PNG)<input className="text-input" name="paymentReceipt" type="file" accept="application/pdf,image/jpeg,image/png" required onChange={(event) => setSubscriptionReceiptName(event.currentTarget.files?.[0]?.name ?? "")} /></label>
                  {subscriptionReceiptName && <span className="user-subscription-receipt-name">Selected: {subscriptionReceiptName}</span>}
                  <span className="user-subscription-receipt-help">Maximum file size: 4 MB.</span>
                  <div className="user-subscription-request-actions"><button className="button button-dark" type="submit" disabled={busyActions.has(`subscription-request-${plan.id}`)}>{busyActions.has(`subscription-request-${plan.id}`) ? "Submitting…" : "Submit for confirmation"}</button><button className="button button-outline" type="button" onClick={() => { setSelectedSubscriptionRequest(null); setSubscriptionReceiptName(""); }}>Cancel</button></div>
                </form>}
              </article>;
            })}
          </div>
          {!userSubscriptionPlans.length && <p className="admin-empty">No subscription plans are available yet. Please check again later.</p>}
        </>}
      </>}
      {dialog === "support" && role === "user" && <SupportInbox onNotice={setNotice} />}
      {dialog === "commerce" && <CommercePanel onNotice={setNotice} onCounters={updateAccountMenuCounts} />}
      {dialog === "private-offer" && privateOfferRequest && <><div className="dialog-kicker">PRIVATE OFFER · REQUEST #{privateOfferRequest.id}</div><h2 id="dialog-title">Offer a mineral privately.</h2><p className="dialog-copy">Send a mineral card and price to this buyer. Your contact details stay private. The current marketplace fee is saved with this offer and included in the buyer total.</p><div className="private-offer-request-summary"><strong>{privateOfferRequest.mineral}</strong><span>{privateOfferRequest.weight} {privateOfferRequest.unit} · {privateOfferRequest.color} · {privateOfferRequest.shape} · {privateOfferRequest.quality}</span><span>Buyer’s request offer: {money(privateOfferRequest.offer, privateOfferRequest.currency)}</span></div>{listingFeeSettingsLoaded ? <PrivateOfferForm requestId={privateOfferRequest.id} threadId={null} feeRate={listingFeePercent / 100} usdEnabled={usdEnabled && currencySettingsLoaded} defaultCurrency={usdEnabled && currencySettingsLoaded ? privateOfferRequest.currency : "TZS"} submitting={busyActions.has("private-offer-submit")} onSubmit={(details) => void sendPrivateOffer(details)} /> : <p className="admin-empty">Loading current marketplace pricing…</p>}</>}
      {dialog === "submissions" && <><div className="dialog-kicker">YOUR ACCOUNT</div><h2 id="dialog-title">Your submissions</h2><p className="dialog-copy">Pending items are waiting for admin review. Rejected items can be edited or deleted.</p>
        <div className="user-account-list-tools"><label className="user-account-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search submissions by mineral" placeholder="Search submissions" value={userAccountListSearch} onChange={(event) => { setUserAccountListSearch(event.target.value); setUserAccountListPage(1); accountListScroll.current.submissions = 0; if (submissionsListRef.current) submissionsListRef.current.scrollTop = 0; }} /></label>
          <div className="user-account-filter-buttons" aria-label="Filter submissions">{(["all", "pending", "rejected"] as const).map((filter) => <button type="button" className={userAccountListFilter === filter ? "is-selected" : ""} aria-pressed={userAccountListFilter === filter} key={filter} onClick={() => { setUserAccountListFilter(filter); setUserAccountListPage(1); accountListScroll.current.submissions = 0; if (submissionsListRef.current) submissionsListRef.current.scrollTop = 0; }}>{filter === "all" ? "All" : filter === "pending" ? "Pending" : "Rejected"}</button>)}</div>
        </div>
        <div className="submission-list account-scroll-list user-account-records" ref={submissionsListRef} onScroll={(event) => { accountListScroll.current.submissions = event.currentTarget.scrollTop; }}>
          {visibleAccountSubmissions.map(({ kind, item }) => <details className="user-account-record" key={`${kind}-${item.id}`}>
            <summary><span><strong data-no-translate>{item.mineral}</strong><small>{kind === "seller" ? "Seller listing" : "Buyer request"}</small></span><span className={`submission-status status-${item.status}`}>{item.status}</span><ChevronDown size={16} aria-hidden="true" /></summary>
            <div className="user-account-record-details">
              {kind === "seller" ? <>
                <p data-no-translate>{item.listing_type === "batch" ? "Batch total: " : ""}{item.weight} {item.unit} · Market price: {money(item.price, item.currency)}</p>
                {item.platform_fee_rate ? <p data-no-translate>{sellerPriceDetails(item)} ({(item.platform_fee_rate * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}% fee)</p> : null}
                {item.listing_type === "batch" && <p data-no-translate>Stone weights: {item.smallest_stone_weight}–{item.largest_stone_weight} {item.stone_weight_unit}</p>}
              </> : <p data-no-translate>{item.weight} {item.unit} · {money(item.offer, item.currency)}</p>}
              {item.review_message && <p className="submission-message"><span>Admin message: </span><span data-no-translate>{item.review_message}</span></p>}
              <div className="submission-actions">
                <button type="button" className="button button-outline" onClick={() => void editSubmission(kind, item)} disabled={item.status === "pending" || busyActions.has(`submission-delete-${kind}-${item.id}`) || busyActions.has(`submission-edit-${kind}-${item.id}`)}>{busyActions.has(`submission-edit-${kind}-${item.id}`) ? "Loading submission…" : "Edit"}</button>
                <button type="button" className="button button-danger" onClick={() => void withProgress(`submission-delete-${kind}-${item.id}`, () => deleteSubmission(kind, item))} disabled={item.status === "pending" || busyActions.has(`submission-delete-${kind}-${item.id}`)}>{busyActions.has(`submission-delete-${kind}-${item.id}`) ? "Deleting…" : "Delete"}</button>
              </div>
            </div>
          </details>)}
          {!accountSubmissionEntries.length && <div className="empty-search">You have no pending or rejected submissions.</div>}
          {accountSubmissionEntries.length > 0 && !visibleAccountSubmissions.length && <div className="empty-search">No submissions match your search and status filter.</div>}
        </div>
        {filteredAccountSubmissions.length > 0 && <div className="user-account-pagination"><span>Showing {userAccountListStart + 1}–{Math.min(userAccountListStart + userAccountPageSize, filteredAccountSubmissions.length)} of {filteredAccountSubmissions.length} submissions</span><div><button className="button button-outline" type="button" disabled={activeUserAccountPage <= 1} onClick={() => { accountListScroll.current.submissions = 0; setUserAccountListPage((page) => Math.max(1, page - 1)); }}>Previous</button><span>Page {activeUserAccountPage} of {userAccountPageCount}</span><button className="button button-outline" type="button" disabled={activeUserAccountPage >= userAccountPageCount} onClick={() => { accountListScroll.current.submissions = 0; setUserAccountListPage((page) => Math.min(userAccountPageCount, page + 1)); }}>Next</button></div></div>}
      </>}
      {dialog === "my-market-minerals" && <><div className="dialog-kicker">YOUR SELLING MARKET</div><h2 id="dialog-title">My minerals on market</h2><p className="dialog-copy">These are your approved mineral listings currently visible on the selling market.</p>
        <label className="user-account-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search your market listings" placeholder="Search minerals or location" value={userAccountListSearch} onChange={(event) => { setUserAccountListSearch(event.target.value); setUserAccountListPage(1); accountListScroll.current.market = 0; if (marketListRef.current) marketListRef.current.scrollTop = 0; }} /></label>
        <div className="submission-list account-scroll-list user-account-records" ref={marketListRef} onScroll={(event) => { accountListScroll.current.market = event.currentTarget.scrollTop; }}>
          {visibleMarketMinerals.map((item) => <details className="user-account-record" key={`market-mineral-${item.id}`}>
            <summary><span><strong data-no-translate>{item.mineral}</strong><small>{item.listing_type === "batch" ? "Batch · " : ""}{item.weight} {item.unit} · {money(item.price, item.currency)}</small></span><span className="submission-status status-approved">On market</span><ChevronDown size={16} aria-hidden="true" /></summary>
            <div className="user-account-record-details account-market-item">
              {item.image && <div className="account-market-image"><Image src={item.image} alt={`${item.mineral} listing`} fill sizes="88px" unoptimized /></div>}
              <div className="account-market-details">
                {item.platform_fee_rate ? <p data-no-translate>{sellerPriceDetails(item)} ({(item.platform_fee_rate * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}% fee)</p> : null}
                {item.listing_type === "batch" && <p data-no-translate>Stone weights: {item.smallest_stone_weight}–{item.largest_stone_weight} {item.stone_weight_unit}</p>}
                <p data-no-translate>{item.location}</p>
              </div>
            </div>
          </details>)}
          {!myMarketMinerals.length && <div className="empty-search">You have no approved minerals currently on the selling market.</div>}
          {myMarketMinerals.length > 0 && !visibleMarketMinerals.length && <div className="empty-search">No listings match your search.</div>}
        </div>
        {filteredMarketMinerals.length > 0 && <div className="user-account-pagination"><span>Showing {userAccountListStart + 1}–{Math.min(userAccountListStart + userAccountPageSize, filteredMarketMinerals.length)} of {filteredMarketMinerals.length} listings</span><div><button className="button button-outline" type="button" disabled={activeUserAccountPage <= 1} onClick={() => { accountListScroll.current.market = 0; setUserAccountListPage((page) => Math.max(1, page - 1)); }}>Previous</button><span>Page {activeUserAccountPage} of {userAccountPageCount}</span><button className="button button-outline" type="button" disabled={activeUserAccountPage >= userAccountPageCount} onClick={() => { accountListScroll.current.market = 0; setUserAccountListPage((page) => Math.min(userAccountPageCount, page + 1)); }}>Next</button></div></div>}
      </>}
      {dialog === "my-wanted-minerals" && <><div className="dialog-kicker">YOUR BUYER REQUESTS</div><h2 id="dialog-title">Minerals am Looking to Buy</h2><p className="dialog-copy">Sellers who have matching minerals can submit offers</p>
        <label className="user-account-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search your approved buyer requests" placeholder="Search minerals or location" value={userAccountListSearch} onChange={(event) => { setUserAccountListSearch(event.target.value); setUserAccountListPage(1); accountListScroll.current.wanted = 0; if (wantedListRef.current) wantedListRef.current.scrollTop = 0; }} /></label>
        <div className="submission-list account-scroll-list user-account-records" ref={wantedListRef} onScroll={(event) => { accountListScroll.current.wanted = event.currentTarget.scrollTop; }}>
          {visibleWantedMinerals.map((item) => <details className="user-account-record" key={`wanted-mineral-${item.id}`}>
            <summary><span><strong data-no-translate>{item.mineral}</strong><small>{item.weight} {item.unit} · {money(item.offer, item.currency)}</small></span><span className={`submission-status ${item.marketplace_status === "temporarily_unavailable" ? "status-pending" : "status-approved"}`}>{item.marketplace_status === "temporarily_unavailable" ? "Temporarily unavailable" : "Looking to buy"}</span><ChevronDown size={16} aria-hidden="true" /></summary>
            <div className="user-account-record-details"><p data-no-translate>{item.color} · {item.shape} · {item.quality}</p><p data-no-translate>{item.location}</p></div>
          </details>)}
          {!myWantedMinerals.length && <div className="empty-search">You have no approved buying requests.</div>}
          {myWantedMinerals.length > 0 && !visibleWantedMinerals.length && <div className="empty-search">No requests match your search.</div>}
        </div>
        {filteredWantedMinerals.length > 0 && <div className="user-account-pagination"><span>Showing {userAccountListStart + 1}–{Math.min(userAccountListStart + userAccountPageSize, filteredWantedMinerals.length)} of {filteredWantedMinerals.length} requests</span><div><button className="button button-outline" type="button" disabled={activeUserAccountPage <= 1} onClick={() => { accountListScroll.current.wanted = 0; setUserAccountListPage((page) => Math.max(1, page - 1)); }}>Previous</button><span>Page {activeUserAccountPage} of {userAccountPageCount}</span><button className="button button-outline" type="button" disabled={activeUserAccountPage >= userAccountPageCount} onClick={() => { accountListScroll.current.wanted = 0; setUserAccountListPage((page) => Math.min(userAccountPageCount, page + 1)); }}>Next</button></div></div>}
      </>}
      {dialog === "my-licenses" && role === "user" && <><div className="dialog-kicker">SELLER VERIFICATION</div><h2 id="dialog-title">Your licences</h2><p className="dialog-copy">At least one approved licence is required to list a mineral.</p><div className="certificate-options certificate-options-account">{(["dealer", "broker"] as const).map((kind) => {
        const certificate = certificates[kind];
        const canUpload = !certificate || certificate.status === "rejected";
        const title = kind === "dealer" ? "Dealer licence" : "Broker licence";
        return <details className="certificate-option user-license-disclosure" key={kind}>
          <summary className="certificate-option-heading"><h3>{title}</h3><span className={`submission-status status-${certificate?.status ?? "empty"}`}>{certificate?.status ?? "Not submitted"}</span><ChevronDown size={16} aria-hidden="true" /></summary>
          {certificate?.review_message && <p className="submission-message">Admin rejection reason: {certificate.review_message}</p>}
          {certificate && <a className="certificate-file-link" href={certificate.signed_url} target="_blank" rel="noreferrer">View {certificate.file_name}</a>}
          {canUpload && <><label className="field-label certificate-file-label">Upload PDF, JPEG, or PNG<input className="certificate-file-input" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file && (file.size > 10 * 1024 * 1024 || !["application/pdf", "image/jpeg", "image/png"].includes(file.type))) {
              setNotice("Choose a PDF, JPEG, or PNG file no larger than 10 MB.");
              event.currentTarget.value = "";
              setCertificateFiles((current) => ({ ...current, [kind]: undefined }));
              return;
            }
            setCertificateFiles((current) => ({ ...current, [kind]: file }));
          }} /><span className="certificate-file-name">{certificateFiles[kind]?.name ?? "Choose a file"}</span></label>
          <button className="button button-dark" type="button" disabled={!certificateFiles[kind] || busyCertificate === kind} onClick={() => void submitCertificate(kind)}>{busyCertificate === kind ? "Submitting for verification…" : "Submit for verification"}</button></>}
          {certificate?.status === "pending" && <p className="certificate-status-note">Received by the admin. Submission is locked while verification is pending.</p>}
          {certificate?.status === "approved" && <p className="certificate-status-note">Verified. Your account is enabled to list minerals.</p>}
        </details>;
      })}</div></>}
      {dialog === "review" && role === "admin" && <><div className="dialog-kicker">ADMIN REVIEW</div><h2 id="dialog-title">Review queue</h2><p className="dialog-copy">Approved items appear on the market. Rejected items return to their owner with your message.</p><div className="submission-list">{pendingSellers.map((item) => <article className="submission-item review-item" key={`review-seller-${item.id}`}><div className="submission-title"><h3>{item.mineral}</h3><span className="submission-status status-pending">Seller listing</span></div><p>{item.listing_type === "batch" ? "Batch total: " : ""}{item.weight} {item.unit} · {money(item.price, item.currency)} · {item.seller}</p>{item.listing_type === "batch" && <p>Stone weights: {item.smallest_stone_weight}–{item.largest_stone_weight} {item.stone_weight_unit}</p>}<p>{item.location} · {item.phone} · {item.email}</p><textarea className="review-message" aria-label={`Rejection message for ${item.mineral}`} placeholder="Message to seller (required to reject)" value={rejectionMessages[`seller-${item.id}`] ?? ""} onChange={(event) => updateReviewMessage(`seller-${item.id}`, event.target.value)} /><div className="submission-actions"><button className="button button-dark" type="button" onClick={() => void reviewSubmission("seller", item.id, true)}>Approve</button><button className="button button-outline" type="button" onClick={() => void reviewSubmission("seller", item.id, false)}>Reject</button></div></article>)}{pendingBuyers.map((item) => <article className="submission-item review-item" key={`review-buyer-${item.id}`}><div className="submission-title"><h3>{item.mineral}</h3><span className="submission-status status-pending">Buyer request</span></div><p>{item.weight} {item.unit} · {item.color} · {item.shape} · {item.quality}</p><p>{money(item.offer, item.currency)} · {item.buyer} · {item.phone} · {item.email}</p><textarea className="review-message" aria-label={`Rejection message for ${item.mineral}`} placeholder="Message to buyer (required to reject)" value={rejectionMessages[`buyer-${item.id}`] ?? ""} onChange={(event) => updateReviewMessage(`buyer-${item.id}`, event.target.value)} /><div className="submission-actions"><button className="button button-dark" type="button" onClick={() => void reviewSubmission("buyer", item.id, true)}>Approve</button><button className="button button-outline" type="button" onClick={() => void reviewSubmission("buyer", item.id, false)}>Reject</button></div></article>)}{!pendingSellers.length && !pendingBuyers.length && <div className="empty-search">The review queue is clear.</div>}</div></>}
    </section></div>}
  </main>;
}

function Field(props: { label: string; name: string; type?: string; required?: boolean; placeholder?: string; autoComplete?: string; min?: string; step?: string; minLength?: number; pattern?: string; defaultValue?: string }) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const { label, ...inputProps } = props;
  if (inputProps.type !== "password") {
    return <label className="field-label">{label}<input className="text-input" {...inputProps} /></label>;
  }

  return <label className="field-label">{label}<span className="password-input-wrap"><input className="text-input" {...inputProps} type={passwordVisible ? "text" : "password"} /><button className="password-visibility" type="button" aria-label={passwordVisible ? "Hide password" : "Show password"} aria-pressed={passwordVisible} onClick={() => setPasswordVisible((visible) => !visible)}>{passwordVisible ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label>;
}

function StoneCertificateField() {
  const [fileName, setFileName] = useState("");
  return <label className="field-label">Stone certificate (optional)<input className="file-input" name="stoneCertificate" type="file" accept="application/pdf,image/jpeg,.pdf,.jpg,.jpeg" onChange={(event) => setFileName(event.currentTarget.files?.[0]?.name ?? "")} /><span className="file-drop"><Plus size={17} /><span>{fileName || "Choose PDF or JPEG"}</span><small>Optional · max 10 MB</small></span></label>;
}
function SelectField({ label, name, options, defaultValue = "", onChange }: { label: string; name: string; options: [string, string][]; defaultValue?: string; onChange?: (value: string) => void }) {
  return <label className="field-label">{label}<span className="select-wrap"><select className="text-input" name={name} defaultValue={defaultValue} required onChange={(event) => onChange?.(event.currentTarget.value)}><option value="" disabled>Select {label.toLowerCase()}</option>{options.map(([value, text]) => <option value={value} key={value}>{text}</option>)}</select><ChevronDown size={15} /></span></label>;
}
