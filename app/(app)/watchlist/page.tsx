import type { Metadata } from "next";

import { WatchlistView } from "@/components/views/WatchlistView";

export const metadata: Metadata = {
  title: "Watchlist",
  description: "Live prices for the instruments you track across NSE and the US markets.",
};

export default function WatchlistPage() {
  return <WatchlistView />;
}
