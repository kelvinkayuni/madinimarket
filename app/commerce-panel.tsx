"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

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
};
type CartItem = { id: string; listing_id: number; listing: CartListing | null };
type OrderItem = {
  id: string;
  mineral_name: string;
  weight: number;
  unit: string;
  total_price: string | number;
  seller_amount: string | number;
  platform_fee_amount: string | number;
  currency: Currency;
  status: string;
  seller_response_deadline: string;
  seller_responded_at: string | null;
  shipping_carrier: string | null;
  tracking_number: string | null;
  delivered_at: string | null;
  disputed_at: string | null;
  dispute_reason: string | null;
  payout_reference: string | null;
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
  paymentInstructions: string;
};

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

export default function CommercePanel({ onNotice, onCartCount }: { onNotice: (message: string) => void; onCartCount: (count: number) => void }) {
  const [data, setData] = useState<CommerceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
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

  const refresh = useCallback(async () => {
    const response = await fetch("/api/commerce", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not load your cart and orders.");
    const commerce = result as CommerceData;
    setData(commerce);
    onCartCount(commerce.cartItems.length);
    setBuyerName((current) => current || commerce.profile.display_name || "");
    setBuyerPhone((current) => current || commerce.profile.phone || "");
    setCountry((current) => current || commerce.profile.delivery_country || "");
    setRegion((current) => current || commerce.profile.delivery_region || "");
    setDistrict((current) => current || commerce.profile.delivery_district || "");
    setAddress((current) => current || commerce.profile.delivery_address || "");
    setLoading(false);
  }, [onCartCount]);

  useEffect(() => {
    let active = true;
    void fetch("/api/commerce", { cache: "no-store" }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not load your cart and orders.");
      return result as CommerceData;
    }).then((commerce) => {
      if (!active) return;
      setData(commerce);
      onCartCount(commerce.cartItems.length);
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
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh().catch((error: unknown) => {
        if (active) onNotice(error instanceof Error ? error.message : "Could not refresh your orders.");
      });
    }, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [onCartCount, onNotice, refresh]);

  const perform = async (key: string, action: string, values: Record<string, unknown>) => {
    setBusy(key);
    try {
      const response = await fetch("/api/commerce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...values }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The request could not be completed.");
      if (result.warning) onNotice(result.warning);
      await refresh();
      return result;
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "The request could not be completed.");
      return null;
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
      onNotice(`Order ${result.order.control_number} confirmed. Sellers have 6 hours to respond.`);
    }
  };

  const submitPaymentProof = async (event: FormEvent<HTMLFormElement>, orderId: string) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(`payment-${orderId}`);
    try {
      const response = await fetch("/api/commerce/payment-proof", {
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

  return <div className="commerce-panel">
    <div className="dialog-kicker">BUYER & SELLER ORDERS</div>
    <h2 id="dialog-title">My cart and orders.</h2>
    <section className="commerce-section">
      <h3>My cart ({data.cartItems.length})</h3>
      {data.cartItems.length ? <>
        <div className="commerce-list">
          {data.cartItems.map((item) => <article className="commerce-item" key={item.id}>
            <div><strong>{item.listing?.mineral_name ?? "Listing no longer available"}</strong>
              {item.listing && <small>{item.listing.listing_type === "batch" ? "Batch · " : ""}{item.listing.weight} {item.listing.unit} · {amount(item.listing.price, item.listing.currency)}</small>}
              {item.listing && (!item.listing.is_active || item.listing.status !== "approved") && <small className="commerce-warning">This listing may no longer be available.</small>}
            </div>
            <button className="button button-outline" type="button" disabled={busy === `remove-${item.id}`} onClick={() => void perform(`remove-${item.id}`, "remove_from_cart", { cartItemId: item.id })}>Remove</button>
          </article>)}
        </div>
        <p className="commerce-total">Cart total <strong>{amount(total, cartCurrency)}</strong></p>
        <form className="commerce-checkout" onSubmit={checkout}>
          <h4>Confirm your order and delivery address</h4>
          <p className="commerce-note">Confirming locks the cart. Sellers will be asked to confirm availability; unavailable items will be removed before payment.</p>
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
          <button className="button button-dark" type="submit" disabled={busy === "checkout"}>{busy === "checkout" ? "Confirming…" : "Confirm order"}</button>
        </form>
      </> : <p className="commerce-note">Your cart is empty. Add a mineral from the market to begin.</p>}
    </section>

    <section className="commerce-section">
      <h3>Orders I placed</h3>
      {data.buyerOrders.length ? <div className="commerce-list">
        {data.buyerOrders.map((order) => <article className="commerce-order" key={order.id}>
          <div className="commerce-order-heading"><strong>Order {order.control_number}</strong><span>{statusLabel(order.payment_status)}</span></div>
          <p>{amount(order.total_amount, order.currency)}{order.payment_deadline && order.payment_status === "awaiting_payment" ? ` · Pay by ${new Date(order.payment_deadline).toLocaleString()}` : ""}</p>
          {order.payment_status === "awaiting_payment" && <form className="commerce-payment-form" onSubmit={(event) => void submitPaymentProof(event, order.id)}>
            <p>{data.paymentInstructions || "Payment instructions are not configured. Contact Madinimarket support before sending money."}</p>
            <label className="field-label">Payment transaction reference<input className="text-input" name="reference" required minLength={3} maxLength={120} value={paymentReferences[order.id] ?? ""} onChange={(event) => setPaymentReferences((current) => ({ ...current, [order.id]: event.target.value }))} /></label>
            <label className="field-label">Optional note<input className="text-input" name="note" maxLength={500} value={paymentNotes[order.id] ?? ""} onChange={(event) => setPaymentNotes((current) => ({ ...current, [order.id]: event.target.value }))} /></label>
            <label className="field-label">Payment receipt (PDF, JPEG, PNG · max 10 MB)<input className="text-input" name="proof" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" required onChange={(event) => {
              const fileName = event.currentTarget.files?.[0]?.name ?? "";
              setPaymentProofFiles((current) => ({ ...current, [order.id]: fileName }));
            }} /><small>{paymentProofFiles[order.id] || "Choose a receipt image or PDF"}</small></label>
            <input type="hidden" name="orderId" value={order.id} />
            <button className="button button-dark" type="submit" disabled={busy === `payment-${order.id}` || !data.paymentInstructions}>{busy === `payment-${order.id}` ? "Submitting…" : !data.paymentInstructions ? "Payment details unavailable" : "Submit proof for verification"}</button>
          </form>}
          {(order.items ?? []).map((item) => <div className="commerce-order-item" key={item.id}>
            <div><strong>{item.mineral_name} · {item.weight} {item.unit}</strong><small>{statusLabel(item.status)} · Total {amount(item.total_price, item.currency)}</small></div>
            {item.status === "delivered" && <div className="commerce-item-actions">
              <button className="button button-dark" type="button" disabled={busy === `receipt-${item.id}`} onClick={() => void perform(`receipt-${item.id}`, "confirm_receipt", { itemId: item.id })}>Confirm receipt</button>
              <label className="field-label">Report a delivery issue<textarea className="review-message" minLength={10} maxLength={500} value={disputeReasons[item.id] ?? ""} onChange={(event) => setDisputeReasons((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
              <button className="button button-outline" type="button" disabled={busy === `dispute-${item.id}`} onClick={() => void perform(`dispute-${item.id}`, "dispute_delivery", { itemId: item.id, reason: disputeReasons[item.id] })}>Open dispute</button>
            </div>}
          </div>)}
        </article>)}
      </div> : <p className="commerce-note">No purchases yet.</p>}
    </section>

    <section className="commerce-section">
      <h3>Seller order requests</h3>
      {data.sellerItems.length ? <div className="commerce-list">
        {data.sellerItems.map((item) => <article className="commerce-order-item" key={item.id}>
          <div><strong>{item.mineral_name} · {item.weight} {item.unit}</strong>
            <small>Order {item.order?.control_number} · {statusLabel(item.status)}</small>
            <small>Seller receives {amount(item.seller_amount, item.currency)} before any separately managed payout</small>
          </div>
          {item.status === "awaiting_seller" && <div className="commerce-item-actions">
            <button className="button button-dark" type="button" disabled={busy === `available-${item.id}`} onClick={() => void perform(`available-${item.id}`, "seller_availability", { itemId: item.id, available: true })}>Available</button>
            <button className="button button-outline" type="button" disabled={busy === `unavailable-${item.id}`} onClick={() => void perform(`unavailable-${item.id}`, "seller_availability", { itemId: item.id, available: false })}>Unavailable</button>
            <small>Respond by {new Date(item.seller_response_deadline).toLocaleString()}</small>
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
            <button className="button button-dark" type="button" disabled={busy === `dispatch-${item.id}`} onClick={() => void perform(`dispatch-${item.id}`, "seller_dispatch", { itemId: item.id, carrier: shipping[item.id]?.carrier, trackingNumber: shipping[item.id]?.tracking })}>Mark sent</button>
          </div>}
          {item.status === "disputed" && <p className="commerce-warning">Buyer dispute: {item.dispute_reason ?? "Awaiting admin review."}</p>}
        </article>)}
      </div> : <p className="commerce-note">No seller order requests.</p>}
    </section>
  </div>;
}
