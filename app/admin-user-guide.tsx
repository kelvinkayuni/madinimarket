"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

const MAX_GUIDE_LENGTH = 30000;

type UserGuide = {
  englishContent: string;
  swahiliContent: string;
  updatedAt: string;
};

function isUserGuide(value: unknown): value is UserGuide {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  return typeof result.englishContent === "string" &&
    typeof result.swahiliContent === "string" &&
    typeof result.updatedAt === "string";
}

export default function AdminUserGuide({ onNotice }: { onNotice: (message: string) => void }) {
  const [saved, setSaved] = useState<UserGuide | null>(null);
  const [englishDraft, setEnglishDraft] = useState("");
  const [swahiliDraft, setSwahiliDraft] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError("");
    if (!isSupabaseConfigured) throw new Error("The admin service is not connected.");
    const { data: { session }, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
    if (sessionError) throw sessionError;
    if (!session) throw new Error("Admin session expired.");

    const response = await fetch("/api/admin/user-guide", {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      const message = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
        ? result.error : "Could not load the user guide.";
      throw new Error(message);
    }
    if (!isUserGuide(result)) throw new Error("Saved user guide content is invalid.");
    setSaved(result);
    setEnglishDraft(result.englishContent);
    setSwahiliDraft(result.swahiliContent);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void load().catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "Could not load the user guide.";
        setLoadError(message);
        onNotice(message);
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [load, onNotice]);

  const save = async () => {
    if (!englishDraft.trim() || !swahiliDraft.trim()) {
      onNotice("Enter both the English and Kiswahili guide before saving.");
      return;
    }
    if (englishDraft.length > MAX_GUIDE_LENGTH || swahiliDraft.length > MAX_GUIDE_LENGTH) {
      onNotice(`Each guide must be ${MAX_GUIDE_LENGTH.toLocaleString()} characters or fewer.`);
      return;
    }

    setBusy(true);
    try {
      const { data: { session }, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error("Admin session expired.");

      const response = await fetch("/api/admin/user-guide", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ englishContent: englishDraft, swahiliContent: swahiliDraft }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
          ? result.error : "Could not save the user guide.";
        throw new Error(message);
      }
      if (!isUserGuide(result)) throw new Error("The saved user guide content is invalid.");
      setSaved(result);
      setEnglishDraft(result.englishContent);
      setSwahiliDraft(result.swahiliContent);
      onNotice("User guide saved. Readers will see the updated version automatically.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not save the user guide.");
    } finally {
      setBusy(false);
    }
  };

  const changed = Boolean(saved) &&
    (englishDraft !== saved?.englishContent || swahiliDraft !== saved?.swahiliContent);

  return <section className="admin-listing-fee-panel admin-user-guide-panel" aria-labelledby="admin-user-guide-heading">
    <div className="admin-page-heading">
      <div>
        <div className="dialog-kicker">PUBLIC WEBSITE CONTENT</div>
        <h1 id="admin-user-guide-heading">Buyer &amp; Seller Guide</h1>
        <p>Edit both language versions here. Saving updates the public guide without a redeploy.</p>
      </div>
      <Link className="button button-outline" href="/user-guide" target="_blank" rel="noreferrer">Preview public guide</Link>
    </div>
    <div className="admin-listing-fee-editor admin-user-guide-editor">
      <p>Use Markdown headings with #, ##, or ###, paragraphs, and - bullets. Use **text** for bold. English appears first and Kiswahili follows it.</p>
      <label className="field-label" htmlFor="admin-guide-english">English version</label>
      <textarea id="admin-guide-english" className="admin-payment-instructions-textarea admin-user-guide-textarea"
        value={englishDraft} maxLength={MAX_GUIDE_LENGTH} disabled={!loaded || busy}
        onChange={(event) => setEnglishDraft(event.target.value)} />
      <p>{englishDraft.length.toLocaleString()} / {MAX_GUIDE_LENGTH.toLocaleString()} characters</p>
      <label className="field-label" htmlFor="admin-guide-swahili">Kiswahili version</label>
      <textarea id="admin-guide-swahili" className="admin-payment-instructions-textarea admin-user-guide-textarea"
        value={swahiliDraft} maxLength={MAX_GUIDE_LENGTH} disabled={!loaded || busy}
        onChange={(event) => setSwahiliDraft(event.target.value)} />
      <p>{swahiliDraft.length.toLocaleString()} / {MAX_GUIDE_LENGTH.toLocaleString()} characters</p>
      <div className="admin-listing-fee-actions">
        <button className="button button-dark" type="button" disabled={!loaded || busy || !changed} onClick={() => void save()}>
          {busy ? "Saving…" : "Save user guide"}
        </button>
        <button className="button button-outline" type="button" disabled={!loaded || busy || !changed}
          onClick={() => {
            setEnglishDraft(saved?.englishContent ?? "");
            setSwahiliDraft(saved?.swahiliContent ?? "");
          }}>Discard changes</button>
      </div>
      {saved && <small>Last saved {new Date(saved.updatedAt).toLocaleString()}. Open guide pages refresh automatically within 30 seconds.</small>}
      {!loaded && <div className="admin-user-guide-load-state" role={loadError ? "alert" : "status"}>
        <span>{loadError || "Loading saved guide…"}</span>
        {loadError && <button className="button button-outline" type="button" onClick={() => void load().catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Could not load the user guide.";
          setLoadError(message);
          onNotice(message);
        })}>Retry</button>}
      </div>}
    </div>
  </section>;
}
