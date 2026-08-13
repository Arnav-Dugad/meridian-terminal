import { NextResponse, type NextRequest } from "next/server";

import { fetchOptionChain } from "@/lib/providers/yahoo-options";
import { computeMaxPain, openInterestProfile, summariseOptions } from "@/lib/analytics/options";
import { cached } from "@/lib/twelvedata/cache";
import { findBySlug } from "@/lib/market/universe";
import { ProviderError } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Option chain plus the analytics computed from it.
 *
 * Max pain, the open-interest profile and the positioning summary are derived
 * server-side and returned alongside the raw chain, so the client renders a
 * finished view instead of recomputing a few hundred strikes on every paint.
 */
export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").slice(0, 24);
  const expiryParam = Number(req.nextUrl.searchParams.get("expiry"));
  const expiry = Number.isFinite(expiryParam) && expiryParam > 0 ? expiryParam : undefined;

  const inst = findBySlug(symbol);
  if (!inst) return NextResponse.json({ error: "Unknown instrument" }, { status: 404 });

  try {
    const { value: chain } = await cached(
      `options:${inst.slug}:${expiry ?? "front"}`,
      // Chains move through the session but not tick by tick; five minutes is
      // fresh enough and keeps the crumb handshake off the hot path.
      { ttl: 300_000, maxAge: 1_800_000 },
      async () => {
        const result = await fetchOptionChain(inst, expiry);
        if (!result) throw new Error("no chain available");
        return result;
      },
    );

    return NextResponse.json(
      {
        data: {
          chain,
          maxPain: computeMaxPain(chain),
          profile: openInterestProfile(chain, 18),
          summary: summariseOptions(chain),
        },
        asOf: Date.now(),
      },
      { headers: { "Cache-Control": "public, s-maxage=180, stale-while-revalidate=900" } },
    );
  } catch (err) {
    // 501 is the deliberate "this market is not reachable" case, and deserves
    // its own message rather than being lumped in with an outage.
    if (err instanceof ProviderError && err.status === 501) {
      return NextResponse.json({ error: err.message, unsupported: true }, { status: 200 });
    }
    return NextResponse.json(
      {
        error:
          err instanceof Error && err.message.includes("crumb")
            ? "The options source is refusing automated requests right now. Try again shortly."
            : "No option chain is published for this instrument.",
      },
      { status: 200 },
    );
  }
}
