"use client";

import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

type Currency = "TZS" | "USD";
type Item = {
  id: string;
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

const money = (value: string | number, currency: Currency) =>
  `${currency === "TZS" ? "TSh" : "$"} ${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: currency === "USD" ? 2 : 0,
    maximumFractionDigits: currency === "USD" ? 2 : 0,
  }).format(Number(value))}`;

export default function AdminMarketplaceOrders({ onNotice, pendingPaymentCount }: {
  onNotice: (message: string) => void;
  pendingPaymentCount: number;
}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [payoutReferences, setPayoutReferences] = useState<Record<string, string>>({});
  const [payoutReceipts, setPayoutReceipts] = useState<Record<string, File | undefined>>({});
  const [refundReferences, setRefundReferences] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) throw new Error("The admin service is not connected.");
    const { data: { session }, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
    if (sessionError) throw sessionError;
    if (!session) throw new Error("Admin session expired.");
    const response = await fetch("/api/admin/marketplace-orders", {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not load marketplace orders.");
    setOrders(result.orders as Order[]);
  }, []);

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

  if (loading) return <section className="admin-overview"><p>Loading marketplace orders…</p></section>;
  return <section className="admin-overview admin-commerce-orders">
    <div className="admin-page-heading">
      <div><div className="dialog-kicker">BUYER PAYMENTS & SELLER PAYOUTS</div><h1>Marketplace orders</h1>
        <p>{pendingPaymentCount} payment{pendingPaymentCount === 1 ? "" : "s"} awaiting verification. Verify buyer payments, confirm carrier delivery, resolve disputes, and record manual seller payouts/refunds.</p></div>
      <button className="button button-outline" type="button" disabled={busy === "refresh"} onClick={() => {
        setBusy("refresh");
        void load().then(() => onNotice("Marketplace orders refreshed.")).catch((error: unknown) => onNotice(error instanceof Error ? error.message : "Could not refresh orders.")).finally(() => setBusy(""));
      }}>{busy === "refresh" ? "Refreshing…" : "Refresh"}</button>
    </div>
    {orders.length ? <div className="commerce-list">
      {orders.map((order) => <article className="commerce-order admin-commerce-order" key={order.id}>
        <div className="commerce-order-heading"><strong>{order.control_number}</strong><span>{order.payment_status.replaceAll("_", " ")}</span></div>
        <p>{money(order.total_amount, order.currency)} · Created {new Date(order.created_at).toLocaleString()}</p>
        <p>Buyer: {order.buyer_name} · {order.buyer_email} · {order.buyer_phone}</p>
        <p>Delivery: {order.delivery_address}, {order.delivery_district}, {order.delivery_region}, {order.delivery_country}</p>
        {order.payment_reference && <p>Buyer payment reference: <strong>{order.payment_reference}</strong>{order.payment_note ? ` · ${order.payment_note}` : ""}</p>}
        {order.payment_proof_url && <p><a className="certificate-file-link" href={order.payment_proof_url} target="_blank" rel="noreferrer">Open submitted payment proof</a></p>}
        {order.payment_status === "payment_submitted" && <button className="button button-dark" type="button" disabled={busy === `verify-${order.id}`} onClick={() => void act(`verify-${order.id}`, { action: "verify_payment", orderId: order.id })}>Verify payment & notify sellers</button>}
        {order.items.map((item) => <div className="admin-commerce-item" key={item.id}>
          <div><strong>{item.mineral_name} · {item.weight} {item.unit}</strong>
            <small>Status: {item.status.replaceAll("_", " ")} · Buyer total {money(item.total_price, item.currency)}</small>
            <small>Seller amount {money(item.seller_amount, item.currency)} · Market fee {money(item.platform_fee_amount, item.currency)}</small>
            <small>Seller contact: {item.seller_email}</small>
            {item.shipping_carrier && <small>Tracking: {item.shipping_carrier} · {item.tracking_number}</small>}
            {item.dispute_reason && <p className="commerce-warning">Buyer dispute: {item.dispute_reason}</p>}
            {item.payout_reference && <small>Seller payout reference: {item.payout_reference}</small>}
            {item.payout_receipt_url && <small><a className="certificate-file-link" href={item.payout_receipt_url} target="_blank" rel="noreferrer">Open seller payout receipt</a></small>}
            {item.refund_reference && <small>Buyer refund reference: {item.refund_reference}</small>}
          </div>
          {["paid", "shipped"].includes(item.status) && <div className="commerce-item-actions">
            <button className="button button-outline" type="button" disabled={busy === `delivered-${item.id}` || !item.shipping_carrier?.trim() || !item.tracking_number?.trim()} onClick={() => {
              if (window.confirm("Confirm that the carrier's tracking shows this parcel as delivered?")) {
                void act(`delivered-${item.id}`, { action: "mark_delivered", itemId: item.id });
              }
            }}>Confirm carrier delivery</button>
            {(!item.shipping_carrier?.trim() || !item.tracking_number?.trim()) && <small className="commerce-warning">The seller must enter both carrier and tracking number before delivery can be confirmed.</small>}
          </div>}
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
      </article>)}
    </div> : <p className="admin-empty">No mineral purchase orders yet.</p>}
    <p className="commerce-note">Payment collection, holding buyer funds, seller bank/mobile-money transfers, and refunds are recorded manually. The app does not custody or automatically transfer money.</p>
  </section>;
}
