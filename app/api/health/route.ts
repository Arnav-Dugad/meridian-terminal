import { NextResponse } from "next/server";

import { cacheStats } from "@/lib/twelvedata/cache";
import { limiterStats } from "@/lib/twelvedata/limiter";
import { hasApiKey } from "@/lib/twelvedata/client";
import { isAdminConfigured } from "@/lib/firebase/admin";
import { marketStatusSnapshot } from "@/lib/twelvedata/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operational snapshot. Deliberately reports only configuration *presence* —
 * never a key, an email, or a project id — so it is safe to leave public and
 * point an uptime monitor at.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      providers: {
        twelveData: hasApiKey() ? "configured" : "missing — running simulated",
        firebaseAdmin: isAdminConfigured() ? "configured" : "missing — sessions disabled",
      },
      credits: limiterStats(),
      cache: cacheStats(),
      sessions: marketStatusSnapshot().map((s) => ({
        exchange: s.code,
        phase: s.phase,
        localTime: s.localTime,
      })),
      asOf: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
