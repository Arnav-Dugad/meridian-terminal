import { NextResponse, type NextRequest } from "next/server";

import { getFx } from "@/lib/twelvedata/service";

export const runtime = "nodejs";

const ALLOWED = new Set(["USD/INR", "EUR/INR", "GBP/INR", "EUR/USD"]);

/**
 * Exchange rates. The pair allow-list exists so this cannot be used as an
 * open proxy to spend the account's credits on arbitrary symbols.
 */
export async function GET(req: NextRequest) {
  const pair = (req.nextUrl.searchParams.get("pair") ?? "USD/INR").toUpperCase();
  if (!ALLOWED.has(pair)) {
    return NextResponse.json({ error: "Unsupported currency pair" }, { status: 400 });
  }

  const { data, source } = await getFx(pair);
  return NextResponse.json(
    { data, source, asOf: Date.now() },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800" } },
  );
}
