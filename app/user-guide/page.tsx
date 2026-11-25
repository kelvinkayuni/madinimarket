import type { Metadata } from "next";

import UserGuidePage from "../user-guide-page";

export const metadata: Metadata = {
  title: "Buyer & Seller Guide | Madinimarket",
  description: "Learn how to create an account, subscribe, buy, sell, and follow orders on Madinimarket.",
};

export default function Page() {
  return <UserGuidePage />;
}
