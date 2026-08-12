import type { Metadata } from "next";

import { getOverview } from "@/lib/twelvedata/overview";
import { getSeries } from "@/lib/twelvedata/service";
import { INDICES } from "@/lib/market/universe";
import { MarketsView } from "@/components/views/MarketsView";
import type { IndexSeed } from "@/components/market/IndexStrip";

export const metadata: Metadata = {
  title: "Markets",
  description:
    "Indices, breadth and sector rotation across NSE, BSE, Nasdaq and NYSE, with both markets on one scale.",
};

export const revalidate = 20;

export default async function MarketsPage() {
  const overview = await getOverview();

  const sparkSeries = await Promise.all(
    INDICES.map((i) => getSeries(i.slug, "6M").catch(() => null)),
  );

  const seeds: IndexSeed[] = INDICES.flatMap((inst, i) => {
    const quote = overview.indices.find((q) => q.slug === inst.slug);
    if (!quote) return [];
    return [{ slug: inst.slug, quote, spark: sparkSeries[i]?.data.candles.map((c) => c.c) ?? [] }];
  });

  return <MarketsView overview={overview} seeds={seeds} />;
}
