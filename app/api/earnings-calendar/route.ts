import { NextResponse, type NextRequest } from "next/server";

import { providerFetch, num, str } from "@/lib/providers/http";
import { cached } from "@/lib/twelvedata/cache";
import { findBySymbol, UNIVERSE } from "@/lib/market/universe";
import { fetchNextEarningsDate } from "@/lib/providers/yahoo-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Upcoming earnings.
 *
 * Two sources, because neither covers both markets. Finnhub publishes a US
 * calendar with estimates; Indian dates come from Yahoo's per-symbol summary,
 * which means one call per Indian name and so a bounded sample of the largest
 * ones rather than the whole exchange.
 *
 * Results are annotated with whether the symbol is in the local universe, so
 * the UI can link the ones it can open and still show the ones it cannot.
 */

interface CalendarEntry {
  symbol: string;
  slug: string | null;
  name: string | null;
  date: string;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  quarter: number | null;
  year: number | null;
  region: "IN" | "US";
  /** Reported before the open, after the close, or unspecified. */
  hour: string | null;
}

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function usCalendar(from: string, to: string): Promise<CalendarEntry[]> {
  const key = process.env.FINNHUB_API_KEY?.trim();
  if (!key) return [];

  const url = new URL("https://finnhub.io/api/v1/calendar/earnings");
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("token", key);

  const payload = await providerFetch<{ earningsCalendar?: unknown[] }>(url.toString(), {
    provider: "finnhub",
    maxWaitMs: 1500,
  });

  const rows = payload.earningsCalendar ?? [];
  const out: CalendarEntry[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const symbol = str(r["symbol"]);
    const date = str(r["date"]);
    if (!symbol || !date) continue;

    const inst = findBySymbol(symbol);
    out.push({
      symbol,
      slug: inst?.slug ?? null,
      name: inst?.name ?? null,
      date,
      epsEstimate: num(r["epsEstimate"]),
      revenueEstimate: num(r["revenueEstimate"]),
      quarter: num(r["quarter"]),
      year: num(r["year"]),
      region: "US",
      hour: str(r["hour"]),
    });
  }

  return out;
}

/**
 * Indian dates cost one call per symbol, so this is capped to the largest
 * names — the ones a reader is plausibly holding — rather than the exchange.
 */
const INDIA_SAMPLE = 18;

async function indiaCalendar(fromMs: number, toMs: number): Promise<CalendarEntry[]> {
  const names = UNIVERSE.filter((i) => i.region === "IN" && i.kind === "equity")
    .sort((a, b) => b.seedCap - a.seedCap)
    .slice(0, INDIA_SAMPLE);

  const results = await Promise.all(
    names.map(async (inst): Promise<CalendarEntry | null> => {
      const when = await fetchNextEarningsDate(inst);
      if (when == null || when < fromMs || when > toMs) return null;
      return {
        symbol: inst.symbol,
        slug: inst.slug,
        name: inst.name,
        date: new Date(when).toISOString().slice(0, 10),
        epsEstimate: null,
        revenueEstimate: null,
        quarter: null,
        year: null,
        region: "IN",
        hour: null,
      };
    }),
  );

  return results.filter((r): r is CalendarEntry => r !== null);
}

export async function GET(req: NextRequest) {
  const days = Math.min(60, Math.max(7, Number(req.nextUrl.searchParams.get("days")) || 21));
  const from = isoDay(0);
  const to = isoDay(days);

  try {
    const { value } = await cached(
      `earnings-calendar:${days}`,
      // Scheduled dates move rarely; an hour is generous and keeps the
      // per-symbol Indian fan-out off almost every request.
      { ttl: 3_600_000, maxAge: 21_600_000 },
      async () => {
        const [us, india] = await Promise.all([
          usCalendar(from, to).catch(() => [] as CalendarEntry[]),
          indiaCalendar(Date.now() - 86_400_000, Date.now() + days * 86_400_000).catch(
            () => [] as CalendarEntry[],
          ),
        ]);

        const merged = [...india, ...us].sort((a, b) => {
          if (a.date !== b.date) return a.date.localeCompare(b.date);
          // Names the terminal can actually open come first within a day.
          if (Boolean(a.slug) !== Boolean(b.slug)) return a.slug ? -1 : 1;
          return a.symbol.localeCompare(b.symbol);
        });

        return merged;
      },
    );

    return NextResponse.json(
      { data: value, from, to, asOf: Date.now() },
      { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=7200" } },
    );
  } catch {
    return NextResponse.json(
      { data: [], from, to, notice: "The earnings calendar is temporarily unavailable.", asOf: Date.now() },
      { status: 200 },
    );
  }
}
