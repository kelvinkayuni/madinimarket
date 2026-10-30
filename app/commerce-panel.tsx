"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Image from "next/image";
import PrivateOfferForm from "./private-offer-form";
import { fetchWithWebsiteSession } from "@/lib/client-website-session";

type Currency = "TZS" | "USD";
type CartListing = {
  id: number;
  mineral_name: string;
  listing_type: string;
  weight: number;
  unit: string;
  price: number | string;
  currency: Currency;
  image_path: string | null;
  seller_name: string;
  status: string;
  is_active: boolean;
  marketplace_state: string;
};
type CartItem = { id: string; listing_id: number; listing: CartListing | null };
type OrderItem = {
  id: string;
  listing_id: number | null;
  mineral_name: string;
  weight: number;
  unit: string;
  total_price: string | number;
  seller_amount: string | number;
  platform_fee_amount: string | number;
  currency: Currency;
  status: string;
  seller_response_timed_out?: boolean;
  seller_response_deadline: string;
  seller_responded_at: string | null;
  shipping_carrier: string | null;
  tracking_number: string | null;
  delivered_at: string | null;
  disputed_at: string | null;
  dispute_reason: string | null;
  payout_reference: string | null;
  payout_receipt_url?: string | null;
  order?: {
    id: string;
    control_number: string;
    payment_status: string;
    payment_deadline: string | null;
    currency: Currency;
    buyer_name?: string;
    buyer_phone?: string;
    delivery_country?: string;
    delivery_region?: string;
    delivery_district?: string;
    delivery_address?: string;
  };
};
type BuyerOrder = {
  id: string;
  control_number: string;
  payment_status: string;
  payment_deadline: string | null;
  payment_reference: string | null;
  payment_note: string | null;
  total_amount: string | number;
  currency: Currency;
  seller_response_deadline: string;
  items: OrderItem[];
};
type PrivateOffer = {
  id: string;
  attempt_number: number;
  mineral_name: string;
  listing_type: string;
  weight: number;
  unit: string;
  smallest_stone_weight: number | null;
  largest_stone_weight: number | null;
  stone_weight_unit: string | null;
  color: string;
  shape: string;
  quality: string;
  country: string;
  region: string;
  district: string;
  seller_amount?: string | number;
  platform_fee_rate?: string | number;
  platform_fee_amount?: string | number;
  total_price: string | number;
  currency: Currency;
  status: string;
  availability_confirmed_at?: string | null;
  checkout_deadline?: string | null;
  signed_image_url: string | null;
  signed_certificate_url: string | null;
  certificate_file_name: string | null;
  certificate_content_type: string | null;
  decline_reason: string | null;
  decline_explanation: string | null;
};
type PrivateOfferThread = {
  id: string;
  request_id: number;
  side: "buyer" | "seller";
  state: string;
  close_reason: string | null;
  attempt_count: number;
  seller_username: string;
  request: { mineral_name: string; weight: string | number; unit: string; color: string; shape: string; quality: string; offer: string | number; currency: Currency; location: string } | null;
  offers: PrivateOffer[];
};
type CommerceData = {
  profile: {
    display_name: string;
    email: string;
    phone: string | null;
    delivery_country: string | null;
    delivery_region: string | null;
    delivery_district: string | null;
    delivery_address: string | null;
  };
  cartItems: CartItem[];
  buyerOrders: BuyerOrder[];
  sellerItems: OrderItem[];
  buyerOrdersHasMore: boolean;
  sellerItemsHasMore: boolean;
  sellerOpenOrdersCount: number;
  buyerOpenOrdersCount: number;
  buyerHistoryCount: number;
  sellerHistoryItemCount: number;
  privateOffersCount: number;
  sellingCount: number;
  buyingCount: number;
  paymentMethods: { method: string; accountNumber: string }[];
  paymentInstructions: string;
  privateOffers: { threads: PrivateOfferThread[]; feeRate: number | null; usdEnabled: boolean };
};

type CommerceCounters = Pick<CommerceData, "sellerOpenOrdersCount" | "buyerOpenOrdersCount" | "privateOffersCount" | "sellingCount" | "buyingCount"> & {
  cartListingIds: number[];
};
type CommercePanelTab = "offers" | "cart" | "buying" | "selling";

function amount(value: number | string, currency: Currency) {
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: currency === "USD" ? 2 : 0,
    maximumFractionDigits: currency === "USD" ? 2 : 0,
  }).format(Number(value));
  return `${currency === "TZS" ? "TSh" : "$"} ${formatted}`;
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function buyerOrderStatusLabel(order: BuyerOrder) {
  if (order.items.some((item) => item.status === "delivered")) return "After your order is delivered, confirm receipt.";
  if (order.items.some((item) => item.status === "shipped")) return "Your order has shipped. Check the tracking details for updates.";
  const status = order.payment_status;
  if (status === "awaiting_sellers" || status === "awaiting_seller") return "Awaiting seller to confirm availability";
  if (status === "awaiting_payment") return "Awaiting you to pay";
  if (status === "payment_submitted") return "You submitted payment for verification";
  if (status === "paid") return "Your payment is verified. Awaiting seller to dispatch your order.";
  return statusLabel(status);
}

function privateOfferStatusLabel(status: string, side: "buyer" | "seller", closeReason?: string | null, threadState?: string) {
  if (status === "pending") return side === "buyer" ? "New offer · review needed" : "Waiting for buyer response";
  if (status === "accepted") return side === "buyer" ? "Seller finalizing mineral details" : "Your confirmation is needed";
  if (status === "declined") return side === "buyer" ? "You declined this offer" : "Buyer declined your offer";
  if (status === "awaiting_buyer_checkout") return side === "buyer" ? "Accepted · checkout required" : "Buyer accepted · checkout pending";
  if (status === "ordered") return "Order placed · see My orders";
  if (status === "closed" && threadState === "open") return "Checkout cancelled · request reopened";
  if (status === "closed" && closeReason === "buyer_checkout_expired") return "Checkout expired · request reopened";
  if (status === "closed" && closeReason === "buyer_cancelled_checkout") return "Checkout cancelled · request reopened";
  if (status === "closed") return "Offer closed";
  return statusLabel(status);
}

function offerDifference(requestOffer: string | number, sellerOffer: string | number, currency: Currency, side: "buyer" | "seller") {
  const requested = Number(requestOffer);
  const seller = Number(sellerOffer);
  if (!Number.isFinite(requested) || !Number.isFinite(seller)) return null;
  const difference = seller - requested;
  if (difference === 0) return side === "seller"
    ? "Your offer matches the buyer’s original request."
    : "Seller offer matches your requested offer.";
  const absoluteDifference = amount(Math.abs(difference), currency);
  if (side === "seller") {
    return difference > 0
      ? `Your offer is ${absoluteDifference} higher than the buyer’s original request.`
      : `Your offer is ${absoluteDifference} lower than the buyer’s original request.`;
  }
  return difference > 0
    ? `Seller offer is ${absoluteDifference} higher than your request.`
    : `Seller offer is ${absoluteDifference} lower than your request.`;
}

const completedOrderItemStatuses = new Set(["unavailable", "payout_paid", "refunded", "expired", "cancelled"]);

function isBuyerOrderHistory(order: BuyerOrder) {
  if (["expired", "cancelled"].includes(order.payment_status)) return true;
  return order.payment_status === "paid" && order.items.length > 0 &&
    order.items.every((item) => completedOrderItemStatuses.has(item.status));
}

function buyerOrderHistoryLabel(order: BuyerOrder) {
  if (order.payment_status === "cancelled" &&
    order.items.some((item) => item.seller_response_timed_out)) {
    return "Availability not confirmed in time";
  }
  return ["expired", "cancelled"].includes(order.payment_status) ? statusLabel(order.payment_status) : "completed";
}

function orderItemStatusLabel(item: OrderItem) {
  if (item.seller_response_timed_out) return "Seller didn’t confirm availability in time";
  if (item.status === "unavailable") return "Seller confirmed unavailable";
  if (item.status === "delivered") return "After your order is delivered, confirm receipt.";
  if (item.status === "shipped") return "Your order has shipped. Check the tracking details for updates.";
  return statusLabel(item.status);
}

function sellerOrderItemStatusLabel(item: OrderItem) {
  if (item.status === "awaiting_seller") return "Awaiting you to confirm availability";
  if (item.status === "awaiting_payment" || item.status === "payment_submitted") return "Awaiting buyer to pay";
  if (item.status === "paid") return "Buyer payment verified. Deliver the order and submit carrier and tracking number.";
  if (item.status === "shipped") return "You submitted tracking details. Awaiting delivery confirmation.";
  if (item.status === "delivered") return "Order delivered. Awaiting buyer to confirm receipt.";
  return orderItemStatusLabel(item);
}

export default function CommercePanel({ onNotice, onCounters }: {
  onNotice: (message: string) => void;
  onCounters: (counts: CommerceCounters) => void;
}) {
  const [data, setData] = useState<CommerceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [activeTab, setActiveTab] = useState<CommercePanelTab>("buying");
  const [buyerOlderOrders, setBuyerOlderOrders] = useState<BuyerOrder[]>([]);
  const [sellerOlderItems, setSellerOlderItems] = useState<OrderItem[]>([]);
  const [buyerHistoryHasMore, setBuyerHistoryHasMore] = useState(false);
  const [sellerHistoryHasMore, setSellerHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState<"buyer" | "seller" | "">("");
  const [buyerOrderSearch, setBuyerOrderSearch] = useState("");
  const [sellerOrderSearch, setSellerOrderSearch] = useState("");
  const [buyerStatusFilter, setBuyerStatusFilter] = useState("all");
  const [sellerStatusFilter, setSellerStatusFilter] = useState("all");
  const [cartSearch, setCartSearch] = useState("");
  const [cartStatusFilter, setCartStatusFilter] = useState("all");
  const [privateOfferSearch, setPrivateOfferSearch] = useState("");
  const [privateOfferStatusFilter, setPrivateOfferStatusFilter] = useState("all");
  const [selectedPrivateThreadId, setSelectedPrivateThreadId] = useState<string | null>(null);
  const [buyerActivePage, setBuyerActivePage] = useState(1);
  const [buyerHistoryPage, setBuyerHistoryPage] = useState(1);
  const [sellerActivePage, setSellerActivePage] = useState(1);
  const [sellerHistoryPage, setSellerHistoryPage] = useState(1);
  const [buyerName, setBuyerName] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [district, setDistrict] = useState("");
  const [address, setAddress] = useState("");
  const [paymentReferences, setPaymentReferences] = useState<Record<string, string>>({});
  const [paymentNotes, setPaymentNotes] = useState<Record<string, string>>({});
  const [paymentProofFiles, setPaymentProofFiles] = useState<Record<string, string>>({});
  const [shipping, setShipping] = useState<Record<string, { carrier: string; tracking: string }>>({});
  const [disputeReasons, setDisputeReasons] = useState<Record<string, string>>({});
  const [acceptOffer, setAcceptOffer] = useState<PrivateOffer | null>(null);
  const [acceptRequestOffer, setAcceptRequestOffer] = useState<string | number | null>(null);
  const [acceptRequestCurrency, setAcceptRequestCurrency] = useState<Currency>("TZS");
  const [acceptRequestDetails, setAcceptRequestDetails] = useState<PrivateOfferThread["request"]>(null);
  const [declineOffer, setDeclineOffer] = useState<PrivateOffer | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [declineExplanation, setDeclineExplanation] = useState("");

  const refresh = useCallback(async () => {
    const [response, offersResponse] = await Promise.all([
      fetchWithWebsiteSession("/api/commerce", { cache: "no-store" }),
      fetchWithWebsiteSession("/api/marketplace-offers", { cache: "no-store" }),
    ]);
    const [result, offersResult] = await Promise.all([response.json(), offersResponse.json()]);
    if (!response.ok) throw new Error(result.error ?? "Could not load your cart and orders.");
    if (!offersResponse.ok) throw new Error(offersResult.error ?? "Could not load private offers.");
    const commerce = { ...result, privateOffers: offersResult } as CommerceData;
    setData(commerce);
    setBuyerOlderOrders([]);
    setSellerOlderItems([]);
    setBuyerHistoryHasMore(commerce.buyerOrdersHasMore);
    setSellerHistoryHasMore(commerce.sellerItemsHasMore);
    onCounters({ ...commerce, cartListingIds: commerce.cartItems.map((item) => item.listing_id) });
    setBuyerName((current) => current || commerce.profile.display_name || "");
    setBuyerPhone((current) => current || commerce.profile.phone || "");
    setCountry((current) => current || commerce.profile.delivery_country || "");
    setRegion((current) => current || commerce.profile.delivery_region || "");
    setDistrict((current) => current || commerce.profile.delivery_district || "");
    setAddress((current) => current || commerce.profile.delivery_address || "");
    setLoading(false);
  }, [onCounters]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetchWithWebsiteSession("/api/commerce", { cache: "no-store" }),
      fetchWithWebsiteSession("/api/marketplace-offers", { cache: "no-store" }),
    ]).then(async ([response, offersResponse]) => {
      const [result, offersResult] = await Promise.all([response.json(), offersResponse.json()]);
      if (!response.ok) throw new Error(result.error ?? "Could not load your cart and orders.");
      if (!offersResponse.ok) throw new Error(offersResult.error ?? "Could not load private offers.");
      return { ...result, privateOffers: offersResult } as CommerceData;
    }).then((commerce) => {
      if (!active) return;
      setData(commerce);
      setBuyerOlderOrders([]);
      setSellerOlderItems([]);
      setBuyerHistoryHasMore(commerce.buyerOrdersHasMore);
      setSellerHistoryHasMore(commerce.sellerItemsHasMore);
      onCounters({ ...commerce, cartListingIds: commerce.cartItems.map((item) => item.listing_id) });
      setBuyerName(commerce.profile.display_name || "");
      setBuyerPhone(commerce.profile.phone || "");
      setCountry(commerce.profile.delivery_country || "");
      setRegion(commerce.profile.delivery_region || "");
      setDistrict(commerce.profile.delivery_district || "");
      setAddress(commerce.profile.delivery_address || "");
    }).catch((error: unknown) => {
      if (active) onNotice(error instanceof Error ? error.message : "Could not load your cart and orders.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void refresh().catch((error: unknown) => {
        if (active) onNotice(error instanceof Error ? error.message : "Could not refresh your orders.");
      });
    };
    const interval = window.setInterval(refreshIfVisible, 30_000);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [onCounters, onNotice, refresh]);

  const perform = async (key: string, action: string, values: Record<string, unknown>) => {
    setBusy(key);
    try {
      const response = await fetchWithWebsiteSession("/api/commerce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...values }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The request could not be completed.");
      if (result.warning) onNotice(result.warning);
      if (action === "relist_unavailable") onNotice("You confirmed the mineral is in stock and relisted it on the market.");
      if (action === "hide_order_history") {
        onNotice(`Removed this entry from your ${values.side === "buyer" ? "buying" : "selling"} order history. Transaction records remain available to Madinimarket.`);
      }
      if (action === "clear_order_history") {
        onNotice(`Cleared ${result.hiddenCount} entries from your ${values.side === "buyer" ? "buying" : "selling"} order history. Transaction records remain available to Madinimarket.`);
      }
      if (action === "delete_expired_order") onNotice("The expired order was removed from your history. Transaction records remain available to Madinimarket.");
      await refresh();
      return result;
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "The request could not be completed.");
      return null;
    } finally {
      setBusy("");
    }
  };

  const loadOlderHistory = async (type: "buyer" | "seller") => {
    if (!data || historyLoading) return;
    setHistoryLoading(type);
    try {
      const currentLength = type === "buyer"
        ? data.buyerOrders.length + buyerOlderOrders.length
        : data.sellerItems.length + sellerOlderItems.length;
      const response = await fetchWithWebsiteSession(`/api/commerce?history=${type}&offset=${currentLength}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? `Could not load ${type} order history.`);
      if (type === "buyer") {
        setBuyerOlderOrders((current) => [...current, ...result.buyerOrders as BuyerOrder[]]);
        setBuyerHistoryHasMore(Boolean(result.hasMore));
      } else {
        setSellerOlderItems((current) => [...current, ...result.sellerItems as OrderItem[]]);
        setSellerHistoryHasMore(Boolean(result.hasMore));
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : `Could not load ${type} order history.`);
    } finally {
      setHistoryLoading("");
    }
  };

  const performPrivateOffer = async (key: string, values: Record<string, unknown>) => {
    setBusy(key);
    try {
      const response = await fetchWithWebsiteSession("/api/marketplace-offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The private offer action could not be completed.");
      await refresh();
      if (values.action === "checkout_offer" && result.order?.control_number) {
        if (result.order.payment_status === "awaiting_payment" && result.order.payment_deadline) {
          const paymentDeadline = new Date(result.order.payment_deadline).toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam" });
          onNotice(`Private order ${result.order.control_number} confirmed. The seller has confirmed availability; submit payment by ${paymentDeadline} Tanzania time.`);
        } else {
          onNotice(`Private order ${result.order.control_number} confirmed. The seller response deadline is shown in My orders.`);
        }
      } else if (values.action === "decide_offer") {
        if (values.agree) {
          const checkoutDeadline = result.checkout_deadline
            ? new Date(result.checkout_deadline).toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam" })
            : "the deadline shown in your private offer";
          onNotice(`Offer accepted. Complete checkout by ${checkoutDeadline} Tanzania time. The mineral is reserved for you during this 30-minute window.`);
        } else {
          onNotice("Offer declined. The seller may send a revised offer if attempts remain.");
        }
      } else if (values.action === "cancel_offer_acceptance") {
        onNotice("Checkout cancelled. Your buyer request is available for new offers again.");
      } else if (values.action === "confirm_offer") {
        onNotice("Mineral details confirmed and sent to the buyer for checkout.");
      } else if (values.action === "close_offer_thread") {
        onNotice("Private offer closed. No more offers or revised attempts can be sent.");
      } else if (values.action === "delete_closed_offer_thread") {
        onNotice("The closed private offer was deleted from your view.");
      } else if (values.action === "clear_closed_offer_threads") {
        onNotice("All closed private offers were cleared from your view.");
      } else {
        onNotice("Private offer sent. The buyer can review it in their account.");
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "The private offer action could not be completed.");
    } finally {
      setBusy("");
    }
  };

  const checkout = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await perform("checkout", "checkout", {
      buyerName, buyerPhone, country, region, district, address,
    });
    if (result?.order?.control_number) {
      const deadline = result.order.seller_response_deadline
        ? new Date(result.order.seller_response_deadline).toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam" })
        : "the deadline shown in My orders";
      onNotice(`Order ${result.order.control_number} confirmed. Sellers have until ${deadline} Tanzania time to confirm availability.`);
    }
  };

  const submitPaymentProof = async (event: FormEvent<HTMLFormElement>, orderId: string) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(`payment-${orderId}`);
    try {
      const response = await fetchWithWebsiteSession("/api/commerce/payment-proof", {
        method: "POST",
        body: new FormData(formElement),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not submit payment proof.");
      formElement.reset();
      setPaymentReferences((current) => ({ ...current, [orderId]: "" }));
      setPaymentNotes((current) => ({ ...current, [orderId]: "" }));
      setPaymentProofFiles((current) => ({ ...current, [orderId]: "" }));
      await refresh();
      onNotice("Payment reference and proof submitted for admin verification.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not submit payment proof.");
    } finally {
      setBusy("");
    }
  };

  if (loading) return <p className="dialog-copy">Loading your cart and orders…</p>;
  if (!data) return <p className="dialog-copy">Your order details are unavailable. Close this panel and try again.</p>;
  const total = data.cartItems.reduce((sum, item) => sum + Number(item.listing?.price ?? 0), 0);
  const cartCurrency = data.cartItems[0]?.listing?.currency ?? "TZS";
  const allBuyerOrders = [...data.buyerOrders, ...buyerOlderOrders];
  const allSellerItems = [...data.sellerItems, ...sellerOlderItems];
  const activeBuyerOrders = allBuyerOrders.filter((order) => !isBuyerOrderHistory(order));
  const buyerOrderHistory = allBuyerOrders.filter(isBuyerOrderHistory);
  const activeSellerItems = allSellerItems.filter((item) => !completedOrderItemStatuses.has(item.status));
  const sellerItemHistory = allSellerItems.filter((item) => completedOrderItemStatuses.has(item.status));
  const buyerSearchTerm = buyerOrderSearch.trim().toLocaleLowerCase();
  const sellerSearchTerm = sellerOrderSearch.trim().toLocaleLowerCase();
  const matchesBuyerSearch = (order: BuyerOrder) => !buyerSearchTerm ||
    `${order.control_number} ${order.payment_status} ${order.items.map((item) => `${item.mineral_name} ${item.status}`).join(" ")}`.toLocaleLowerCase().includes(buyerSearchTerm);
  const matchesBuyerStatus = (order: BuyerOrder) => buyerStatusFilter === "all" ||
    order.payment_status === buyerStatusFilter || order.items.some((item) => item.status === buyerStatusFilter);
  const matchesSellerSearch = (item: OrderItem) => !sellerSearchTerm ||
    `${item.order?.control_number ?? ""} ${item.mineral_name} ${item.status}`.toLocaleLowerCase().includes(sellerSearchTerm);
  const matchesSellerStatus = (item: OrderItem) => sellerStatusFilter === "all"
    || (sellerStatusFilter === "awaiting_payment"
      ? ["awaiting_payment", "payment_submitted"].includes(item.status)
      : item.status === sellerStatusFilter);
  const filteredActiveBuyerOrders = activeBuyerOrders.filter((order) => matchesBuyerSearch(order) && matchesBuyerStatus(order));
  const filteredBuyerHistory = buyerOrderHistory.filter((order) => matchesBuyerSearch(order) && matchesBuyerStatus(order));
  const filteredActiveSellerItems = activeSellerItems.filter((item) => matchesSellerSearch(item) && matchesSellerStatus(item));
  const filteredSellerHistory = sellerItemHistory.filter((item) => matchesSellerSearch(item) && matchesSellerStatus(item));
  const orderPageSize = 10;
  const isCartListingMarketListed = (item: CartItem) => Boolean(item.listing && item.listing.is_active && item.listing.status === "approved" && item.listing.marketplace_state === "available");
  const filteredCartItems = data.cartItems.filter((item) => {
    const matchesSearch = !cartSearch.trim() || `${item.listing?.mineral_name ?? ""} ${item.listing?.seller_name ?? ""}`.toLocaleLowerCase().includes(cartSearch.trim().toLocaleLowerCase());
    const matchesStatus = cartStatusFilter === "all" || (cartStatusFilter === "listed" ? isCartListingMarketListed(item) : !isCartListingMarketListed(item));
    return matchesSearch && matchesStatus;
  });
  const unavailableCartItemsCount = data.cartItems.filter((item) => !isCartListingMarketListed(item)).length;
  const filteredPrivateThreads = data.privateOffers.threads.filter((thread) => {
    const latestOffer = thread.offers[thread.offers.length - 1];
    const matchesSearch = !privateOfferSearch.trim() ||
      `${thread.seller_username} ${thread.request_id} ${thread.state} ${thread.request?.mineral_name ?? ""} ${latestOffer?.mineral_name ?? ""}`.toLocaleLowerCase().includes(privateOfferSearch.trim().toLocaleLowerCase());
    const matchesStatus = privateOfferStatusFilter === "all" ||
      (privateOfferStatusFilter === "closed" ? thread.state === "closed" : thread.state !== "closed");
    return matchesSearch && matchesStatus;
  });
  const visibleBuyerPrivateThreads = filteredPrivateThreads.filter((thread) => thread.side === "buyer");
  const visibleSellerPrivateThreads = filteredPrivateThreads.filter((thread) => thread.side === "seller");
  const selectedPrivateThread = data.privateOffers.threads.find((thread) => thread.id === selectedPrivateThreadId) ?? null;
  const buyerActivePageCount = Math.max(1, Math.ceil(filteredActiveBuyerOrders.length / orderPageSize));
  const buyerHistoryPageCount = Math.max(1, Math.ceil(filteredBuyerHistory.length / orderPageSize));
  const sellerActivePageCount = Math.max(1, Math.ceil(filteredActiveSellerItems.length / orderPageSize));
  const sellerHistoryPageCount = Math.max(1, Math.ceil(filteredSellerHistory.length / orderPageSize));
  const currentBuyerActivePage = Math.min(buyerActivePage, buyerActivePageCount);
  const currentBuyerHistoryPage = Math.min(buyerHistoryPage, buyerHistoryPageCount);
  const currentSellerActivePage = Math.min(sellerActivePage, sellerActivePageCount);
  const currentSellerHistoryPage = Math.min(sellerHistoryPage, sellerHistoryPageCount);
  const visibleActiveBuyerOrders = filteredActiveBuyerOrders.slice((currentBuyerActivePage - 1) * orderPageSize, currentBuyerActivePage * orderPageSize);
  const visibleBuyerHistory = filteredBuyerHistory.slice((currentBuyerHistoryPage - 1) * orderPageSize, currentBuyerHistoryPage * orderPageSize);
  const visibleActiveSellerItems = filteredActiveSellerItems.slice((currentSellerActivePage - 1) * orderPageSize, currentSellerActivePage * orderPageSize);
  const visibleSellerHistory = filteredSellerHistory.slice((currentSellerHistoryPage - 1) * orderPageSize, currentSellerHistoryPage * orderPageSize);
  const renderOrderPagination = (totalItems: number, page: number, pageCount: number, label: string, onPageChange: (page: number) => void) => totalItems > orderPageSize
    ? <div className="commerce-pagination"><span>Showing {(page - 1) * orderPageSize + 1}–{Math.min(page * orderPageSize, totalItems)} of {totalItems} {label}</span><div><button className="button button-outline" type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button className="button button-outline" type="button" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>Next</button></div></div>
    : totalItems > 0 ? <p className="commerce-results-count">Showing {totalItems} {label}</p> : null;
  const renderBuyerOrder = (order: BuyerOrder, history = false) => <details className="commerce-order" key={order.id}>
    <summary className="commerce-order-summary">
      <span><strong>Order {order.control_number}</strong><small>{(order.items ?? []).map((item) => item.mineral_name).join(", ") || "No items"}</small></span>
      <span className="commerce-order-summary-status">{history ? buyerOrderHistoryLabel(order) : buyerOrderStatusLabel(order)}</span>
      <strong className="commerce-order-summary-total">{amount(order.total_amount, order.currency)}</strong>
      <span className="commerce-disclosure-chevron" aria-hidden="true">⌄</span>
    </summary>
    <div className="commerce-order-details">
    <p>{amount(order.total_amount, order.currency)}{order.payment_deadline && order.payment_status === "awaiting_payment" ? ` · Pay by ${new Date(order.payment_deadline).toLocaleString()}` : ""}</p>
    {history && <button className="button button-outline commerce-history-entry-delete" type="button" disabled={busy !== ""} onClick={() => {
      if (window.confirm(`Remove order ${order.control_number} from your buying history? It will remain in Madinimarket records.`)) {
        void perform(`hide-buyer-history-${order.id}`, "hide_order_history", { side: "buyer", entryId: order.id });
      }
    }}>{busy === `hide-buyer-history-${order.id}` ? "Removing…" : "Delete from history"}</button>}
    {order.payment_status === "awaiting_payment" && <form className="commerce-payment-form" onSubmit={(event) => void submitPaymentProof(event, order.id)}>
      {data.paymentMethods.length
        ? <div className="commerce-payment-methods">
          <strong>Choose a payment method to view its details</strong>
          <div className="commerce-payment-method-list">
            {data.paymentMethods.map((method, index) => <details className="commerce-payment-method" key={`${method.method}-${index}`}>
              <summary>{method.method}</summary>
              <span>Account number / payment number: {method.accountNumber}</span>
            </details>)}
          </div>
          {data.paymentInstructions && <div className="commerce-payment-general-instructions">
            <strong>General instructions</strong><p>{data.paymentInstructions}</p>
          </div>}
        </div>
        : <p>Payment methods are not configured. Contact Madinimarket support before sending money.</p>}
      <label className="field-label">Payment transaction reference<input className="text-input" name="reference" required minLength={3} maxLength={120} value={paymentReferences[order.id] ?? ""} onChange={(event) => setPaymentReferences((current) => ({ ...current, [order.id]: event.target.value }))} /></label>
      <label className="field-label">Optional note<input className="text-input" name="note" maxLength={500} value={paymentNotes[order.id] ?? ""} onChange={(event) => setPaymentNotes((current) => ({ ...current, [order.id]: event.target.value }))} /></label>
      <label className="field-label">Payment receipt (PDF, JPEG, PNG · max 10 MB)<input className="text-input" name="proof" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" required onChange={(event) => {
        const fileName = event.currentTarget.files?.[0]?.name ?? "";
        setPaymentProofFiles((current) => ({ ...current, [order.id]: fileName }));
      }} /><small>{paymentProofFiles[order.id] || "Choose a receipt image or PDF"}</small></label>
      <input type="hidden" name="orderId" value={order.id} />
      <button className="button button-dark" type="submit" disabled={busy === `payment-${order.id}` || !data.paymentMethods.length}>{busy === `payment-${order.id}` ? "Submitting…" : !data.paymentMethods.length ? "Payment details unavailable" : "Submit proof for verification"}</button>
    </form>}
    {(order.items ?? []).map((item) => <div className="commerce-order-item" key={item.id}>
      <div>
        <strong>{item.mineral_name} · {item.weight} {item.unit}</strong>
        <small>{orderItemStatusLabel(item)} · Total {amount(item.total_price, item.currency)}</small>
        {(item.shipping_carrier || item.tracking_number) && <div className="commerce-delivery-details">
          <strong>Tracking details</strong>
          {item.shipping_carrier && <span>Carrier: {item.shipping_carrier}</span>}
          {item.tracking_number && <span>Tracking number: {item.tracking_number}</span>}
        </div>}
      </div>
      {item.status === "delivered" && <div className="commerce-item-actions">
        <button className="button button-dark" type="button" disabled={busy === `receipt-${item.id}`} onClick={() => void perform(`receipt-${item.id}`, "confirm_receipt", { itemId: item.id })}>{busy === `receipt-${item.id}` ? "Confirming receipt…" : "Confirm receipt"}</button>
        <label className="field-label">Report a delivery issue<textarea className="review-message" minLength={10} maxLength={500} value={disputeReasons[item.id] ?? ""} onChange={(event) => setDisputeReasons((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
        <button className="button button-outline" type="button" disabled={busy === `dispute-${item.id}`} onClick={() => void perform(`dispute-${item.id}`, "dispute_delivery", { itemId: item.id, reason: disputeReasons[item.id] })}>Open dispute</button>
      </div>}
    </div>)}
    </div>
  </details>;
  const renderSellerItem = (item: OrderItem, history = false) => <details className="commerce-seller-order-item" key={item.id}>
    <summary className="commerce-order-summary">
      <span><strong>{item.mineral_name} · {item.weight} {item.unit}</strong><small>Order {item.order?.control_number}</small></span>
      <span className="commerce-order-summary-status">{history && !["expired", "cancelled", "unavailable", "refunded"].includes(item.status) ? "completed" : sellerOrderItemStatusLabel(item)}</span>
      <strong className="commerce-order-summary-total">{amount(item.seller_amount, item.currency)}</strong>
      <span className="commerce-disclosure-chevron" aria-hidden="true">⌄</span>
    </summary>
    <div className="commerce-order-details">
    {history && <button className="button button-outline commerce-history-entry-delete" type="button" disabled={busy !== ""} onClick={() => {
      if (window.confirm(`Remove this item from your selling history? It will remain in Madinimarket records.`)) {
        void perform(`hide-seller-history-${item.id}`, "hide_order_history", { side: "seller", entryId: item.id });
      }
    }}>{busy === `hide-seller-history-${item.id}` ? "Removing…" : "Delete from history"}</button>}
    <div className="commerce-order-item">
    <div><strong>{item.mineral_name} · {item.weight} {item.unit}</strong>
      <small>Order {item.order?.control_number} · {history && !["expired", "cancelled", "unavailable", "refunded"].includes(item.status) ? "completed" : sellerOrderItemStatusLabel(item)}</small>
      <small>You receive {amount(item.seller_amount, item.currency)} before any separately managed payout</small>
      {item.payout_reference && <small>Seller payout reference: {item.payout_reference}</small>}
      {item.payout_receipt_url && <small><a className="certificate-file-link" href={item.payout_receipt_url} target="_blank" rel="noreferrer">View payout receipt</a></small>}
    </div>
    {item.status === "awaiting_seller" && <div className="commerce-item-actions">
      <button className="button button-dark" type="button" disabled={busy === `available-${item.id}` || busy === `unavailable-${item.id}`} onClick={() => void perform(`available-${item.id}`, "seller_availability", { itemId: item.id, available: true })}>{busy === `available-${item.id}` ? "Confirming availability…" : "Available"}</button>
      <button className="button button-outline" type="button" disabled={busy === `available-${item.id}` || busy === `unavailable-${item.id}`} onClick={() => void perform(`unavailable-${item.id}`, "seller_availability", { itemId: item.id, available: false })}>{busy === `unavailable-${item.id}` ? "Updating availability…" : "Unavailable"}</button>
      <small>Respond by {new Date(item.seller_response_deadline).toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam" })} Tanzania time</small>
    </div>}
    {["unavailable", "refunded"].includes(item.status) && item.listing_id && <div className="commerce-item-actions">
      <p className="commerce-warning">This mineral is hidden from the public market. Confirm that it is in stock before relisting it.</p>
      <button className="button button-outline" type="button" disabled={busy === `relist-${item.id}`} onClick={() => void perform(`relist-${item.id}`, "relist_unavailable", { itemId: item.id })}>{busy === `relist-${item.id}` ? "Relisting…" : "Confirm stock and relist"}</button>
    </div>}
    {["paid", "shipped", "delivered", "disputed", "payout_due", "payout_paid", "refund_due", "refunded"].includes(item.status) && item.order?.buyer_name && <div className="commerce-delivery-details">
      <strong>Deliver to</strong>
      <span>{item.order.buyer_name} · {item.order.buyer_phone}</span>
      <span>{item.order.delivery_address}, {item.order.delivery_district}, {item.order.delivery_region}, {item.order.delivery_country}</span>
      {item.shipping_carrier && <span>Carrier: {item.shipping_carrier} · Tracking: {item.tracking_number}</span>}
    </div>}
    {item.status === "paid" && <div className="commerce-item-actions">
      <label className="field-label">Carrier<input className="text-input" value={shipping[item.id]?.carrier ?? ""} onChange={(event) => setShipping((current) => ({ ...current, [item.id]: { carrier: event.target.value, tracking: current[item.id]?.tracking ?? "" } }))} /></label>
      <label className="field-label">Tracking number<input className="text-input" value={shipping[item.id]?.tracking ?? ""} onChange={(event) => setShipping((current) => ({ ...current, [item.id]: { carrier: current[item.id]?.carrier ?? "", tracking: event.target.value } }))} /></label>
      <button className="button button-dark" type="button" disabled={busy === `dispatch-${item.id}`} onClick={() => void perform(`dispatch-${item.id}`, "seller_dispatch", { itemId: item.id, carrier: shipping[item.id]?.carrier, trackingNumber: shipping[item.id]?.tracking })}>{busy === `dispatch-${item.id}` ? "Submitting…" : "Submit"}</button>
    </div>}
    {item.status === "disputed" && <p className="commerce-warning">Buyer dispute: {item.dispute_reason ?? "Awaiting admin review."}</p>}
    </div>
    </div>
  </details>;

  return <div className="commerce-panel">
    <div className="dialog-kicker">BUYER & SELLER ORDERS</div>
    <h2 id="dialog-title">Orders and Cart</h2>
    <nav className="commerce-tabs" aria-label="Orders and cart sections">
      {([
        ["buying", "Buying", data.buyerOpenOrdersCount],
        ["selling", "Selling", data.sellerOpenOrdersCount],
        ["cart", "Cart", data.cartItems.length],
        ["offers", "Offers", data.privateOffersCount],
      ] as const).map(([tab, label, count]) => <button
        className={`commerce-tab${activeTab === tab ? " is-active" : ""}`}
        type="button"
        key={tab}
        aria-pressed={activeTab === tab}
        onClick={() => setActiveTab(tab)}
      >{label}<span>{count}</span></button>)}
    </nav>
    {activeTab === "offers" && <section className="commerce-section commerce-order-section">
      <h3>Private mineral offers <span className="commerce-section-count">{data.privateOffersCount}</span></h3>
      {data.privateOffers.threads.length > 0 && <div className="commerce-collection-tools">
        <label className="commerce-order-search">Search private offers<input className="text-input" type="search" value={privateOfferSearch} placeholder="Mineral, seller, or request number" onChange={(event) => { setPrivateOfferSearch(event.target.value); }} /></label>
        <label className="commerce-order-filter">Offer status<select className="text-input" value={privateOfferStatusFilter} onChange={(event) => { setPrivateOfferStatusFilter(event.target.value); }}><option value="all">All offers</option><option value="open">Open</option><option value="closed">Closed</option></select></label>
        {data.privateOffers.threads.some((thread) => thread.state === "closed") && <button className="button button-outline" type="button" disabled={busy !== ""} onClick={() => { if (window.confirm("Clear all closed private offers from your view?")) void performPrivateOffer("clear-closed-offers", { action: "clear_closed_offer_threads" }); }}>Clear closed offers</button>}
      </div>}
      {data.privateOffers.threads.length ? <div className="commerce-private-board">
        <details className="commerce-private-role-group" open>
          <summary className="commerce-private-group-heading"><span><strong>Your offers as a buyer</strong><small>{visibleBuyerPrivateThreads.length} offer{visibleBuyerPrivateThreads.length === 1 ? "" : "s"}</small></span><span className="commerce-private-group-count">{visibleBuyerPrivateThreads.length}</span><span className="commerce-disclosure-chevron" aria-hidden="true">⌄</span></summary>
          <div className="commerce-private-card-list">
            {visibleBuyerPrivateThreads.map((thread) => { const latest = thread.offers[thread.offers.length - 1]; return <button type="button" className="commerce-private-card" key={thread.id} onClick={() => setSelectedPrivateThreadId(thread.id)}>
              {latest?.signed_image_url ? <Image className="commerce-private-card-image" src={latest.signed_image_url} alt={`${latest.mineral_name} private offer`} width={90} height={90} unoptimized /> : <span className="commerce-private-card-image-placeholder" aria-hidden="true">M</span>}
              <span className="commerce-private-card-main"><span className="commerce-private-card-role">Buyer · Request #{thread.request_id}</span><strong>{latest?.mineral_name ?? thread.request?.mineral_name ?? "Private offer"}</strong><span>Seller @{thread.seller_username}</span></span>
              <span className="commerce-private-card-side">{latest && <span className="commerce-private-card-price">{amount(latest.total_price, latest.currency)}</span>}<span className="commerce-private-card-status">{privateOfferStatusLabel(latest?.status ?? thread.state, "buyer", thread.close_reason, thread.state)}</span>{latest?.status === "awaiting_buyer_checkout" && latest.checkout_deadline && <span className="commerce-private-card-meta">Complete by {new Date(latest.checkout_deadline).toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam" })} Tanzania time</span>}<span className="commerce-private-card-meta">Attempt {thread.attempt_count}/3</span></span>
            </button>; })}
          </div>
          {!visibleBuyerPrivateThreads.length && <p className="commerce-note">No offers received as a buyer match the current filter.</p>}
        </details>
        <details className="commerce-private-role-group" open>
          <summary className="commerce-private-group-heading"><span><strong>Your offers as a seller</strong><small>{visibleSellerPrivateThreads.length} offer{visibleSellerPrivateThreads.length === 1 ? "" : "s"}</small></span><span className="commerce-private-group-count">{visibleSellerPrivateThreads.length}</span><span className="commerce-disclosure-chevron" aria-hidden="true">⌄</span></summary>
          <div className="commerce-private-card-list">
            {visibleSellerPrivateThreads.map((thread) => { const latest = thread.offers[thread.offers.length - 1]; const remaining = Math.max(0, 3 - thread.attempt_count); return <button type="button" className="commerce-private-card" key={thread.id} onClick={() => setSelectedPrivateThreadId(thread.id)}>
              {latest?.signed_image_url ? <Image className="commerce-private-card-image" src={latest.signed_image_url} alt={`${latest.mineral_name} private offer`} width={90} height={90} unoptimized /> : <span className="commerce-private-card-image-placeholder" aria-hidden="true">M</span>}
              <span className="commerce-private-card-main"><span className="commerce-private-card-role">Seller · Request #{thread.request_id}</span><strong>{latest?.mineral_name ?? thread.request?.mineral_name ?? "Private offer"}</strong><span>Buyer request</span></span>
              <span className="commerce-private-card-side">{latest && <span className="commerce-private-card-price">{amount(latest.total_price, latest.currency)}</span>}<span className="commerce-private-card-status">{privateOfferStatusLabel(latest?.status ?? thread.state, "seller", thread.close_reason, thread.state)}</span>{latest?.status === "awaiting_buyer_checkout" && latest.checkout_deadline && <span className="commerce-private-card-meta">Checkout deadline: {new Date(latest.checkout_deadline).toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam" })} Tanzania time</span>}<span className="commerce-private-card-meta">Attempt {thread.attempt_count}/3 · {remaining} remaining</span></span>
            </button>; })}
          </div>
          {!visibleSellerPrivateThreads.length && <p className="commerce-note">No offers sent as a seller match the current filter.</p>}
        </details>
      </div> : <p className="commerce-note">No private mineral offers yet. You can send offers to buyer requests directly from the market.</p>}
    </section>}
    {activeTab === "cart" && <section className="commerce-section commerce-order-section">
      <h3>My cart ({data.cartItems.length})</h3>
      {data.cartItems.length ? <>
        <div className="commerce-cart-layout">
          <div className="commerce-cart-items">
            <div className="commerce-cart-items-heading">
              <h4>Items to order</h4>
              <span>{filteredCartItems.length} shown · {data.cartItems.length} total</span>
            </div>
            <div className="commerce-collection-tools">
              <label className="commerce-order-search">Search cart<input className="text-input" type="search" value={cartSearch} placeholder="Mineral or seller" onChange={(event) => setCartSearch(event.target.value)} /></label>
              <label className="commerce-order-filter">Market status<select className="text-input" value={cartStatusFilter} onChange={(event) => setCartStatusFilter(event.target.value)}><option value="all">All items</option><option value="listed">Currently listed</option><option value="unavailable">Unavailable</option></select></label>
            </div>
            <div className="commerce-cart-item-list" aria-label="Items in your cart">
              {filteredCartItems.map((item) => {
                const marketListed = isCartListingMarketListed(item);
                const itemStatus = marketListed ? "Listed" : item.listing?.marketplace_state === "reserved" ? "Reserved" : "Unavailable";
                return <article className="commerce-cart-item-card" key={item.id}>
                  <div className="commerce-cart-item-info">
                    <strong>{item.listing?.mineral_name ?? "Listing no longer available"}</strong>
                    <span>{item.listing ? `${item.listing.listing_type === "batch" ? "Batch · " : ""}${item.listing.weight} ${item.listing.unit} · ${amount(item.listing.price, item.listing.currency)}` : "This listing is no longer available."}</span>
                  </div>
                  <span className={`commerce-cart-item-status${marketListed ? " is-available" : ""}`}>{itemStatus}</span>
                  <button className="button button-outline commerce-cart-remove" type="button" aria-label={`Remove ${item.listing?.mineral_name ?? "unavailable item"} from cart`} disabled={busy === `remove-${item.id}`} onClick={() => void perform(`remove-${item.id}`, "remove_from_cart", { cartItemId: item.id })}>Remove</button>
                </article>;
              })}
              {!filteredCartItems.length && <p className="commerce-note">No cart items match your search and status filter.</p>}
            </div>
          </div>
          <aside className="commerce-cart-checkout" aria-labelledby="commerce-cart-checkout-heading">
            <div className="commerce-cart-checkout-heading">
              <h4 id="commerce-cart-checkout-heading">Delivery and order form</h4>
              <p>This form submits all {data.cartItems.length} items in your cart as one order. “Listed” means currently on the market; it is not the seller’s order-specific confirmation.</p>
            </div>
            <ul className="commerce-cart-order-summary" aria-label="Items included in this order">
              {data.cartItems.map((item) => <li key={item.id}>
                <span>{item.listing?.mineral_name ?? "Listing no longer available"}</span>
                <strong>{item.listing ? amount(item.listing.price, item.listing.currency) : "Unavailable"}</strong>
              </li>)}
            </ul>
            <p className="commerce-total">Cart total <strong>{amount(total, cartCurrency)}</strong></p>
            {unavailableCartItemsCount > 0 && <p className="commerce-warning commerce-cart-unavailable-note">Remove or wait for the {unavailableCartItemsCount} unavailable {unavailableCartItemsCount === 1 ? "item" : "items"} before submitting the order.</p>}
            <form className="commerce-checkout" onSubmit={checkout}>
              <p className="commerce-note">After you submit the order, each seller must confirm their item’s availability. Items stay available to other buyers while in your cart; submitting reserves them while sellers check. A seller-confirmed unavailable mineral is removed from the market; if a seller does not respond by the deadline, that item is cancelled and released back to the market. You only pay for seller-confirmed items.</p>
              <label className="field-label">Buyer name<input className="text-input" required maxLength={120} value={buyerName} onChange={(event) => setBuyerName(event.target.value)} /></label>
              <label className="field-label">Phone number<input className="text-input" required maxLength={40} value={buyerPhone} onChange={(event) => setBuyerPhone(event.target.value)} /></label>
              <div className="field-row">
                <label className="field-label">Country<input className="text-input" required maxLength={100} value={country} onChange={(event) => setCountry(event.target.value)} /></label>
                <label className="field-label">Region<input className="text-input" required maxLength={100} value={region} onChange={(event) => setRegion(event.target.value)} /></label>
              </div>
              <div className="field-row">
                <label className="field-label">District<input className="text-input" required maxLength={100} value={district} onChange={(event) => setDistrict(event.target.value)} /></label>
                <label className="field-label">Street / delivery address<input className="text-input" required maxLength={300} value={address} onChange={(event) => setAddress(event.target.value)} /></label>
              </div>
              <button className="button button-dark" type="submit" disabled={busy === "checkout" || unavailableCartItemsCount > 0}>{busy === "checkout" ? "Submitting…" : "Submit cart order"}</button>
            </form>
          </aside>
        </div>
      </> : <p className="commerce-note">Your cart is empty. Add a mineral from the market to begin.</p>}
    </section>}
    {activeTab === "buying" && <section className="commerce-section commerce-order-section">
      <div className="commerce-section-heading">
        <div><h3>Buying orders</h3><p>Track payment, delivery, and completed purchases.</p></div>
        <span className="commerce-section-count">{data.buyerOpenOrdersCount} active</span>
      </div>
      <div className="commerce-order-tools">
        <label className="commerce-order-search">Search buying orders<input className="text-input" type="search" value={buyerOrderSearch} placeholder="Order number or mineral" onChange={(event) => { setBuyerOrderSearch(event.target.value); setBuyerActivePage(1); setBuyerHistoryPage(1); }} /></label>
        <label className="commerce-order-filter">Status<select className="text-input" value={buyerStatusFilter} onChange={(event) => { setBuyerStatusFilter(event.target.value); setBuyerActivePage(1); setBuyerHistoryPage(1); }}>
        <option value="all">All statuses</option><option value="awaiting_payment">Awaiting you to pay</option><option value="payment_submitted">You submitted payment for verification</option><option value="awaiting_seller">Awaiting seller to confirm availability</option><option value="paid">Your payment is verified. Awaiting seller to dispatch your order.</option><option value="shipped">Your order has shipped. Check the tracking details for updates.</option><option value="delivered">After your order is delivered, confirm receipt.</option><option value="disputed">Disputed</option><option value="payout_due">Payout due</option><option value="payout_paid">Payout paid</option><option value="refunded">Refunded</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option>
      </select></label>
      </div>
      <div className="commerce-order-subsection">
      <h4>Active orders <span className="commerce-section-count">{data.buyerOpenOrdersCount}</span></h4>
      {filteredActiveBuyerOrders.length
        ? <div className="commerce-list">{visibleActiveBuyerOrders.map((order) => renderBuyerOrder(order))}</div>
        : <p className="commerce-note">{activeBuyerOrders.length ? "No active buying orders match your search and status filter." : data.buyerOpenOrdersCount ? "Some older active orders are outside the recent list. Open Buying order history and load older orders to find them." : "No active buying orders."}</p>}
      {renderOrderPagination(filteredActiveBuyerOrders.length, currentBuyerActivePage, buyerActivePageCount, "active buying orders", setBuyerActivePage)}
      </div>
      <details className="commerce-history">
        <summary>Buying history <span className="commerce-section-count">{data.buyerHistoryCount}</span></summary>
        {data.buyerHistoryCount > 0 && <button className="button button-outline commerce-history-clear" type="button" disabled={busy !== ""} onClick={() => {
          if (window.confirm("Hide all entries from your buying order history? This only removes them from your view; transaction records remain available to Madinimarket.")) {
            void perform("clear-buyer-history", "clear_order_history", { side: "buyer" });
          }
        }}>{busy === "clear-buyer-history" ? "Clearing…" : "Clear all buying history"}</button>}
        {filteredBuyerHistory.length
          ? <div className="commerce-list commerce-history-list">{visibleBuyerHistory.map((order) => renderBuyerOrder(order, true))}</div>
          : <p className="commerce-note">{buyerOrderHistory.length ? "No history orders match your search and status filter." : "No completed or closed orders yet."}</p>}
        {renderOrderPagination(filteredBuyerHistory.length, currentBuyerHistoryPage, buyerHistoryPageCount, "buying history orders", setBuyerHistoryPage)}
        {buyerHistoryHasMore && <button className="button button-outline commerce-history-more" type="button" disabled={historyLoading !== ""} onClick={() => void loadOlderHistory("buyer")}>{historyLoading === "buyer" ? "Loading…" : "Load older orders"}</button>}
      </details>
    </section>}
    {activeTab === "selling" && <section className="commerce-section commerce-order-section">
      <div className="commerce-section-heading">
        <div><h3>Selling orders</h3><p>Manage seller responses, dispatch, and payout progress.</p></div>
        <span className="commerce-section-count">{data.sellerOpenOrdersCount} active</span>
      </div>
      <div className="commerce-order-tools">
        <label className="commerce-order-search">Search selling orders<input className="text-input" type="search" value={sellerOrderSearch} placeholder="Order number or mineral" onChange={(event) => { setSellerOrderSearch(event.target.value); setSellerActivePage(1); setSellerHistoryPage(1); }} /></label>
        <label className="commerce-order-filter">Status<select className="text-input" value={sellerStatusFilter} onChange={(event) => { setSellerStatusFilter(event.target.value); setSellerActivePage(1); setSellerHistoryPage(1); }}>
        <option value="all">All statuses</option><option value="awaiting_seller">Awaiting you to confirm availability</option><option value="awaiting_payment">Awaiting buyer to pay</option><option value="paid">Buyer payment verified. Deliver the order and submit carrier and tracking number.</option><option value="shipped">You submitted tracking details. Awaiting delivery confirmation.</option><option value="delivered">Order delivered. Awaiting buyer to confirm receipt.</option><option value="disputed">Disputed</option><option value="payout_due">Payout due</option><option value="payout_paid">Payout paid</option><option value="refund_due">Refund due</option><option value="refunded">Refunded</option><option value="unavailable">Unavailable</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option>
      </select></label>
      </div>
      <div className="commerce-order-subsection">
      <h4>Active orders <span className="commerce-section-count">{data.sellerOpenOrdersCount}</span></h4>
      {filteredActiveSellerItems.length
        ? <div className="commerce-list">{visibleActiveSellerItems.map((item) => renderSellerItem(item))}</div>
        : <p className="commerce-note">{activeSellerItems.length ? "No active selling orders match your search and status filter." : data.sellerOpenOrdersCount ? "Some older active orders are outside the recent list. Open Selling order history and load older orders to find them." : "No active selling orders."}</p>}
      {renderOrderPagination(filteredActiveSellerItems.length, currentSellerActivePage, sellerActivePageCount, "active selling orders", setSellerActivePage)}
      </div>
      <details className="commerce-history">
        <summary>Selling order history · items <span className="commerce-section-count">{data.sellerHistoryItemCount}</span></summary>
        {data.sellerHistoryItemCount > 0 && <button className="button button-outline commerce-history-clear" type="button" disabled={busy !== ""} onClick={() => {
          if (window.confirm("Hide all entries from your selling order history? This only removes them from your view; transaction records remain available to Madinimarket.")) {
            void perform("clear-seller-history", "clear_order_history", { side: "seller" });
          }
        }}>{busy === "clear-seller-history" ? "Clearing…" : "Clear all selling history"}</button>}
        {filteredSellerHistory.length
          ? <div className="commerce-list commerce-history-list">{visibleSellerHistory.map((item) => renderSellerItem(item, true))}</div>
          : <p className="commerce-note">{sellerItemHistory.length ? "No history orders match your search and status filter." : "No completed or closed orders yet."}</p>}
        {renderOrderPagination(filteredSellerHistory.length, currentSellerHistoryPage, sellerHistoryPageCount, "selling history items", setSellerHistoryPage)}
        {sellerHistoryHasMore && <button className="button button-outline commerce-history-more" type="button" disabled={historyLoading !== ""} onClick={() => void loadOlderHistory("seller")}>{historyLoading === "seller" ? "Loading…" : "Load older orders"}</button>}
      </details>
    </section>}
    {selectedPrivateThread && !acceptOffer && !declineOffer && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedPrivateThreadId(null); }}>
      <div className="dialog-card commerce-private-dialog" role="dialog" aria-modal="true" aria-labelledby="private-thread-title">
        <div className="dialog-kicker">{selectedPrivateThread.side === "buyer" ? "OFFERS AS BUYER" : "OFFERS AS SELLER"}</div>
        <h2 id="private-thread-title">{selectedPrivateThread.request?.mineral_name ?? "Private mineral offer"} · Request #{selectedPrivateThread.request_id}</h2>
        {selectedPrivateThread.offers.map((offer) => <div className="commerce-private-offer" key={offer.id}>
          <div className="commerce-order-heading"><strong>Offer {offer.attempt_number} · {offer.mineral_name}</strong><span>{privateOfferStatusLabel(offer.status, selectedPrivateThread.side, selectedPrivateThread.close_reason)}</span></div>
          {offer.status === "awaiting_buyer_checkout" && offer.checkout_deadline && <p className="commerce-note">Checkout must be completed by {new Date(offer.checkout_deadline).toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam" })} Tanzania time. If the deadline passes, the acceptance is cancelled, the request reopens, and other eligible offers become available again.</p>}
          {offer.status === "closed" && selectedPrivateThread.close_reason === "buyer_checkout_expired" && <p className="commerce-note">The checkout deadline passed before an order was created. No payment was taken; the buyer request and eligible competing offers are available again.</p>}
          {offer.status === "ordered" && <p className="commerce-note">The order has been created. Continue with payment, shipping, delivery confirmation, and dispute handling in My orders.</p>}
          {offer.signed_image_url && <div className="commerce-private-image"><Image src={offer.signed_image_url} alt={`${offer.mineral_name} private offer`} width={800} height={800} unoptimized /></div>}
          {selectedPrivateThread.request
            ? <div className="private-offer-comparison">
                {selectedPrivateThread.side === "buyer"
                  ? <div className="private-offer-compare-column"><span className="private-offer-compare-title">Your original request</span><strong>{selectedPrivateThread.request.mineral_name}</strong><span>{selectedPrivateThread.request.weight} {selectedPrivateThread.request.unit}</span><span>{selectedPrivateThread.request.color} · {selectedPrivateThread.request.shape} · {selectedPrivateThread.request.quality}</span><span>Location: {selectedPrivateThread.request.location}</span><strong className="private-offer-request-price">Your requested offer: {amount(selectedPrivateThread.request.offer, selectedPrivateThread.request.currency)}</strong></div>
                  : <div className="private-offer-compare-column"><span className="private-offer-compare-title">Your offer</span><strong>{offer.mineral_name}</strong><span>{offer.weight} {offer.unit}</span><span>{offer.color} · {offer.shape} · {offer.quality}</span><span>Location: {offer.district}, {offer.region}, {offer.country}</span><strong className="private-offer-total-price">Seller’s offer — buyer should pay a total of: {amount(offer.total_price, offer.currency)}</strong></div>}
                {selectedPrivateThread.side === "buyer"
                  ? <div className="private-offer-compare-column"><span className="private-offer-compare-title">Seller’s offer</span><strong>{offer.mineral_name}</strong><span>{offer.weight} {offer.unit}</span><span>{offer.color} · {offer.shape} · {offer.quality}</span><span>Location: {offer.district}, {offer.region}, {offer.country}</span><strong className="private-offer-total-price">Seller’s offer — buyer should pay a total of: {amount(offer.total_price, offer.currency)}</strong></div>
                  : <div className="private-offer-compare-column"><span className="private-offer-compare-title">Buyer’s original request</span><strong>{selectedPrivateThread.request.mineral_name}</strong><span>{selectedPrivateThread.request.weight} {selectedPrivateThread.request.unit}</span><span>{selectedPrivateThread.request.color} · {selectedPrivateThread.request.shape} · {selectedPrivateThread.request.quality}</span><span>Location: {selectedPrivateThread.request.location}</span><strong className="private-offer-request-price">Buyer’s requested offer: {amount(selectedPrivateThread.request.offer, selectedPrivateThread.request.currency)}</strong></div>}
                {selectedPrivateThread.request.currency === offer.currency && <p className="private-offer-difference">{offerDifference(selectedPrivateThread.request.offer, offer.total_price, offer.currency, selectedPrivateThread.side)}</p>}
              </div>
            : <p>Seller’s offer — buyer should pay a total of: <strong>{amount(offer.total_price, offer.currency)}</strong>{offer.seller_amount !== undefined && offer.platform_fee_amount !== undefined ? ` · Seller price ${amount(offer.seller_amount, offer.currency)} + Madinimarket fee ${amount(offer.platform_fee_amount, offer.currency)}` : ""}</p>}
          {offer.signed_certificate_url
            ? <a className="certificate-file-link" href={offer.signed_certificate_url} target="_blank" rel="noreferrer">View mineral certificate{offer.certificate_file_name ? `: ${offer.certificate_file_name}` : ""}</a>
            : selectedPrivateThread.side === "buyer"
              ? <p className="commerce-warning"><strong>No mineral certificate uploaded. Accept this offer at your own risk.</strong></p>
              : <p className="commerce-note"><strong>No mineral certificate was uploaded with this offer.</strong></p>}
          {selectedPrivateThread.side === "buyer" && offer.status === "pending" && <div className="commerce-private-actions"><button className="button button-dark" type="button" onClick={() => { setAcceptOffer(offer); setAcceptRequestOffer(selectedPrivateThread.request?.offer ?? null); setAcceptRequestCurrency(selectedPrivateThread.request?.currency ?? offer.currency); setAcceptRequestDetails(selectedPrivateThread.request); }}>Accept to buy</button><button className="button button-outline" type="button" onClick={() => { setDeclineOffer(offer); setDeclineReason(""); setDeclineExplanation(""); }}>Decline offer</button></div>}
          {selectedPrivateThread.side === "seller" && offer.status === "declined" && <p className="commerce-warning"><strong>Buyer declined:</strong> {offer.decline_reason}{offer.decline_explanation ? ` — ${offer.decline_explanation}` : ""}<br />Remaining offer attempts: {Math.max(0, 3 - offer.attempt_number)}.</p>}
          {selectedPrivateThread.side === "seller" && (offer.status === "accepted" || offer.status === "awaiting_buyer_checkout") && <p className="commerce-note"><strong>Buyer accepted your offer.</strong> The buyer can now enter delivery details.</p>}
        </div>)}
        {selectedPrivateThread.side === "buyer" && selectedPrivateThread.offers[selectedPrivateThread.offers.length - 1]?.status === "awaiting_buyer_checkout" && <form className="commerce-checkout" onSubmit={(event) => { event.preventDefault(); const offer = selectedPrivateThread.offers[selectedPrivateThread.offers.length - 1]; void performPrivateOffer(`checkout-offer-${offer.id}`, { action: "checkout_offer", offerId: offer.id, buyerName, buyerPhone, country, region, district, address }); }}>
          <h4>Confirm mineral and delivery details</h4>
          <p className="commerce-note">{selectedPrivateThread.offers[selectedPrivateThread.offers.length - 1]?.availability_confirmed_at
            ? "The seller confirmed availability when sending this offer. Confirm your delivery details to create the order; the payment deadline starts after checkout."
            : "Confirm your delivery details to create the order. The seller must confirm availability before the payment window begins."}</p>
          <label className="field-label">Buyer name<input className="text-input" required maxLength={120} value={buyerName} onChange={(event) => setBuyerName(event.target.value)} /></label>
          <label className="field-label">Phone number<input className="text-input" required maxLength={40} value={buyerPhone} onChange={(event) => setBuyerPhone(event.target.value)} /></label>
          <div className="field-row"><label className="field-label">Country<input className="text-input" required value={country} onChange={(event) => setCountry(event.target.value)} /></label><label className="field-label">Region<input className="text-input" required value={region} onChange={(event) => setRegion(event.target.value)} /></label><label className="field-label">District<input className="text-input" required value={district} onChange={(event) => setDistrict(event.target.value)} /></label><label className="field-label">Street / address<input className="text-input" required maxLength={300} value={address} onChange={(event) => setAddress(event.target.value)} /></label></div>
          <button className="button button-dark" type="submit">Confirm and continue</button>
          <button className="button button-outline" type="button" disabled={busy !== ""} onClick={() => {
            const offer = selectedPrivateThread.offers[selectedPrivateThread.offers.length - 1];
            if (window.confirm("Cancel this accepted offer and make your buyer request available for new offers again?")) {
              void performPrivateOffer(`cancel-acceptance-${offer.id}`, { action: "cancel_offer_acceptance", offerId: offer.id });
            }
          }}>Cancel accepted offer</button>
        </form>}
        {selectedPrivateThread.side === "seller" && selectedPrivateThread.state === "open" && ["declined", "closed"].includes(selectedPrivateThread.offers[selectedPrivateThread.offers.length - 1]?.status ?? "") && selectedPrivateThread.attempt_count < 3 && selectedPrivateThread.request && data.privateOffers.feeRate !== null && <div className="commerce-revised-offer"><h4>{selectedPrivateThread.offers[selectedPrivateThread.offers.length - 1]?.status === "closed" ? "Send a new offer" : "Send a revised offer"} ({selectedPrivateThread.attempt_count}/3 used)</h4><PrivateOfferForm requestId={selectedPrivateThread.request_id} threadId={selectedPrivateThread.id} feeRate={data.privateOffers.feeRate} usdEnabled={data.privateOffers.usdEnabled} defaultCurrency={data.privateOffers.usdEnabled ? selectedPrivateThread.request.currency : "TZS"} submitting={busy === `revise-offer-${selectedPrivateThread.id}`} onSubmit={(details) => void performPrivateOffer(`revise-offer-${selectedPrivateThread.id}`, details)} /></div>}
        <div className="dialog-actions">
          {selectedPrivateThread.state === "open" && <button className="button button-outline" type="button" disabled={busy !== ""} onClick={() => {
            const isSeller = selectedPrivateThread.side === "seller";
            if (window.confirm(isSeller
              ? "Withdraw this offer? The buyer will no longer be able to accept it."
              : "Close this private offer? No more offers or revised attempts can be sent.")) {
              void performPrivateOffer(`close-offer-${selectedPrivateThread.id}`, { action: "close_offer_thread", threadId: selectedPrivateThread.id });
            }
          }}>{selectedPrivateThread.side === "seller" ? "Withdraw offer" : "Close offer"}</button>}
          {selectedPrivateThread.state === "closed" && <button className="button button-outline" type="button" disabled={busy !== ""} onClick={() => { if (window.confirm("Delete this closed private offer from your view?")) void performPrivateOffer(`delete-offer-${selectedPrivateThread.id}`, { action: "delete_closed_offer_thread", threadId: selectedPrivateThread.id }); }}>Delete closed offer</button>}
          <button className="button button-dark" type="button" onClick={() => setSelectedPrivateThreadId(null)}>Close panel</button>
        </div>
      </div>
    </div>}
    {(acceptOffer || declineOffer) && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) { setAcceptOffer(null); setDeclineOffer(null); } }}>
      {acceptOffer && <div className="dialog-card commerce-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="accept-offer-title">
        <div className="dialog-kicker">CONFIRM PURCHASE</div>
        <h2 id="accept-offer-title">Accept this offer to buy?</h2>
        {acceptRequestOffer !== null && <p><strong>Your requested offer:</strong> {amount(acceptRequestOffer, acceptRequestCurrency)}</p>}
        <p><strong>Seller’s offer — buyer should pay a total of:</strong> {amount(acceptOffer.total_price, acceptOffer.currency)}</p>
        {acceptRequestDetails && <div className="commerce-note"><strong>Compared mineral details</strong><br />Your request: {acceptRequestDetails.mineral_name}, {acceptRequestDetails.weight} {acceptRequestDetails.unit}, {acceptRequestDetails.color}, {acceptRequestDetails.shape}, {acceptRequestDetails.quality}, {acceptRequestDetails.location}<br />Seller offer: {acceptOffer.mineral_name}, {acceptOffer.weight} {acceptOffer.unit}, {acceptOffer.color}, {acceptOffer.shape}, {acceptOffer.quality}, {acceptOffer.district}, {acceptOffer.region}, {acceptOffer.country}</div>}
        {acceptOffer.signed_certificate_url
          ? <p><strong>Mineral certificate:</strong> Available to view privately.</p>
          : <p className="commerce-warning"><strong>No mineral certificate uploaded. Accept this offer at your own risk.</strong></p>}
        <p className="commerce-note"><strong>You will not pay until checkout.</strong> {acceptOffer.availability_confirmed_at
          ? "The seller confirmed availability with this offer. Confirming your delivery details starts the payment window."
          : "The seller will confirm availability after checkout."}</p>
        <p className="commerce-warning">By clicking Accept to Buy, you agree to purchase this mineral at the seller’s offered total price of {amount(acceptOffer.total_price, acceptOffer.currency)}.</p>
        <div className="dialog-actions"><button type="button" className="button button-outline" onClick={() => setAcceptOffer(null)}>Cancel</button><button type="button" className="button button-dark" disabled={busy !== ""} onClick={() => { const offer = acceptOffer; setAcceptOffer(null); void performPrivateOffer(`offer-${offer.id}`, { action: "decide_offer", offerId: offer.id, agree: true }); }}>Accept to Buy</button></div>
      </div>}
      {declineOffer && <form className="dialog-card commerce-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="decline-offer-title" onSubmit={(event) => { event.preventDefault(); const offer = declineOffer; if (!declineReason) return; setDeclineOffer(null); void performPrivateOffer(`offer-${offer.id}`, { action: "decide_offer", offerId: offer.id, agree: false, declineReason, declineExplanation }); }}>
        <div className="dialog-kicker">DECLINE OFFER</div>
        <h2 id="decline-offer-title">Decline this offer?</h2>
        <p className="commerce-note">The seller will see your reason. <strong>This action cannot be undone.</strong></p>
        <label className="field-label">Reason<select className="text-input" required value={declineReason} onChange={(event) => setDeclineReason(event.target.value)}><option value="">Choose a reason</option><option>Price is too high</option><option>Mineral details do not match</option><option>Certificate is missing or unsuitable</option><option>Photo is unclear</option><option>Changed my mind</option><option>Other reason</option></select></label>
        <label className="field-label">Additional explanation<textarea className="text-input" maxLength={500} value={declineExplanation} onChange={(event) => setDeclineExplanation(event.target.value)} /></label>
        <div className="dialog-actions"><button type="button" className="button button-outline" onClick={() => setDeclineOffer(null)}>Cancel</button><button type="submit" className="button button-dark" disabled={busy !== "" || !declineReason}>Yes, decline offer</button></div>
      </form>}
    </div>}
  </div>;
}
