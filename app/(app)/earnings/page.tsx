import type { Metadata } from "next";

import { EarningsView } from "@/components/views/EarningsView";

export const metadata: Metadata = {
  title: "Earnings calendar",
  description: "Upcoming results across the Indian and United States markets.",
};

export default function EarningsPage() {
  return <EarningsView />;
}
