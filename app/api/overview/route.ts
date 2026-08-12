import { NextResponse } from "next/server";

import { getOverview } from "@/lib/twelvedata/overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One request that fills the entire dashboard.
 *
 * The alternative — the client firing eight parallel calls on mount — is both
 * slower on a cold function and far more expensive against the credit budget,
 * because each call would independently miss the cache.
 */
export async function GET() {
  const payload = await getOverview();

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" },
  });
}
