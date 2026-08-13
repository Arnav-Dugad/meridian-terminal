import { NextResponse } from "next/server";

import { cacheStats } from "@/lib/twelvedata/cache";
import { adminStatus } from "@/lib/firebase/admin";
import { marketStatusSnapshot } from "@/lib/twelvedata/service";
import { providerStatus } from "@/lib/providers/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operational snapshot.
 *
 * Reports configuration *presence* only — never a key, an email or a project
 * id — so it is safe to leave public and point an uptime monitor at.
 *
 * Every section is computed inside its own try/catch. A health endpoint that
 * can itself 500 is worse than useless: it was the thing that hid a
 * firebase-admin bundling failure in production behind an empty response body.
 * If a subsystem is broken, this says which one.
 */
export async function GET() {
  const report: Record<string, unknown> = {
    status: "ok",
    asOf: new Date().toISOString(),
  };
  const failures: string[] = [];

  try {
    report["uptimeSeconds"] = Math.round(process.uptime());
    report["region"] = process.env.VERCEL_REGION ?? "local";
    report["commit"] = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
  } catch (err) {
    failures.push(`runtime: ${message(err)}`);
  }

  try {
    report["providers"] = providerStatus();
  } catch (err) {
    failures.push(`providers: ${message(err)}`);
  }

  try {
    const admin = await adminStatus();
    report["firebaseAdmin"] = admin.configured
      ? { status: "configured" }
      : { status: "unavailable", reason: admin.reason };
  } catch (err) {
    failures.push(`firebaseAdmin: ${message(err)}`);
    report["firebaseAdmin"] = { status: "error", reason: message(err) };
  }

  try {
    report["cache"] = cacheStats();
  } catch (err) {
    failures.push(`cache: ${message(err)}`);
  }

  try {
    report["sessions"] = marketStatusSnapshot().map((s) => ({
      exchange: s.code,
      phase: s.phase,
      localTime: s.localTime,
    }));
  } catch (err) {
    failures.push(`sessions: ${message(err)}`);
  }

  if (failures.length > 0) {
    report["status"] = "degraded";
    report["failures"] = failures;
  }

  return NextResponse.json(report, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
