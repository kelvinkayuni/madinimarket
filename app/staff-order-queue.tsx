"use client";

import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";
import StaffTaskClaim from "./staff-task-claim";

type DeliveryItem = {
  id: string;
  seller_id: string | null;
  mineral_name: string;
  weight: number | string;
  unit: string;
  status: string;
  shipping_carrier: string | null;
  tracking_number: string | null;
};
type DeliveryOrder = {
  id: string;
  control_number: string;
  created_at: string;
  items: DeliveryItem[];
};

export default function StaffOrderQueue({ username, onSignOut, onNotice }: {
  username: string;
  onSignOut: () => void;
  onNotice: (message: string) => void;
}) {
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) throw new Error("The staff service is not connected.");
    const { data: { session }, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
    if (sessionError) throw sessionError;
    if (!session) throw new Error("Staff session expired. Sign in again.");
    const response = await fetch(`/api/staff/marketplace-orders?page=${page}`, {
      headers: { Authorization: ["Bearer", session.access_token].join(" ") },
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not load delivery tasks.");
    setOrders(result.orders as DeliveryOrder[]);
    setTotalCount(Number(result.totalCount) || 0);
  }, [page]);

  useEffect(() => {
    let active = true;
    const initialLoad = window.setTimeout(() => {
      void load().catch((error: unknown) => {
        if (active) onNotice(error instanceof Error ? error.message : "Could not load delivery tasks.");
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load().catch((error: unknown) => onNotice(error instanceof Error ? error.message : "Could not refresh delivery tasks."));
      }
    }, 30_000);
    return () => {
      active = false;
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [load, onNotice]);

  const confirmDelivery = async (itemId: string, key: string, itemCount: number) => {
    setBusy(key);
    try {
      const { data: { session }, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error("Staff session expired. Sign in again.");
      const response = await fetch("/api/staff/marketplace-orders", {
        method: "PATCH",
        headers: { Authorization: ["Bearer", session.access_token].join(" "), "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      const result = await response.json();
      if (response.status === 409) {
        await load();
        onNotice("This delivery task was already completed or changed by another staff member. The queue has been refreshed.");
        return;
      }
      if (!response.ok) throw new Error(result.error ?? "Could not confirm shipment delivery.");
      await load();
      onNotice(`Carrier delivery confirmed for ${Number(result.itemsUpdated) || itemCount} shipment ${Number(result.itemsUpdated) === 1 ? "item" : "items"}.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not confirm shipment delivery.");
    } finally {
      setBusy("");
    }
  };

  const pages = Math.max(1, Math.ceil(totalCount / 25));
  return <main className="admin-shell">
    <header className="admin-header">
      <a className="admin-brand" href="#staff-home"><span className="admin-brand-name">MADINIMARKET</span><span>ORDER OPERATIONS</span></a>
      <div className="admin-header-actions"><span className="admin-account">{username}</span><button className="text-button" type="button" onClick={onSignOut}>Sign out</button></div>
    </header>
    <section className="admin-content admin-overview staff-order-queue" id="staff-home">
      <div className="admin-page-heading">
        <div><div className="dialog-kicker">ORDER OPERATIONS</div><h1>Delivery confirmation tasks</h1><p>Confirm carrier delivery only after checking the shipment tracking status. Payment, payout, refund, and dispute decisions remain with the owner administrator.</p></div>
        <button className="button button-outline" type="button" disabled={busy !== ""} onClick={() => {
          setBusy("refresh");
          void load().then(() => onNotice("Delivery tasks refreshed.")).catch((error: unknown) => onNotice(error instanceof Error ? error.message : "Could not refresh delivery tasks.")).finally(() => setBusy(""));
        }}>{busy === "refresh" ? "Refreshing…" : "Refresh"}</button>
      </div>
      <p className="commerce-note">{totalCount} shipment task{totalCount === 1 ? "" : "s"} awaiting carrier delivery confirmation.</p>
      {loading ? <p className="dialog-copy">Loading delivery tasks…</p> : orders.length ? <div className="commerce-list">
        {orders.map((order) => {
          const shipments = new Map<string, DeliveryItem[]>();
          for (const item of order.items) {
            const key = `${item.seller_id ?? ""}\u0000${item.shipping_carrier ?? ""}\u0000${item.tracking_number ?? ""}`;
            const group = shipments.get(key) ?? [];
            group.push(item);
            shipments.set(key, group);
          }
          return <article className="commerce-order" key={order.id}>
            <div className="commerce-order-details">
              <h2>Order {order.control_number}</h2>
              <p>Created {new Date(order.created_at).toLocaleString()}</p>
              {[...shipments.entries()].map(([key, items]) => {
                const first = items[0];
                return <div className="commerce-delivery-details" key={key}>
                  <strong>{first.shipping_carrier} · Tracking {first.tracking_number}</strong>
                  <ul>{items.map((item) => <li key={item.id}>{item.mineral_name} · {item.weight} {item.unit}</li>)}</ul>
                  <StaffTaskClaim type="marketplace_order_item" taskId={first.id} onNotice={onNotice}>
                    {({ canAct }) => <button className="button button-dark" type="button" disabled={!canAct || busy !== ""} onClick={() => void confirmDelivery(first.id, key, items.length)}>
                      {busy === key ? "Confirming…" : `Confirm carrier delivery for ${items.length} ${items.length === 1 ? "item" : "items"}`}
                    </button>}
                  </StaffTaskClaim>
                </div>;
              })}
            </div>
          </article>;
        })}
      </div> : <p className="commerce-note">No shipment delivery confirmations are currently waiting.</p>}
      {pages > 1 && <div className="commerce-pagination">
        <span>Page {page} of {pages}</span>
        <div><button className="button button-outline" type="button" disabled={page <= 1 || busy !== ""} onClick={() => { setLoading(true); setPage((current) => current - 1); }}>Previous</button>
          <button className="button button-outline" type="button" disabled={page >= pages || busy !== ""} onClick={() => { setLoading(true); setPage((current) => current + 1); }}>Next</button></div>
      </div>}
    </section>
  </main>;
}
