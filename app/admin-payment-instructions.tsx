"use client";

import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

type PaymentInstructionsSettings = {
  paymentMethods: PaymentMethod[];
  instructions: string;
  updatedAt: string | null;
  awaitingPaymentOrderCount: number;
};

type PaymentMethod = { method: string; accountNumber: string };
type DraftPaymentMethod = PaymentMethod & { prepared: boolean };

function isSettings(value: unknown): value is PaymentInstructionsSettings {
  if (typeof value !== "object" || value === null) return false;
  const settings = value as Record<string, unknown>;
  return Array.isArray(settings.paymentMethods) &&
    settings.paymentMethods.every((method) =>
      typeof method === "object" && method !== null &&
      "method" in method && typeof method.method === "string" &&
      "accountNumber" in method && typeof method.accountNumber === "string") &&
    typeof settings.instructions === "string" &&
    (settings.updatedAt === null || typeof settings.updatedAt === "string") &&
    Number.isInteger(settings.awaitingPaymentOrderCount) &&
    typeof settings.awaitingPaymentOrderCount === "number" &&
    settings.awaitingPaymentOrderCount >= 0;
}

export default function AdminPaymentInstructions({ onNotice }: { onNotice: (message: string) => void }) {
  const [savedSettings, setSavedSettings] = useState<PaymentInstructionsSettings>({
    paymentMethods: [],
    instructions: "",
    updatedAt: null,
    awaitingPaymentOrderCount: 0,
  });
  const [draftMethods, setDraftMethods] = useState<DraftPaymentMethod[]>([]);
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
    setDraftMethods(result.paymentMethods.map((method) => ({ ...method, prepared: true })));
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
    if (draftMethods.length > 10) {
      onNotice("Add no more than 10 payment methods.");
      return;
    }
    if (draftMethods.some(({ prepared }) => !prepared)) {
      onNotice("Save each payment method to the draft before saving payment instructions.");
      return;
    }
    if (draftMethods.some(({ method, accountNumber }) =>
      !method.trim() || method.trim().length > 80 || !accountNumber.trim() || accountNumber.trim().length > 200)) {
      onNotice("Complete every payment method and account number, or remove the empty row.");
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
          body: JSON.stringify({
            paymentMethods: draftMethods.map(({ method, accountNumber }) => ({ method, accountNumber })),
            instructions: draft,
            confirmUpdateExisting,
          }),
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
      if (!Array.isArray(result.paymentMethods) ||
        !result.paymentMethods.every((method) =>
          typeof method === "object" && method !== null &&
          "method" in method && typeof method.method === "string" &&
          "accountNumber" in method && typeof method.accountNumber === "string") ||
        typeof result.instructions !== "string" ||
        (result.updatedAt !== null && typeof result.updatedAt !== "string") ||
        typeof result.affectedOrders !== "number") {
        throw new Error("The saved payment instructions are invalid.");
      }
      const next = {
        paymentMethods: result.paymentMethods as PaymentMethod[],
        instructions: result.instructions,
        updatedAt: result.updatedAt,
        awaitingPaymentOrderCount: result.affectedOrders,
      };
      setSavedSettings(next);
      setDraftMethods(next.paymentMethods.map((method) => ({ ...method, prepared: true })));
      setDraft(next.instructions);
      onNotice(`Payment instructions saved. They now apply to ${result.affectedOrders} order${result.affectedOrders === 1 ? "" : "s"} awaiting payment.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not save payment instructions.");
    } finally {
      setBusy(false);
    }
  };

  const changed = draft !== savedSettings.instructions ||
    JSON.stringify(draftMethods.map(({ method, accountNumber }) => ({ method, accountNumber }))) !==
      JSON.stringify(savedSettings.paymentMethods);

  return <section className="admin-listing-fee-panel" aria-labelledby="admin-payment-instructions-heading">
    <div className="admin-page-heading">
      <div><div className="dialog-kicker">MARKETPLACE SETTINGS</div><h1 id="admin-payment-instructions-heading">Buyer payment instructions</h1>
        <p>Save reusable payment method and account details, then add any general notes buyers need before paying.</p></div>
    </div>
    <div className="admin-listing-fee-editor admin-payment-instructions-editor">
      <div className="admin-payment-methods-heading">
        <div><strong>Payment methods and accounts</strong><small>Save each method to keep it in this draft. It will not be sent to Supabase until you click “Save payment instructions” below.</small></div>
        <button className="button button-outline" type="button" disabled={!loaded || busy || draftMethods.length >= 10}
          onClick={() => setDraftMethods((current) => [...current, { method: "", accountNumber: "", prepared: false }])}>Add method</button>
      </div>
      {draftMethods.map((paymentMethod, index) => <div className="admin-payment-method-row" key={`payment-method-${index}`}>
        <label className="field-label">Payment method
          <input className="text-input" value={paymentMethod.method} maxLength={80} disabled={!loaded || busy}
            placeholder="For example, mobile money or bank transfer"
            onChange={(event) => setDraftMethods((current) => current.map((item, itemIndex) =>
              itemIndex === index ? { ...item, method: event.target.value, prepared: false } : item))} />
        </label>
        <label className="field-label">Account number / payment number
          <input className="text-input" value={paymentMethod.accountNumber} maxLength={200} disabled={!loaded || busy}
            onChange={(event) => setDraftMethods((current) => current.map((item, itemIndex) =>
              itemIndex === index ? { ...item, accountNumber: event.target.value, prepared: false } : item))} />
        </label>
        <div className="admin-payment-method-actions">
          <button className="button button-dark" type="button" disabled={!loaded || busy || paymentMethod.prepared}
            onClick={() => {
              const method = paymentMethod.method.trim();
              const accountNumber = paymentMethod.accountNumber.trim();
              if (!method || method.length > 80 || !accountNumber || accountNumber.length > 200) {
                onNotice("Enter a payment method (up to 80 characters) and account number (up to 200 characters).");
                return;
              }
              setDraftMethods((current) => current.map((item, itemIndex) =>
                itemIndex === index ? { ...item, method, accountNumber, prepared: true } : item));
            }}>{paymentMethod.prepared ? "Saved in draft" : "Save method"}</button>
          <button className="button button-outline" type="button" disabled={!loaded || busy}
            aria-label={`Remove payment method ${index + 1}`}
            onClick={() => setDraftMethods((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
        </div>
      </div>)}
      {!draftMethods.length && <p>No payment methods added. Buyers will not be able to submit payment proof.</p>}
      <label className="field-label" htmlFor="marketplace-payment-instructions">General instructions for buyers</label>
      <textarea id="marketplace-payment-instructions" className="admin-payment-instructions-textarea"
        value={draft} maxLength={5000} disabled={!loaded || busy}
        onChange={(event) => setDraft(event.target.value)} />
      <p>For example, explain how to include an order number or what receipt to upload. Never include a PIN, password, one-time code, or private admin instructions. General instructions are optional; at least one complete method/account pair is required to enable payment submissions.</p>
      <p><strong>{draft.length.toLocaleString()} / 5,000 characters</strong></p>
      <div className="admin-listing-fee-actions">
        <button className="button button-dark" type="button" disabled={!loaded || busy || !changed} onClick={() => void save()}>
          {busy ? "Saving…" : "Save payment instructions"}
        </button>
        <button className="button button-outline" type="button" disabled={!loaded || busy || !changed}
          onClick={() => {
            setDraftMethods(savedSettings.paymentMethods.map((method) => ({ ...method, prepared: true })));
            setDraft(savedSettings.instructions);
          }}>Cancel</button>
      </div>
    </div>
    <div className="admin-listing-fee-current" aria-live="polite">
      <div className="admin-listing-fee-current-heading">
        <div><span>CURRENT SAVED INSTRUCTIONS</span><h2>Buyer preview</h2></div>
        <span className="admin-listing-fee-status">{savedSettings.paymentMethods.length ? "Active" : "Not configured"}</span>
      </div>
      {loaded
        ? <><div className="admin-payment-instructions-preview">
          {savedSettings.paymentMethods.length
            ? <><strong>Payment methods</strong>{savedSettings.paymentMethods.map((method, index) =>
              <div className="admin-payment-method-preview" key={`saved-method-${index}`}>
                <strong>{method.method}</strong><span>Account number / payment number: {method.accountNumber}</span>
              </div>)}</>
            : <p>Buyers cannot submit payment proof until at least one payment method and account number are configured.</p>}
          {savedSettings.instructions && <><strong>General instructions</strong><p>{savedSettings.instructions}</p></>}
        </div>
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
