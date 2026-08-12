import type { Metadata } from "next";

import { getOverview } from "@/lib/twelvedata/overview";
import { getSeries } from "@/lib/twelvedata/service";
import { INDICES } from "@/lib/market/universe";
import { DashboardView } from "@/components/views/DashboardView";
import type { IndexSeed } from "@/components/market/IndexStrip";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Cross-market overview of the Indian and United States equity markets.",
};

/**
 * Rendered on the server every fifteen seconds. The first paint therefore
 * carries real prices, breadth and sector rotation; the client store then
 * takes over and keeps them moving without another full render.
 */
export const revalidate = 15;

export default async function DashboardPage() {
  const overview = await getOverview();

  // Sparklines for the index rail. Daily bars cache for fifteen minutes, so
  // these are nearly always free.
  const sparkSeries = await Promise.all(
    INDICES.map((i) => getSeries(i.slug, "1M").catch(() => null)),
  );

  const seeds: IndexSeed[] = INDICES.flatMap((inst, i) => {
    const quote = overview.indices.find((q) => q.slug === inst.slug);
    if (!quote) return [];
    return [{ slug: inst.slug, quote, spark: sparkSeries[i]?.data.candles.map((c) => c.c) ?? [] }];
  });

  return <DashboardView overview={overview} seeds={seeds} />;
}
