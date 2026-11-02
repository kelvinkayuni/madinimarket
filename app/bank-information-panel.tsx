"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { fetchWithWebsiteSession } from "@/lib/client-website-session";

type BankInformation = {
  bankName: string;
  accountNumber: string;
  accountHolderName: string;
  addedAt: string | null;
  updatedAt: string | null;
};

type BankInformationResponse = {
  bankInformation: BankInformation;
  canEdit: boolean;
  editUnlocked: boolean;
  editableAt: string | null;
};

function formatBankDate(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Dar_es_Salaam",
  }) + " Tanzania time";
}

export default function BankInformationPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const [bankInformation, setBankInformation] = useState<BankInformation>({
    bankName: "",
    accountNumber: "",
    accountHolderName: "",
    addedAt: null,
    updatedAt: null,
  });
  const [canEdit, setCanEdit] = useState(false);
  const [editUnlocked, setEditUnlocked] = useState(false);
  const [editableAt, setEditableAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    const response = await fetchWithWebsiteSession("/api/website-bank-information", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not load your bank information.");
    const information = result as BankInformationResponse;
    setBankInformation(information.bankInformation);
    setCanEdit(information.canEdit);
    setEditUnlocked(information.editUnlocked);
    setEditableAt(information.editableAt);
    setLoadError("");
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void load().catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "Could not load your bank information.";
        setLoadError(message);
        onNotice(message);
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [load, onNotice]);

  const updateField = (field: keyof Pick<BankInformation, "bankName" | "accountNumber" | "accountHolderName">, value: string) => {
    setBankInformation((current) => ({ ...current, [field]: value }));
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    try {
      const response = await fetchWithWebsiteSession("/api/website-bank-information", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankName: bankInformation.bankName,
          accountNumber: bankInformation.accountNumber,
          accountHolderName: bankInformation.accountHolderName,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save your bank information.");
      const information = result as BankInformationResponse;
      setBankInformation(information.bankInformation);
      setCanEdit(information.canEdit);
      setEditUnlocked(information.editUnlocked);
      setEditableAt(information.editableAt);
      onNotice("Bank information saved. Keep the details accurate so payouts can be processed correctly.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not save your bank information.");
    } finally {
      setSaving(false);
    }
  };

  const hasBankInformation = Boolean(bankInformation.addedAt);

  return <section className="bank-information-panel">
    <div className="dialog-kicker">SELLER PAYOUT DETAILS</div>
    <h2 id="dialog-title">Bank Information</h2>
    <p className="dialog-copy">This bank account will be used to receive payments from your sales on Madini Market. Please ensure all details are accurate and belong to you.</p>
    {loading ? <p className="admin-empty">Loading your bank information…</p> : loadError ? <div className="user-bank-information-error"><p>{loadError}</p><button className="button button-outline" type="button" onClick={() => {
      setLoading(true);
      void load().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Could not load your bank information.";
        setLoadError(message);
        onNotice(message);
      }).finally(() => setLoading(false));
    }}>Try again</button></div> : <>
      {canEdit && <p className="bank-information-lock-warning"><strong>Important:</strong> Once saved, your bank account details cannot be edited or deleted for a period of six (6) months. Please verify all information carefully before submitting.</p>}
      {editUnlocked && <p className="bank-information-unlocked">An administrator has allowed one update. Your account will be locked again after you save.</p>}
      {!canEdit && editableAt && <p className="bank-information-lock-status">You can edit these details after {formatBankDate(editableAt)} unless an administrator grants a one-time edit.</p>}
      <form className="form-stack bank-information-form" onSubmit={save}>
        <label className="field-label">Bank Name<input className="text-input" required maxLength={120} value={bankInformation.bankName} disabled={!canEdit || saving} onChange={(event) => updateField("bankName", event.target.value)} autoComplete="organization" /></label>
        <label className="field-label">Bank Account Number<input className="text-input" required minLength={4} maxLength={64} value={bankInformation.accountNumber} disabled={!canEdit || saving} onChange={(event) => updateField("accountNumber", event.target.value)} autoComplete="off" /></label>
        <label className="field-label">Account Holder Name<input className="text-input" required maxLength={120} value={bankInformation.accountHolderName} disabled={!canEdit || saving} onChange={(event) => updateField("accountHolderName", event.target.value)} autoComplete="name" /></label>
        {bankInformation.addedAt && <p className="bank-information-added-date">Date added: {formatBankDate(bankInformation.addedAt)}</p>}
        {canEdit && <button className="button button-dark form-submit" type="submit" disabled={saving}>{saving ? "Saving…" : hasBankInformation ? "Save bank information" : "Add bank information"}</button>}
      </form>
    </>}
  </section>;
}
