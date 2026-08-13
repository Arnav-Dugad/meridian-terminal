import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getProfile, getQuotes, getSeries } from "@/lib/twelvedata/service";
import { FEATURED_SLUGS, findBySlug } from "@/lib/market/universe";
import { StockView } from "@/components/views/StockView";

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** Pre-render the names most sessions start on; the rest render on demand. */
export function generateStaticParams() {
  return FEATURED_SLUGS.map((slug) => ({ slug }));
}

export const revalidate = 30;
export const dynamicParams = true;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const instrument = findBySlug(slug);
  if (!instrument) return { title: "Instrument not found" };

  const market = instrument.region === "IN" ? "NSE / India" : "United States";
  return {
    title: `${instrument.symbol} — ${instrument.name}`,
    description: `Live price, chart, technical read and cross-market correlation for ${instrument.name} (${instrument.symbol}) on ${instrument.exchange}, ${market}.`,
    openGraph: {
      title: `${instrument.symbol} · ${instrument.name}`,
      description: `Live ${instrument.exchange} quote, chart and analytics on Meridian.`,
    },
  };
}

export default async function StockPage({ params }: PageProps) {
  const { slug } = await params;
  const instrument = findBySlug(slug);
  if (!instrument) notFound();

  const benchmarkSlug = instrument.region === "IN" ? "NIFTY50" : "SPX";
  const crossSlug = instrument.region === "IN" ? "SPX" : "NIFTY50";

  const [quoteRes, seriesRes, profileRes, benchmarkRes, crossRes] = await Promise.all([
    getQuotes([instrument.slug]),
    getSeries(instrument.slug, "6M"),
    getProfile(instrument.slug),
    getSeries(benchmarkSlug, "6M").catch(() => null),
    getSeries(crossSlug, "6M").catch(() => null),
  ]);

  const quote = quoteRes.data[0];
  if (!quote) notFound();

  return (
    <StockView
      slug={instrument.slug}
      initialQuote={quote}
      initialSeries={seriesRes.data}
      profile={profileRes.data}
      benchmark={
        benchmarkRes ? { slug: benchmarkSlug, candles: benchmarkRes.data.candles } : null
      }
      crossMarket={crossRes ? { slug: crossSlug, candles: crossRes.data.candles } : null}
      source={quoteRes.source}
      notice={quoteRes.notice}
      initialNotice={seriesRes.notice}
    />
  );
}
