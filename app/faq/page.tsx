import type { Metadata } from "next";

import FaqPage from "../faq-page";

export const metadata: Metadata = {
  title: "Frequently Asked Questions | Madinimarket",
  description: "Quick answers about Madinimarket accounts, subscriptions, buying, selling, orders, and payments.",
};

export default function Page() {
  return <FaqPage />;
}
