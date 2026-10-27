"use client";

import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

type OrderTimeLimits = {
  sellerConfirmationHours: number;
  buyerPaymentHours: number;
  updatedAt: string | null;
};

const defaultLimits: OrderTimeLimits = {
  sellerConfirmationHours: 6,
  buyerPaymentHours: 2,
  updatedAt: null,
};

function validLimits(value: unknown): value is OrderTimeLimits {
  if (typeof value !== "object" || value === null) return false;
  const limits = value as Record<string, unknown>;
  return Number.isInteger(limits.sellerConfirmationHours) &&
    typeof limits.sellerConfirmationHours === "number" &&
    limits.sellerConfirmationHours >= 1 && limits.sellerConfirmationHours <= 168 &&
    Number.isInteger(limits.buyerPaymentHours) &&
    typeof limits.buyerPaymentHours === "number" &&
    limits.buyerPaymentHours >= 1 && limits.buyerPaymentHours <= 168 &&
    (limits.updatedAt === null || typeof limits.updatedAt === "string");
}

export default function AdminOrderTimeLimits({ onNotice }: { onNotice: (message: string) => void }) {
  const [savedLimits, setSavedLimits] = useState(defaultLimits);
  const [draftLimits, setDraftLimits] = useState(defaultLimits);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError("");
    if (!isSupabaseConfigured) throw new Error("The admin service is not connected.");
    const { data: { session }, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
    if (sessionError) throw sessionError;
    if (!session) throw new Error("Admin session expired.");
    const response = await fetch("/api/admin/order-time-limits", {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not load order time limits.");
    if (!validLimits(result)) throw new Error("Saved order time limits are invalid.");
    setSavedLimits(result);
    setDraftLimits(result);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let active = true;
    const initialLoad = window.setTimeout(() => {
      void load().catch((error: unknown) => {
        if (active) {
          const message = error instanceof Error ? error.message : "Could not load order time limits.";
          setLoadError(message);
          onNotice(message);
        }
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(initialLoad);
    };
  }, [load, onNotice]);

  const changed = draftLimits.sellerConfirmationHours !== savedLimits.sellerConfirmationHours ||
    draftLimits.buyerPaymentHours !== savedLimits.buyerPaymentHours;

  const save = async () => {
    if (!Number.isInteger(draftLimits.sellerConfirmationHours) || draftLimits.sellerConfirmationHours < 1 ||
      draftLimits.sellerConfirmationHours > 168 || !Number.isInteger(draftLimits.buyerPaymentHours) ||
      draftLimits.buyerPaymentHours < 1 || draftLimits.buyerPaymentHours > 168) {
      onNotice("Enter a whole number of hours from 1 to 168 for each order window.");
      return;
    }

    setBusy(true);
    try {
      const { data: { session }, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error("Admin session expired.");
      const response = await fetch("/api/admin/order-time-limits", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sellerConfirmationHours: draftLimits.sellerConfirmationHours,
          buyerPaymentHours: draftLimits.buyerPaymentHours,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save order time limits.");
      if (!validLimits(result)) throw new Error("The saved order time limits are invalid.");
      setSavedLimits(result);
      setDraftLimits(result);
      onNotice("Order time limits saved. Pending deadlines were recalculated from when each stage began.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not save order time limits.");
    } finally {
      setBusy(false);
    }
  };

  return <section className="admin-listing-fee-panel" aria-labelledby="admin-order-time-limits-heading">
    <div className="admin-page-heading">
      <div><div className="dialog-kicker">MARKETPLACE SETTINGS</div><h1 id="admin-order-time-limits-heading">Order time limits</h1>
        <p>Choose how long sellers have to confirm stock and buyers have to submit payment. Orders expire when each deadline passes.</p></div>
    </div>
    <div className="admin-listing-fee-editor">
      <label className="field-label" htmlFor="seller-confirmation-hours">Seller availability confirmation</label>
      <div className="admin-listing-fee-input admin-order-duration-input">
        <input className="text-input" id="seller-confirmation-hours" type="number" min="1" max="168" step="1"
          value={draftLimits.sellerConfirmationHours} disabled={!loaded || busy}
          onChange={(event) => setDraftLimits((current) => ({ ...current, sellerConfirmationHours: Number(event.target.value) }))} />
        <span>hours</span>
      </div>
      <p>Sellers must confirm availability within this period after an order is placed.</p>

      <label className="field-label" htmlFor="buyer-payment-hours">Buyer payment window</label>
      <div className="admin-listing-fee-input admin-order-duration-input">
        <input className="text-input" id="buyer-payment-hours" type="number" min="1" max="168" step="1"
          value={draftLimits.buyerPaymentHours} disabled={!loaded || busy}
          onChange={(event) => setDraftLimits((current) => ({ ...current, buyerPaymentHours: Number(event.target.value) }))} />
        <span>hours</span>
      </div>
      <p>After sellers confirm availability, the buyer must submit payment before this period ends.</p>
      <div className="admin-listing-fee-actions">
        <button className="button button-dark" type="button" disabled={!loaded || busy || !changed} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button className="button button-outline" type="button" disabled={!loaded || busy || !changed}
          onClick={() => setDraftLimits(savedLimits)}>Cancel</button>
      </div>
    </div>
    <div className="admin-listing-fee-current" aria-live="polite">
      <div className="admin-listing-fee-current-heading">
        <div><span>SAVED SETTINGS</span><h2>Current saved limits</h2></div>
        <span className="admin-listing-fee-status">Current</span>
      </div>
      {loaded
        ? <><strong className="admin-listing-fee-current-value">{savedLimits.sellerConfirmationHours} hours for seller confirmation · {savedLimits.buyerPaymentHours} hours for buyer payment</strong>
          <small>{savedLimits.updatedAt ? `Updated on ${new Date(savedLimits.updatedAt).toLocaleString()}` : "Default settings"}</small>
          <small>Saving recalculates pending deadlines from the start of each stage. Orders already past the new deadline expire on the next scheduled order check.</small></>
        : <><small>{loadError || "Loading saved order time limits…"}</small>{loadError && <button className="button button-outline" type="button" onClick={() => void load().catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Could not load order time limits.";
          setLoadError(message);
          onNotice(message);
        })}>Retry loading saved settings</button>}</>}
    </div>
  </section>;
}
