import type { Metadata } from "next";

import { PortfolioView } from "@/components/views/PortfolioView";

export const metadata: Metadata = {
  title: "Portfolio",
  description:
    "Hold rupee and dollar positions in one book. Live P&L, allocation by market and sector, and currency exposure.",
};

export default function PortfolioPage() {
  return <PortfolioView />;
}
