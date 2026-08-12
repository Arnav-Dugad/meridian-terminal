import { NextResponse, type NextRequest } from "next/server";

import { getProfile } from "@/lib/twelvedata/service";
import { findBySlug } from "@/lib/market/universe";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").slice(0, 24);
  const inst = findBySlug(symbol);
  if (!inst) return NextResponse.json({ error: "Unknown instrument" }, { status: 404 });

  const { data, source } = await getProfile(inst.slug);
  return NextResponse.json(
    { data, source, asOf: Date.now() },
    { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
  );
}
