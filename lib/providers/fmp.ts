import "server-only";

import { isoMs, num, providerFetch, str } from "@/lib/providers/http";
import { registerLimiter } from "@/lib/providers/limiter";
import type { EarningsPoint, Fundamentals, ProviderMeta, QuoteProvider } from "@/lib/providers/types";
import { ProviderError } from "@/lib/providers/types";
import type { Instrument } from "@/lib/market/universe";

/**
 * Financial Modeling Prep.
 *
 * 250 calls a *day*, which is a fundamentally different budget from the others
 * — it cannot be waited out inside a request, and burning it on quotes would
 * be indefensible. So FMP is used for exactly one thing: the fundamentals
 * panel, where figures change quarterly and a 24-hour cache means a handful of
 * calls serves every visitor.
 *
 * The daily window is enforced by the limiter, which refuses rather than
 * queues when a per-day budget is spent — see `lib/providers/limiter.ts`.
 */

const BASE = "https://financialmodelingprep.com/api/v3";
const ID = "fmp";

registerLimiter(ID, { perDay: 230, perMinute: 20 }); // 250/day published; keep a reserve.

function key(): string | null {
  return process.env.FMP_API_KEY?.trim() || null;
}

export const fmpMeta: ProviderMeta = {
  id: ID,
  label: "Financial Modeling Prep",
  homepage: "https://site.financialmodelingprep.com",
  capabilities: ["fundamentals", "earnings"],
  coverage: ["US"],
  get configured() {
    return key() !== null;
  },
  envVar: "FMP_API_KEY",
};

function url(path: string, params: Record<string, string | number> = {}): string {
  const k = key();
  if (!k) throw new ProviderError(ID, "FMP_API_KEY not configured", 401, true);
  const u = new URL(`${BASE}${path}`);
  for (const [name, value] of Object.entries(params)) u.searchParams.set(name, String(value));
  u.searchParams.set("apikey", k);
  return u.toString();
}

export const fmp: QuoteProvider = {
  meta: fmpMeta,

  /**
   * Two endpoints, merged: `key-metrics-ttm` carries the valuation multiples
   * and `ratios-ttm` the margins and leverage. Both are one call each and both
   * are cached for a day upstream of here.
   */
  async fetchFundamentals(inst: Instrument): Promise<Fundamentals | null> {
    const [metrics, ratios] = await Promise.all([
      providerFetch<Record<string, unknown>[]>(
        url(`/key-metrics-ttm/${inst.symbol}`, { limit: 1 }),
        { provider: ID, maxWaitMs: 800 },
      ).catch(() => [] as Record<string, unknown>[]),
      providerFetch<Record<string, unknown>[]>(
        url(`/ratios-ttm/${inst.symbol}`, { limit: 1 }),
        { provider: ID, maxWaitMs: 800 },
      ).catch(() => [] as Record<string, unknown>[]),
    ]);

    const m = Array.isArray(metrics) ? metrics[0] : undefined;
    const r = Array.isArray(ratios) ? ratios[0] : undefined;
    if (!m && !r) return null;

    // FMP reports margins and returns as fractions; the UI renders percent.
    const pct = (v: number | null) => (v == null ? null : v * 100);

    return {
      symbol: inst.symbol,
      marketCap: num(m?.["marketCapTTM"]),
      peRatio: num(m?.["peRatioTTM"]) ?? num(r?.["priceEarningsRatioTTM"]),
      pegRatio: num(r?.["priceEarningsToGrowthRatioTTM"]),
      priceToBook: num(m?.["pbRatioTTM"]) ?? num(r?.["priceToBookRatioTTM"]),
      priceToSales: num(m?.["priceToSalesRatioTTM"]),
      eps: num(m?.["netIncomePerShareTTM"]),
      revenue: num(m?.["revenuePerShareTTM"]),
      revenueGrowth: null,
      grossMargin: pct(num(r?.["grossProfitMarginTTM"])),
      operatingMargin: pct(num(r?.["operatingProfitMarginTTM"])),
      netMargin: pct(num(r?.["netProfitMarginTTM"])),
      roe: pct(num(m?.["roeTTM"]) ?? num(r?.["returnOnEquityTTM"])),
      roa: pct(num(r?.["returnOnAssetsTTM"])),
      debtToEquity: num(m?.["debtToEquityTTM"]) ?? num(r?.["debtEquityRatioTTM"]),
      currentRatio: num(m?.["currentRatioTTM"]) ?? num(r?.["currentRatioTTM"]),
      dividendYield: pct(num(m?.["dividendYieldTTM"])),
      beta: null,
      sharesOutstanding: null,
      asOf: str(m?.["date"]) ?? str(r?.["date"]),
      provider: ID,
    };
  },

  async fetchEarnings(inst: Instrument): Promise<EarningsPoint[]> {
    const raw = await providerFetch<Record<string, unknown>[]>(
      url(`/historical/earning_calendar/${inst.symbol}`, { limit: 8 }),
      { provider: ID, maxWaitMs: 800 },
    );
    if (!Array.isArray(raw)) return [];

    return raw
      .map((row) => {
        const period = str(row["date"]);
        if (!period) return null;
        const actual = num(row["eps"]);
        const estimate = num(row["epsEstimated"]);
        return {
          period,
          reportedAt: isoMs(period),
          epsActual: actual,
          epsEstimate: estimate,
          surprisePercent:
            actual != null && estimate != null && estimate !== 0
              ? ((actual - estimate) / Math.abs(estimate)) * 100
              : null,
          revenueActual: num(row["revenue"]),
          revenueEstimate: num(row["revenueEstimated"]),
        } satisfies EarningsPoint;
      })
      .filter((e): e is EarningsPoint => e !== null)
      .slice(0, 8);
  },
};

export { ID as FMP_ID };
