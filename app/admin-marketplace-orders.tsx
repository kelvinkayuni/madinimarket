"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

type Currency = "TZS" | "USD";
type Item = {
  id: string;
  seller_id: string | null;
  mineral_name: string;
  weight: string | number;
  unit: string;
  seller_email: string;
  total_price: string | number;
  seller_amount: string | number;
  platform_fee_amount: string | number;
  currency: Currency;
  status: string;
  shipping_carrier: string | null;
  tracking_number: string | null;
  delivered_at: string | null;
  dispute_reason: string | null;
  payout_reference: string | null;
  payout_receipt_url: string | null;
  refund_reference: string | null;
  payout_bank_name: string | null;
  payout_bank_account_number: string | null;
  payout_bank_account_holder_name: string | null;
  payout_bank_snapshot_at: string | null;
};
type Order = {
  id: string;
  control_number: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string;
  delivery_country: string;
  delivery_region: string;
  delivery_district: string;
  delivery_address: string;
  payment_status: string;
  payment_reference: string | null;
  payment_proof_url: string | null;
  payment_note: string | null;
  total_amount: string | number;
  currency: Currency;
  payment_deadline: string | null;
  created_at: string;
  items: Item[];
};

type OrderFilter =
  | "needs_action"
  | "active"
  | "payment_submitted"
  | "awaiting_sellers"
  | "awaiting_payment"
  | "delivery_due"
  | "receipt_confirmation"
  | "disputes"
  | "payout_due"
  | "refund_due"
  | "completed"
  | "history"
  | "all";

const money = (value: string | number, currency: Currency) =>
  `${currency === "TZS" ? "TSh" : "$"} ${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: currency === "USD" ? 2 : 0,
    maximumFractionDigits: currency === "USD" ? 2 : 0,
  }).format(Number(value))}`;

function orderIsCompleted(order: Order) {
  const terminalItemStatuses = ["unavailable", "payout_paid", "refunded", "expired", "cancelled"];
  return order.payment_status === "paid" &&
    order.items.length > 0 &&
    order.items.every((item) => terminalItemStatuses.includes(item.status));
}

function orderQueueLabel(order: Order) {
  if (order.payment_status === "payment_submitted") return "Payment verification";
  if (order.items.some((item) => item.status === "disputed")) return "Open dispute";
  if (order.items.some((item) => item.status === "payout_due")) return "Payout due";
  if (order.items.some((item) => item.status === "refund_due")) return "Refund due";
  if (order.items.some((item) =>
    ["paid", "shipped"].includes(item.status) && item.shipping_carrier?.trim() && item.tracking_number?.trim(),
  )) return "Delivery confirmation";
  if (order.items.some((item) => item.status === "delivered")) return "Orders awaiting receipt confirmation";
  if (orderIsCompleted(order)) return "Completed";
  return order.payment_status.replaceAll("_", " ");
}

function orderNeedsAdminAttention(order: Order) {
  return order.payment_status === "payment_submitted" || order.items.some((item) =>
    ["disputed", "payout_due", "refund_due"].includes(item.status) ||
    (["paid", "shipped"].includes(item.status) && Boolean(item.shipping_carrier?.trim()) && Boolean(item.tracking_number?.trim())),
  );
}

export default function AdminMarketplaceOrders({ onNotice, marketplaceOrdersNeedingAction }: {
  onNotice: (message: string) => void;
  marketplaceOrdersNeedingAction: number;
}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState<OrderFilter>("needs_action");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const loadSequence = useRef(0);
  const [payoutReferences, setPayoutReferences] = useState<Record<string, string>>({});
  const [payoutReceipts, setPayoutReceipts] = useState<Record<string, File | undefined>>({});
  const [refundReferences, setRefundReferences] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const requestSequence = ++loadSequence.current;
    if (!isSupabaseConfigured) throw new Error("The admin service is not connected.");
    const { data: { session }, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
    if (sessionError) throw sessionError;
    if (!session) throw new Error("Admin session expired.");
    const params = new URLSearchParams({ filter, search, page: String(page) });
    const response = await fetch(`/api/admin/marketplace-orders?${params}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
    const result = await response.json();
    if (requestSequence !== loadSequence.current) return;
    if (!response.ok) throw new Error(result.error ?? "Could not load marketplace orders.");
    if (page > Math.max(1, Math.ceil(Number(result.totalCount ?? 0) / 25))) {
      setLoading(true);
      setPage(Math.max(1, Math.ceil(Number(result.totalCount ?? 0) / 25)));
      return;
    }
    setOrders(result.orders as Order[]);
    setTotalCount(result.totalCount as number);
  }, [filter, page, search]);

  useEffect(() => {
    let active = true;
    const initialLoad = window.setTimeout(() => {
      void load().catch((error: unknown) => {
        if (active) onNotice(error instanceof Error ? error.message : "Could not load marketplace orders.");
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load().catch((error: unknown) => {
        if (active) onNotice(error instanceof Error ? error.message : "Could not refresh marketplace orders.");
      });
    }, 30_000);
    return () => {
      active = false;
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [load, onNotice]);

  const act = async (key: string, values: Record<string, string>) => {
    setBusy(key);
    try {
      const { data: { session }, error } = await getSupabaseBrowserClient().auth.getSession();
      if (error) throw error;
      if (!session) throw new Error("Admin session expired.");
      const response = await fetch("/api/admin/marketplace-orders", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not update the order.");
      if (result.warning) onNotice(result.warning);
      await load();
      onNotice("Marketplace order updated.");
      return true;
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not update the order.");
      return false;
    } finally {
      setBusy("");
    }
  };

  const recordPayout = async (itemId: string) => {
    const reference = payoutReferences[itemId]?.trim() ?? "";
    const receipt = payoutReceipts[itemId];
    if (reference.length < 3 || !receipt) {
      onNotice("Enter the payout reference and attach its receipt.");
      return;
    }

    setBusy(`payout-${itemId}`);
    try {
      const { data: { session }, error } = await getSupabaseBrowserClient().auth.getSession();
      if (error) throw error;
      if (!session) throw new Error("Admin session expired.");
      const form = new FormData();
      form.set("itemId", itemId);
      form.set("reference", reference);
      form.set("receipt", receipt);
      const response = await fetch("/api/admin/marketplace-orders", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not record the seller payout.");
      await load();
      setPayoutReferences((current) => ({ ...current, [itemId]: "" }));
      setPayoutReceipts((current) => ({ ...current, [itemId]: undefined }));
      onNotice("Seller payout and receipt recorded.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not record the seller payout.");
    } finally {
      setBusy("");
    }
  };

  return <section className="admin-overview admin-commerce-orders">
    <div className="admin-page-heading">
      <div><div className="dialog-kicker">BUYER PAYMENTS & SELLER PAYOUTS</div><h1>Marketplace orders</h1>
        <p><strong>{marketplaceOrdersNeedingAction}</strong> order{marketplaceOrdersNeedingAction === 1 ? "" : "s"} need admin action. Orders requiring the most urgent action are shown first.</p></div>
      <button className="button button-outline" type="button" disabled={busy === "refresh"} onClick={() => {
        setBusy("refresh");
        void load().then(() => onNotice("Marketplace orders refreshed.")).catch((error: unknown) => onNotice(error instanceof Error ? error.message : "Could not refresh orders.")).finally(() => setBusy(""));
      }}>{busy === "refresh" ? "Refreshing…" : "Refresh"}</button>
    </div>
    <div className="admin-order-tools">
      <form className="admin-order-search" onSubmit={(event) => {
        event.preventDefault();
        setPage(1);
        setLoading(true);
        setSearch(searchInput.trim());
      }}>
        <label className="field-label">Search orders<input className="text-input" value={searchInput} maxLength={80} placeholder="Order number, buyer name, or email" onChange={(event) => setSearchInput(event.target.value)} /></label>
        <button className="button button-dark" type="submit">Search</button>
        {search && <button className="button button-outline" type="button" onClick={() => {
          setSearch("");
          setSearchInput("");
          setPage(1);
          setLoading(true);
        }}>Clear search</button>}
      </form>
      <label className="field-label admin-order-filter">Show
        <select className="text-input" value={filter} onChange={(event) => {
          setFilter(event.target.value as OrderFilter);
          setPage(1);
          setLoading(true);
        }}>
          <option value="needs_action">Needs admin action</option>
          <option value="active">Active orders</option>
          <option value="payment_submitted">Payments awaiting verification</option>
          <option value="awaiting_sellers">Awaiting seller responses</option>
          <option value="awaiting_payment">Awaiting buyer payment</option>
          <option value="delivery_due">Delivery confirmation</option>
          <option value="receipt_confirmation">Orders awaiting receipt confirmation</option>
          <option value="disputes">Open disputes</option>
          <option value="payout_due">Seller payouts due</option>
          <option value="refund_due">Buyer refunds due</option>
          <option value="completed">Completed</option>
          <option value="history">Order history</option>
          <option value="all">All orders</option>
        </select>
      </label>
    </div>
    {orders.length ? <div className="commerce-list">
      {orders.map((order) => <details className="commerce-order admin-commerce-order" key={order.id}>
        <summary className="admin-commerce-summary">
          <strong>{order.control_number}</strong>
          <span>{order.buyer_name} · {order.buyer_email}</span>
          <span>{money(order.total_amount, order.currency)}</span>
          <span>{new Date(order.created_at).toLocaleDateString()}</span>
          <span className={`admin-order-status${orderNeedsAdminAttention(order) ? " needs-action" : orderIsCompleted(order) ? " completed" : ""}`}>{orderQueueLabel(order)}</span>
        </summary>
        <div className="admin-commerce-order-details">
        <p>{money(order.total_amount, order.currency)} · Created {new Date(order.created_at).toLocaleString()}</p>
        <p>Buyer: {order.buyer_name} · {order.buyer_email} · {order.buyer_phone}</p>
        <p>Delivery: {order.delivery_address}, {order.delivery_district}, {order.delivery_region}, {order.delivery_country}</p>
        {order.payment_reference && <p>Buyer payment reference: <strong>{order.payment_reference}</strong>{order.payment_note ? ` · ${order.payment_note}` : ""}</p>}
        {order.payment_proof_url && <p><a className="certificate-file-link" href={order.payment_proof_url} target="_blank" rel="noreferrer">Open submitted payment proof</a></p>}
        {order.payment_status === "payment_submitted" && <button className="button button-dark" type="button" disabled={busy === `verify-${order.id}`} onClick={() => void act(`verify-${order.id}`, { action: "verify_payment", orderId: order.id })}>{busy === `verify-${order.id}` ? "Verifying payment & notifying sellers…" : "Verify payment & notify sellers"}</button>}
        {(() => {
          const shipmentGroups = new Map<string, Item[]>();
          for (const item of order.items) {
            if (!["paid", "shipped"].includes(item.status) || !item.shipping_carrier?.trim() || !item.tracking_number?.trim()) continue;
            const shipmentKey = JSON.stringify([item.seller_id, item.shipping_carrier, item.tracking_number]);
            const group = shipmentGroups.get(shipmentKey) ?? [];
            group.push(item);
            shipmentGroups.set(shipmentKey, group);
          }
          return shipmentGroups.size > 0 && <div className="admin-shipment-groups">
            {[...shipmentGroups.entries()].map(([shipmentKey, items]) => {
              const firstItem = items[0];
              return <div className="admin-shipment-group" key={shipmentKey}>
                <strong>Shipment · {items.length} {items.length === 1 ? "item" : "items"}</strong>
                <span>Carrier: {firstItem.shipping_carrier} · Tracking: {firstItem.tracking_number}</span>
                <small>Confirming delivery will update every item below that shares this shipment tracking.</small>
                <ul>{items.map((shipmentItem) => <li key={shipmentItem.id}>{shipmentItem.mineral_name} · {shipmentItem.weight} {shipmentItem.unit}</li>)}</ul>
                <button className="button button-outline" type="button" disabled={busy === `delivered-${firstItem.id}`} onClick={() => {
                  if (window.confirm(`Confirm that the carrier's tracking shows this shipment of ${items.length} ${items.length === 1 ? "item" : "items"} as delivered?`)) {
                    void act(`delivered-${firstItem.id}`, { action: "mark_delivered", itemId: firstItem.id });
                  }
                }}>Confirm delivery for all {items.length} {items.length === 1 ? "item" : "items"}</button>
              </div>;
            })}
          </div>;
        })()}
        {order.items.map((item) => <div className="admin-commerce-item" key={item.id}>
          <div><strong>{item.mineral_name} · {item.weight} {item.unit}</strong>
            <small>Status: {item.status.replaceAll("_", " ")} · Buyer total {money(item.total_price, item.currency)}</small>
            <small>Seller amount {money(item.seller_amount, item.currency)} · Market fee {money(item.platform_fee_amount, item.currency)}</small>
            <small>Seller contact: {item.seller_email}</small>
            {item.status === "payout_due" && <div className="admin-payout-bank-details">
              <strong>Seller bank details</strong>
              {item.payout_bank_name && item.payout_bank_account_number && item.payout_bank_account_holder_name ? <>
                <span>Bank Name: {item.payout_bank_name}</span>
                <span>Account Number: {item.payout_bank_account_number}</span>
                <span>Account Holder Name: {item.payout_bank_account_holder_name}</span>
                {item.payout_bank_snapshot_at && <small>Details captured {new Date(item.payout_bank_snapshot_at).toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam" })} Tanzania time</small>}
              </> : item.payout_bank_snapshot_at
                ? <span className="commerce-warning">No bank details were available when this payout became due.</span>
                : <span className="commerce-warning">No historical bank detail snapshot is available for this payout. Verify the seller’s current bank information before transferring.</span>}
            </div>}
            {item.shipping_carrier && <small>Tracking: {item.shipping_carrier} · {item.tracking_number}</small>}
            {item.dispute_reason && <p className="commerce-warning">Buyer dispute: {item.dispute_reason}</p>}
            {item.payout_reference && <small>Seller payout reference: {item.payout_reference}</small>}
            {item.status === "payout_paid" && <div className="admin-payout-bank-details">
              <strong>Bank account paid to</strong>
              {item.payout_bank_name && item.payout_bank_account_number && item.payout_bank_account_holder_name ? <>
                <span>Bank Name: {item.payout_bank_name}</span>
                <span>Account Number: {item.payout_bank_account_number}</span>
                <span>Account Holder Name: {item.payout_bank_account_holder_name}</span>
                {item.payout_bank_snapshot_at && <small>Details captured {new Date(item.payout_bank_snapshot_at).toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam" })} Tanzania time</small>}
              </> : <span className="commerce-warning">No bank account details were recorded for this payout.</span>}
            </div>}
            {item.payout_receipt_url && <small><a className="certificate-file-link" href={item.payout_receipt_url} target="_blank" rel="noreferrer">Open seller payout receipt</a></small>}
            {item.refund_reference && <small>Buyer refund reference: {item.refund_reference}</small>}
          </div>
          {["paid", "shipped"].includes(item.status) && (!item.shipping_carrier?.trim() || !item.tracking_number?.trim()) && <small className="commerce-warning">The seller must enter both carrier and tracking number before delivery can be confirmed.</small>}
          {item.status === "disputed" && <div className="commerce-item-actions">
            <button className="button button-dark" type="button" disabled={busy === `seller-resolution-${item.id}`} onClick={() => void act(`seller-resolution-${item.id}`, { action: "resolve_dispute", itemId: item.id, outcome: "seller" })}>Resolve for seller (payout due)</button>
            <button className="button button-outline" type="button" disabled={busy === `buyer-resolution-${item.id}`} onClick={() => void act(`buyer-resolution-${item.id}`, { action: "resolve_dispute", itemId: item.id, outcome: "buyer" })}>Resolve for buyer (refund due)</button>
          </div>}
          {item.status === "payout_due" && <form className="admin-reference-form" onSubmit={(event) => {
            event.preventDefault();
            void recordPayout(item.id);
          }}>
            <label className="field-label">Seller payout transaction reference
              <input className="text-input" required minLength={3} maxLength={120} value={payoutReferences[item.id] ?? ""} onChange={(event) => setPayoutReferences((current) => ({ ...current, [item.id]: event.target.value }))} />
            </label>
            <label className="field-label">Payout receipt (PDF, JPEG, or PNG; up to 4 MB)
              <input className="text-input" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" required onChange={(event) => setPayoutReceipts((current) => ({ ...current, [item.id]: event.target.files?.[0] }))} />
            </label>
            <button className="button button-dark" type="submit" disabled={busy === `payout-${item.id}` || (payoutReferences[item.id]?.trim().length ?? 0) < 3 || !payoutReceipts[item.id]}>{busy === `payout-${item.id}` ? "Recording…" : "Record seller payout"}</button>
          </form>}
          {item.status === "refund_due" && <form className="admin-reference-form" onSubmit={(event) => {
            event.preventDefault();
            const reference = refundReferences[item.id]?.trim() ?? "";
            if (reference.length < 3) {
              onNotice("Enter the completed buyer refund transaction reference.");
              return;
            }
            void act(`refund-${item.id}`, { action: "mark_refunded", itemId: item.id, reference }).then((success) => {
              if (success) setRefundReferences((current) => ({ ...current, [item.id]: "" }));
            });
          }}>
            <label className="field-label">Buyer refund transaction reference
              <input className="text-input" required minLength={3} maxLength={120} value={refundReferences[item.id] ?? ""} onChange={(event) => setRefundReferences((current) => ({ ...current, [item.id]: event.target.value }))} />
            </label>
            <button className="button button-outline" type="submit" disabled={busy === `refund-${item.id}` || (refundReferences[item.id]?.trim().length ?? 0) < 3}>{busy === `refund-${item.id}` ? "Recording…" : "Record buyer refund"}</button>
          </form>}
        </div>)}
        </div>
      </details>)}
    </div> : <p className="admin-empty">{loading ? "Loading marketplace orders…" : "No orders match this filter and search."}</p>}
    <div className="admin-order-pagination">
      <span>{totalCount ? `Showing ${(page - 1) * 25 + 1}–${Math.min(page * 25, totalCount)} of ${totalCount} orders` : "No matching orders"}</span>
      <div>
        <button className="button button-outline" type="button" disabled={loading || page <= 1} onClick={() => {
          setPage((current) => Math.max(1, current - 1));
          setLoading(true);
        }}>Previous</button>
        <span>Page {page} of {Math.max(1, Math.ceil(totalCount / 25))}</span>
        <button className="button button-outline" type="button" disabled={loading || page >= Math.ceil(totalCount / 25)} onClick={() => {
          setPage((current) => current + 1);
          setLoading(true);
        }}>Next</button>
      </div>
    </div>
    <p className="commerce-note">Payment collection, holding buyer funds, seller bank/mobile-money transfers, and refunds are recorded manually. The app does not custody or automatically transfer money.</p>
  </section>;
}
