"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { parseFaqContent, type FaqGroup } from "@/lib/faq-content";

type PublicFaq = {
  englishGroups: FaqGroup[];
  swahiliGroups: FaqGroup[];
  updatedAt: string;
};

function isFaqContent(value: unknown): value is {
  englishFaqContent: string;
  swahiliFaqContent: string;
  updatedAt: string;
} {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  return typeof result.englishFaqContent === "string" &&
    typeof result.swahiliFaqContent === "string" &&
    typeof result.updatedAt === "string";
}

function FaqGroups({ groups }: { groups: FaqGroup[] }) {
  return <div className="faq-groups">
    {groups.map((group, groupIndex) => <section className="faq-group" key={`${groupIndex}-${group.title}`}>
      <h3>{group.title}</h3>
      <div className="faq-list">
        {group.items.map((item, itemIndex) => <details className="faq-item" key={`${groupIndex}-${itemIndex}`}>
          <summary>{item.question}</summary>
          <p>{item.answer}</p>
        </details>)}
      </div>
    </section>)}
  </div>;
}

export default function FaqPage() {
  const [faq, setFaq] = useState<PublicFaq | null>(null);
  const [error, setError] = useState("");

  const loadFaq = useCallback(async () => {
    try {
      const response = await fetch("/api/user-guide", { cache: "no-store" });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
          ? result.error : "Could not load the FAQ.";
        throw new Error(message);
      }
      if (!isFaqContent(result)) throw new Error("Saved FAQ content is invalid.");
      const englishGroups = parseFaqContent(result.englishFaqContent);
      const swahiliGroups = parseFaqContent(result.swahiliFaqContent);
      setFaq({ englishGroups, swahiliGroups, updatedAt: result.updatedAt });
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load the FAQ.");
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadFaq(), 0);
    const interval = window.setInterval(() => void loadFaq(), 30_000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [loadFaq]);

  return <main className="user-guide-page faq-page">
    <div className="user-guide-topbar">
      <Link href="/" className="user-guide-back">Back to marketplace</Link>
      <Link href="/user-guide" className="user-guide-back">Read the Buyer &amp; Seller Guide</Link>
    </div>
    <header className="user-guide-header">
      <p className="dialog-kicker">FREQUENTLY ASKED QUESTIONS</p>
      <h1>Quick answers for the mineral market.</h1>
      <p>Find answers about accounts, licences, subscriptions, buying, selling, orders, and payments.</p>
      <nav className="user-guide-contents" aria-label="FAQ languages">
        <a href="#english-faq">English FAQs</a>
        <a href="#swahili-faq">Maswali ya Kiswahili</a>
      </nav>
    </header>
    {faq ? <>
      <article id="english-faq" className="user-guide-language faq-language">
        <h2>English</h2>
        <FaqGroups groups={faq.englishGroups} />
        <p className="faq-guide-prompt">For step-by-step instructions, read the <Link href="/user-guide">Buyer &amp; Seller Guide</Link>.</p>
      </article>
      <article id="swahili-faq" className="user-guide-language user-guide-swahili faq-language">
        <h2>Kiswahili</h2>
        <FaqGroups groups={faq.swahiliGroups} />
        <p className="faq-guide-prompt">Kwa maelekezo ya hatua kwa hatua, soma <Link href="/user-guide">Mwongozo wa Mnunuzi na Muuzaji</Link>.</p>
      </article>
      <p className="user-guide-updated">Last updated {new Date(faq.updatedAt).toLocaleString()}</p>
      {error && <p className="user-guide-refresh-note" role="status">{error} Showing the last loaded version.</p>}
    </> : error
      ? <div className="user-guide-load-error" role="alert"><p>{error}</p><button className="button button-dark" type="button" onClick={() => void loadFaq()}>Try again</button></div>
      : <p className="user-guide-loading" role="status">Loading the latest FAQ…</p>}
  </main>;
}
