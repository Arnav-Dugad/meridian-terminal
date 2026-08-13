import { NextResponse, type NextRequest } from "next/server";

import { getEarnings, getFundamentals, getPeers, getRecommendations } from "@/lib/twelvedata/service";
import { findBySlug } from "@/lib/market/universe";
import { fetchOwnershipAndRatings } from "@/lib/providers/yahoo-summary";

export const runtime = "nodejs";

/**
 * Everything the research panel on an instrument page needs, in one request.
 *
 * Four separate client fetches would waterfall on a cold function and each
 * miss the cache independently. Bundling them also means the panel can render
 * whatever arrived and mark the rest unavailable, rather than showing four
 * spinners that resolve at four different moments.
 *
 * Each section fails independently: no analyst coverage should never stop the
 * fundamentals from rendering.
 */
export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").slice(0, 24);
  const inst = findBySlug(symbol);
  if (!inst) return NextResponse.json({ error: "Unknown instrument" }, { status: 404 });

  const [fundamentals, recommendations, earnings, peers, extras] = await Promise.all([
    getFundamentals(inst.slug).catch(() => ({ data: null, source: "cached" as const })),
    getRecommendations(inst.slug).catch(() => ({ data: null, source: "cached" as const })),
    getEarnings(inst.slug).catch(() => ({ data: [], source: "cached" as const })),
    getPeers(inst.slug).catch(() => ({ data: [], source: "cached" as const })),
    // Ownership and rating changes ride along on the memoised summary fetch,
    // so they cost no extra request.
    fetchOwnershipAndRatings(inst).catch(() => ({ ownership: null, ratings: [] })),
  ]);

  return NextResponse.json(
    {
      data: {
        fundamentals: fundamentals.data,
        recommendations: recommendations.data,
        earnings: earnings.data,
        peers: peers.data,
        ownership: extras.ownership,
        ratings: extras.ratings,
      },
      source: fundamentals.source,
      asOf: Date.now(),
    },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
