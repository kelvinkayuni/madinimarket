"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { parseFaqContent } from "@/lib/faq-content";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

const MAX_CONTENT_LENGTH = 30000;
type ContentSection = "guide" | "faq";

type UserGuide = {
  englishContent: string;
  swahiliContent: string;
  englishFaqContent: string;
  swahiliFaqContent: string;
  updatedAt: string;
};

function isUserGuide(value: unknown): value is UserGuide {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  return typeof result.englishContent === "string" &&
    typeof result.swahiliContent === "string" &&
    typeof result.englishFaqContent === "string" &&
    typeof result.swahiliFaqContent === "string" &&
    typeof result.updatedAt === "string";
}

export default function AdminUserGuide({ onNotice, section }: { onNotice: (message: string) => void; section: ContentSection }) {
  const [saved, setSaved] = useState<UserGuide | null>(null);
  const [englishDraft, setEnglishDraft] = useState("");
  const [swahiliDraft, setSwahiliDraft] = useState("");
  const [englishFaqDraft, setEnglishFaqDraft] = useState("");
  const [swahiliFaqDraft, setSwahiliFaqDraft] = useState("");
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
        ? result.error : "Could not load the guide and FAQ.";
      throw new Error(message);
    }
    if (!isUserGuide(result)) throw new Error("Saved guide and FAQ content is invalid.");
    setSaved(result);
    setEnglishDraft(result.englishContent);
    setSwahiliDraft(result.swahiliContent);
    setEnglishFaqDraft(result.englishFaqContent);
    setSwahiliFaqDraft(result.swahiliFaqContent);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void load().catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "Could not load the guide and FAQ.";
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
    if (section === "guide") {
      if (!englishDraft.trim() || !swahiliDraft.trim()) {
        onNotice("Enter both the English and Kiswahili guide before saving.");
        return;
      }
      if (englishDraft.length > MAX_CONTENT_LENGTH || swahiliDraft.length > MAX_CONTENT_LENGTH) {
        onNotice(`Each guide version must be ${MAX_CONTENT_LENGTH.toLocaleString()} characters or fewer.`);
        return;
      }
    } else {
      if (!englishFaqDraft.trim() || !swahiliFaqDraft.trim()) {
        onNotice("Enter both the English and Kiswahili FAQ before saving.");
        return;
      }
      if (englishFaqDraft.length > MAX_CONTENT_LENGTH || swahiliFaqDraft.length > MAX_CONTENT_LENGTH) {
        onNotice(`Each FAQ version must be ${MAX_CONTENT_LENGTH.toLocaleString()} characters or fewer.`);
        return;
      }
      try {
        parseFaqContent(englishFaqDraft);
      } catch (error) {
        onNotice(`English FAQ: ${error instanceof Error ? error.message : "Check the FAQ format."}`);
        return;
      }
      try {
        parseFaqContent(swahiliFaqDraft);
      } catch (error) {
        onNotice(`Kiswahili FAQ: ${error instanceof Error ? error.message : "Check the FAQ format."}`);
        return;
      }
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
        body: JSON.stringify(section === "guide"
          ? { englishContent: englishDraft, swahiliContent: swahiliDraft }
          : { englishFaqContent: englishFaqDraft, swahiliFaqContent: swahiliFaqDraft }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
          ? result.error : "Could not save the guide and FAQ.";
        throw new Error(message);
      }
      if (!isUserGuide(result)) throw new Error("The saved guide and FAQ content is invalid.");
      setSaved(result);
      if (section === "guide") {
        setEnglishDraft(result.englishContent);
        setSwahiliDraft(result.swahiliContent);
        onNotice("User guide saved. Readers will see the update automatically.");
      } else {
        setEnglishFaqDraft(result.englishFaqContent);
        setSwahiliFaqDraft(result.swahiliFaqContent);
        onNotice("FAQ saved. Readers will see the updates automatically.");
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not save the guide and FAQ.");
    } finally {
      setBusy(false);
    }
  };

  const changed = Boolean(saved) && (section === "guide"
    ? englishDraft !== saved?.englishContent || swahiliDraft !== saved?.swahiliContent
    : englishFaqDraft !== saved?.englishFaqContent || swahiliFaqDraft !== saved?.swahiliFaqContent);

  return <section className="admin-listing-fee-panel admin-user-guide-panel" aria-labelledby="admin-user-guide-heading">
    <div className="admin-page-heading">
      <div>
        <div className="dialog-kicker">PUBLIC WEBSITE CONTENT</div>
        <h1 id="admin-user-guide-heading">{section === "guide" ? "User Guide" : "Frequently Asked Questions"}</h1>
        <p>Edit the English and Kiswahili versions here. Saving updates the public {section === "guide" ? "guide" : "FAQ"} without a redeploy.</p>
      </div>
      <div className="admin-user-guide-previews">
        <Link className="button button-outline" href={section === "guide" ? "/user-guide" : "/faq"} target="_blank" rel="noreferrer">
          Preview {section === "guide" ? "guide" : "FAQ"}
        </Link>
      </div>
    </div>
    <div className="admin-listing-fee-editor admin-user-guide-editor">
      {section === "guide" ? <>
        <p>Use Markdown headings with #, ##, or ###, paragraphs, and - bullets. Use **text** for bold. English appears first and Kiswahili follows it.</p>
        <label className="field-label" htmlFor="admin-guide-english">English version</label>
        <textarea id="admin-guide-english" className="admin-payment-instructions-textarea admin-user-guide-textarea"
          value={englishDraft} maxLength={MAX_CONTENT_LENGTH} disabled={!loaded || busy}
          onChange={(event) => setEnglishDraft(event.target.value)} />
        <p>{englishDraft.length.toLocaleString()} / {MAX_CONTENT_LENGTH.toLocaleString()} characters</p>
        <label className="field-label" htmlFor="admin-guide-swahili">Kiswahili version</label>
        <textarea id="admin-guide-swahili" className="admin-payment-instructions-textarea admin-user-guide-textarea"
          value={swahiliDraft} maxLength={MAX_CONTENT_LENGTH} disabled={!loaded || busy}
          onChange={(event) => setSwahiliDraft(event.target.value)} />
        <p>{swahiliDraft.length.toLocaleString()} / {MAX_CONTENT_LENGTH.toLocaleString()} characters</p>
      </> : <>
        <p>Use <code>##</code> for a section, <code>###</code> for each question, then put its plain-text answer below. Keep each question under a section and include an answer.</p>
        <label className="field-label" htmlFor="admin-guide-faq-english">English FAQ</label>
        <textarea id="admin-guide-faq-english" className="admin-payment-instructions-textarea admin-user-guide-textarea admin-user-guide-faq-textarea"
          value={englishFaqDraft} maxLength={MAX_CONTENT_LENGTH} disabled={!loaded || busy}
          onChange={(event) => setEnglishFaqDraft(event.target.value)} />
        <p>{englishFaqDraft.length.toLocaleString()} / {MAX_CONTENT_LENGTH.toLocaleString()} characters</p>
        <label className="field-label" htmlFor="admin-guide-faq-swahili">Kiswahili FAQ</label>
        <textarea id="admin-guide-faq-swahili" className="admin-payment-instructions-textarea admin-user-guide-textarea admin-user-guide-faq-textarea"
          value={swahiliFaqDraft} maxLength={MAX_CONTENT_LENGTH} disabled={!loaded || busy}
          onChange={(event) => setSwahiliFaqDraft(event.target.value)} />
        <p>{swahiliFaqDraft.length.toLocaleString()} / {MAX_CONTENT_LENGTH.toLocaleString()} characters</p>
      </>}
      <div className="admin-listing-fee-actions">
        <button className="button button-dark" type="button" disabled={!loaded || busy || !changed} onClick={() => void save()}>
          {busy ? "Saving…" : section === "guide" ? "Save user guide" : "Save FAQs"}
        </button>
        <button className="button button-outline" type="button" disabled={!loaded || busy || !changed}
          onClick={() => {
            if (section === "guide") {
              setEnglishDraft(saved?.englishContent ?? "");
              setSwahiliDraft(saved?.swahiliContent ?? "");
            } else {
              setEnglishFaqDraft(saved?.englishFaqContent ?? "");
              setSwahiliFaqDraft(saved?.swahiliFaqContent ?? "");
            }
          }}>Discard changes</button>
      </div>
      {saved && <small>Last saved {new Date(saved.updatedAt).toLocaleString()}. The public page refreshes automatically within 30 seconds.</small>}
      {!loaded && <div className="admin-user-guide-load-state" role={loadError ? "alert" : "status"}>
        <span>{loadError || "Loading saved guide and FAQ…"}</span>
        {loadError && <button className="button button-outline" type="button" onClick={() => void load().catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Could not load the guide and FAQ.";
          setLoadError(message);
          onNotice(message);
        })}>Retry</button>}
      </div>}
    </div>
  </section>;
}
