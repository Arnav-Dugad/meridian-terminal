import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getQuotes } from "@/lib/twelvedata/service";
import type { ApiEnvelope, Quote } from "@/lib/twelvedata/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  // Cap the batch: each symbol costs a Twelve Data credit, and an unbounded
  // list is a trivial way for a client to drain the whole minute's budget.
  symbols: z
    .string()
    .min(1)
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.string().max(24)).min(1).max(60)),
});

export async function GET(req: NextRequest) {
  const parsed = Query.safeParse({
    symbols: req.nextUrl.searchParams.get("symbols") ?? "",
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide 1–60 comma-separated symbols via ?symbols=" },
      { status: 400 },
    );
  }

  try {
    const { data, source, notice, providers } = await getQuotes(parsed.data.symbols);
    const body: ApiEnvelope<Quote[]> = { data, source, asOf: Date.now(), notice, providers };

    return NextResponse.json(body, {
      headers: {
        // Short shared-cache window with SWR: many browsers on the same
        // dashboard collapse onto one origin hit without ever showing a
        // figure more than a few seconds old.
        "Cache-Control": "public, s-maxage=10, stale-while-revalidate=45",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
