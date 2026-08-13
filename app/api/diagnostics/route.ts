import { NextResponse, type NextRequest } from "next/server";

import { runProviderProbes } from "@/lib/providers/probe";
import { resetBreaker } from "@/lib/providers/breaker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Live provider probe.
 *
 * Actually calls each configured upstream with a known-good symbol and reports
 * what came back. This exists because "is my key working?" is otherwise
 * unanswerable from the outside: a missing key, an out-of-plan symbol, a
 * decommissioned endpoint version and a rate limit all present identically as
 * a figure quietly labelled "Simulated".
 *
 * Deliberately not cached, and deliberately real: a probe that reads a config
 * flag rather than making a request would have reported FMP as healthy for the
 * entire period its v3 endpoints were returning "Legacy Endpoint" errors.
 */
export async function GET(req: NextRequest) {
  // A manual run should test the provider, not the memory of its last failure,
  // so probing clears the breakers first.
  if (req.nextUrl.searchParams.get("reset") !== "0") resetBreaker();

  const results = await runProviderProbes();

  const healthy = results.filter((r) => r.status === "ok").length;
  const configured = results.filter((r) => r.status !== "not-configured").length;

  return NextResponse.json(
    {
      summary: {
        healthy,
        configured,
        total: results.length,
        verdict:
          healthy === 0
            ? "No data source is answering. Prices cannot be shown until one recovers."
            : healthy < configured
              ? "Some sources are failing. Anything they alone covered will show as unavailable rather than estimated."
              : "All configured sources are answering.",
      },
      results,
      asOf: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
