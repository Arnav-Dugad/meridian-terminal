import { NextResponse } from "next/server";

import { fetchInstitutionalFlows } from "@/lib/providers/nse";
import { readFlowHistory, saveFlowDay } from "@/lib/firebase/flow-store";
import { cached } from "@/lib/twelvedata/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Foreign and domestic institutional flows on the Indian market.
 *
 * The figure updates once per session, so it is cached for twenty minutes.
 * Every successful fetch is also written to the history store, which is how
 * the back series accumulates — NSE publishes only the latest day.
 */
export async function GET() {
  let latest = null;
  let notice: string | undefined;

  try {
    const result = await cached("flows:latest", { ttl: 1_200_000, maxAge: 7_200_000 }, async () => {
      const day = await fetchInstitutionalFlows();
      if (!day) throw new Error("no flow data");
      return day;
    });
    latest = result.value;
    void saveFlowDay(latest);
  } catch (err) {
    notice =
      err instanceof Error && err.message.includes("bot protection")
        ? "The exchange is rate-limiting automated requests right now. Showing stored history."
        : "Latest session figures are temporarily unavailable. Showing stored history.";
  }

  const history = await readFlowHistory(120);

  // The live figure may be newer than anything stored yet.
  const merged = latest && !history.some((d) => d.date === latest!.date)
    ? [...history, latest]
    : history;

  return NextResponse.json(
    {
      latest: latest ?? merged[merged.length - 1] ?? null,
      history: merged,
      notice,
      asOf: Date.now(),
    },
    { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } },
  );
}
