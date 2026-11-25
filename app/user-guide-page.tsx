"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import UserGuideContent from "./user-guide-content";

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

export default function UserGuidePage() {
  const [guide, setGuide] = useState<UserGuide | null>(null);
  const [error, setError] = useState("");

  const loadGuide = useCallback(async () => {
    try {
      const response = await fetch("/api/user-guide", { cache: "no-store" });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
          ? result.error : "Could not load the user guide.";
        throw new Error(message);
      }
      if (!isUserGuide(result)) throw new Error("Saved user guide content is invalid.");
      setGuide(result);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load the user guide.");
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadGuide(), 0);
    const interval = window.setInterval(() => void loadGuide(), 30_000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [loadGuide]);

  return <main className="user-guide-page">
    <div className="user-guide-topbar">
      <Link href="/" className="user-guide-back">Back to marketplace</Link>
      <span>MADINIMARKET · HELP &amp; GUIDANCE</span>
    </div>
    <header className="user-guide-header">
      <p className="dialog-kicker">BUYER &amp; SELLER GUIDE</p>
      <h1>Madinimarket User Guide</h1>
      <p>Instructions for accounts, subscriptions, buying, selling, payments, and order delivery.</p>
      <nav className="user-guide-contents" aria-label="Guide languages">
        <a href="#english-guide">English guide</a>
        <a href="#swahili-guide">Mwongozo wa Kiswahili</a>
      </nav>
    </header>

    {guide ? <>
      <article id="english-guide" className="user-guide-language">
        <UserGuideContent content={guide.englishContent} />
      </article>
      <article id="swahili-guide" className="user-guide-language user-guide-swahili">
        <UserGuideContent content={guide.swahiliContent} />
      </article>
      <p className="user-guide-updated">Last updated {new Date(guide.updatedAt).toLocaleString()}</p>
      {error && <p className="user-guide-refresh-note" role="status">{error} Showing the last loaded version.</p>}
    </> : error
      ? <div className="user-guide-load-error" role="alert"><p>{error}</p><button className="button button-dark" type="button" onClick={() => void loadGuide()}>Try again</button></div>
      : <p className="user-guide-loading" role="status">Loading the latest guide…</p>}
  </main>;
}
