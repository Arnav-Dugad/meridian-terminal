import type { Metadata } from "next";

import { CompareView } from "@/components/views/CompareView";

export const metadata: Metadata = {
  title: "Compare",
  description:
    "Rebase Indian and US instruments to a common start and read return, volatility, drawdown and pairwise correlation side by side.",
};

export default function ComparePage() {
  return <CompareView />;
}
