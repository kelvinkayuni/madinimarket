"use client";

import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

type PaymentInstructionsSettings = {
  instructions: string;
  updatedAt: string | null;
  awaitingPaymentOrderCount: number;
};

function isSettings(value: unknown): value is PaymentInstructionsSettings {
  if (typeof value !== "object" || value === null) return false;
  const settings = value as Record<string, unknown>;
  return typeof settings.instructions === "string" &&
    (settings.updatedAt === null || typeof settings.updatedAt === "string") &&
    Number.isInteger(settings.awaitingPaymentOrderCount) &&
    typeof settings.awaitingPaymentOrderCount === "number" &&
    settings.awaitingPaymentOrderCount >= 0;
}

export default function AdminPaymentInstructions({ onNotice }: { onNotice: (message: string) => void }) {
  const [savedSettings, setSavedSettings] = useState<PaymentInstructionsSettings>({
    instructions: "",
    updatedAt: null,
    awaitingPaymentOrderCount: 0,
  });
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError("");
    if (!isSupabaseConfigured) throw new Error("The admin service is not connected.");
    const { data: { session }, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
    if (sessionError) throw sessionError;
    if (!session) throw new Error("Admin session expired.");
    const response = await fetch("/api/admin/payment-instructions", {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not load payment instructions.");
    if (!isSettings(result)) throw new Error("Saved payment instructions are invalid.");
    setSavedSettings(result);
    setDraft(result.instructions);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let active = true;
    const initialLoad = window.setTimeout(() => {
      void load().catch((error: unknown) => {
        if (active) {
          const message = error instanceof Error ? error.message : "Could not load payment instructions.";
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

  const save = async () => {
    if (draft.length > 5000) {
      onNotice("Payment instructions must be 5,000 characters or fewer.");
      return;
    }
    setBusy(true);
    try {
      const { data: { session }, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error("Admin session expired.");

      const update = async (confirmUpdateExisting: boolean): Promise<Record<string, unknown> | null> => {
        const response = await fetch("/api/admin/payment-instructions", {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ instructions: draft, confirmUpdateExisting }),
        });
        const result: unknown = await response.json();
        if (response.status === 409 && typeof result === "object" && result !== null &&
          "confirmationRequired" in result && result.confirmationRequired === true) {
          const count = "awaitingPaymentOrderCount" in result && typeof result.awaitingPaymentOrderCount === "number"
            ? result.awaitingPaymentOrderCount : 0;
          if (!window.confirm(
            `Saving will immediately replace the instructions shown on ${count} order${count === 1 ? "" : "s"} still awaiting payment. Orders already submitted for payment verification will not change. If a buyer has already paid using the old details, they should contact support before paying again. Continue?`,
          )) return null;
          return update(true);
        }
        if (!response.ok) {
          const message = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
            ? result.error : "Could not save payment instructions.";
          throw new Error(message);
        }
        if (typeof result !== "object" || result === null) throw new Error("The saved payment instructions are invalid.");
        return result as Record<string, unknown>;
      };

      const result = await update(false);
      if (!result) return;
      if (typeof result.instructions !== "string" ||
        (result.updatedAt !== null && typeof result.updatedAt !== "string") ||
        typeof result.affectedOrders !== "number") {
        throw new Error("The saved payment instructions are invalid.");
      }
      const next = {
        instructions: result.instructions,
        updatedAt: result.updatedAt,
        awaitingPaymentOrderCount: result.affectedOrders,
      };
      setSavedSettings(next);
      setDraft(next.instructions);
      onNotice(`Payment instructions saved. They now apply to ${result.affectedOrders} order${result.affectedOrders === 1 ? "" : "s"} awaiting payment.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not save payment instructions.");
    } finally {
      setBusy(false);
    }
  };

  const changed = draft !== savedSettings.instructions;

  return <section className="admin-listing-fee-panel" aria-labelledby="admin-payment-instructions-heading">
    <div className="admin-page-heading">
      <div><div className="dialog-kicker">MARKETPLACE SETTINGS</div><h1 id="admin-payment-instructions-heading">Buyer payment instructions</h1>
        <p>Set the payment destination and steps buyers see when their orders are ready for payment.</p></div>
    </div>
    <div className="admin-listing-fee-editor admin-payment-instructions-editor">
      <label className="field-label" htmlFor="marketplace-payment-instructions">Instructions shown to buyers</label>
      <textarea id="marketplace-payment-instructions" className="admin-payment-instructions-textarea"
        value={draft} maxLength={5000} disabled={!loaded || busy}
        onChange={(event) => setDraft(event.target.value)} />
      <p>Use clear, buyer-facing steps and the official payment destination. Never include a PIN, password, one-time code, or private admin instructions. Leave blank to disable payment submissions until instructions are configured.</p>
      <p><strong>{draft.length.toLocaleString()} / 5,000 characters</strong></p>
      <div className="admin-listing-fee-actions">
        <button className="button button-dark" type="button" disabled={!loaded || busy || !changed} onClick={() => void save()}>
          {busy ? "Saving…" : "Save payment instructions"}
        </button>
        <button className="button button-outline" type="button" disabled={!loaded || busy || !changed}
          onClick={() => setDraft(savedSettings.instructions)}>Cancel</button>
      </div>
    </div>
    <div className="admin-listing-fee-current" aria-live="polite">
      <div className="admin-listing-fee-current-heading">
        <div><span>CURRENT SAVED INSTRUCTIONS</span><h2>Buyer preview</h2></div>
        <span className="admin-listing-fee-status">{savedSettings.instructions ? "Active" : "Not configured"}</span>
      </div>
      {loaded
        ? <><div className="admin-payment-instructions-preview">{savedSettings.instructions || "Buyers cannot submit payment proof until instructions are configured."}</div>
          <small>{savedSettings.updatedAt ? `Updated on ${new Date(savedSettings.updatedAt).toLocaleString()}` : "No instructions saved yet"}</small>
          <small>{savedSettings.awaitingPaymentOrderCount} order{savedSettings.awaitingPaymentOrderCount === 1 ? "" : "s"} currently awaiting payment. Saving changes updates instructions for those orders as well as future payment-ready orders. Buyer panels refresh automatically while open.</small></>
        : <><small>{loadError || "Loading saved payment instructions…"}</small>{loadError && <button className="button button-outline" type="button" onClick={() => void load().catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Could not load payment instructions.";
          setLoadError(message);
          onNotice(message);
        })}>Retry loading saved settings</button>}</>}
    </div>
  </section>;
}
