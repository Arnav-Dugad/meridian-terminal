import type { Metadata } from "next";

import { ScreenerView } from "@/components/views/ScreenerView";

export const metadata: Metadata = {
  title: "Screener",
  description:
    "Filter NSE and US listings together on change, day-range position, volume, sector and market cap.",
};

export default function ScreenerPage() {
  return <ScreenerView />;
}
