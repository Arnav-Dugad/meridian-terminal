import type { Metadata } from "next";

import { NewsView } from "@/components/views/NewsView";

export const metadata: Metadata = {
  title: "Newsroom",
  description:
    "Market headlines and company news for the instruments you track, with tickers linked into the terminal.",
};

export default function NewsPage() {
  return <NewsView />;
}
