import "server-only";

import { isoMs, num, providerFetch, str } from "@/lib/providers/http";
import { registerLimiter } from "@/lib/providers/limiter";
import type { EarningsPoint, Fundamentals, ProviderMeta, QuoteProvider } from "@/lib/providers/types";
import { ProviderError } from "@/lib/providers/types";
import type { Instrument } from "@/lib/market/universe";

/**
 * Financial Modeling Prep.
 *
 * ── On the endpoint version ────────────────────────────────────────────────
 * This targets FMP's `/stable/` API. The `/api/v3/` endpoints this originally
 * used were decommissioned on 31 August 2025 and now answer every request with
 * "Legacy Endpoint ... only available for legacy users", including on a valid
 * current key — so the fundamentals panel returned nothing while looking like
 * a coverage problem rather than a versioning one.
 *
 * ── On the budget ──────────────────────────────────────────────────────────
 * 250 calls a *day* is a fundamentally different constraint from a per-minute
 * one: it cannot be waited out inside a request, and spending it on quotes
 * would be indefensible. FMP is therefore used for exactly one thing — the
 * fundamentals panel — where figures change quarterly and a 24-hour cache
 * means a handful of calls serves every visitor.
 *
 * Free-tier symbol coverage is US-only; Indian tickers return a "Premium Query
 * Parameter" error, which the chain treats as a failover.
 */

const BASE = "https://financialmodelingprep.com/stable";
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
  const u = new URL(`${BASE}/${path.replace(/^\//, "")}`);
  for (const [name, value] of Object.entries(params)) u.searchParams.set(name, String(value));
  u.searchParams.set("apikey", k);
  return u.toString();
}

/**
 * FMP answers HTTP 200 with an `Error Message` body for a decommissioned
 * endpoint or an out-of-plan symbol, so failure has to be detected in the
 * payload rather than the status line.
 */
function firstRow(payload: unknown, context: string): Record<string, unknown> | null {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const message = str((payload as Record<string, unknown>)["Error Message"]);
    if (message) throw new ProviderError(ID, `${message.slice(0, 120)} (${context})`, 403, true);
  }
  if (!Array.isArray(payload) || payload.length === 0) return null;
  const row = payload[0];
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
}

export const fmp: QuoteProvider = {
  meta: fmpMeta,

  /**
   * Three endpoints merged: `key-metrics-ttm` carries valuation and returns,
   * `ratios-ttm` the margins and leverage, and `quote` the market cap and beta.
   * Each is one call, all three are cached for a day, and any one of them
   * failing still yields a usable panel.
   */
  async fetchFundamentals(inst: Instrument): Promise<Fundamentals | null> {
    const [metrics, ratios, quote] = await Promise.all([
      providerFetch<unknown>(url("key-metrics-ttm", { symbol: inst.symbol }), {
        provider: ID,
        maxWaitMs: 800,
      }).then((p) => firstRow(p, "key-metrics-ttm")).catch(() => null),
      providerFetch<unknown>(url("ratios-ttm", { symbol: inst.symbol }), {
        provider: ID,
        maxWaitMs: 800,
      }).then((p) => firstRow(p, "ratios-ttm")).catch(() => null),
      providerFetch<unknown>(url("quote", { symbol: inst.symbol }), {
        provider: ID,
        maxWaitMs: 800,
      }).then((p) => firstRow(p, "quote")).catch(() => null),
    ]);

    if (!metrics && !ratios && !quote) return null;

    // FMP reports margins and returns as fractions; the UI renders percent.
    const pct = (v: number | null) => (v == null ? null : v * 100);

    return {
      symbol: inst.symbol,
      marketCap: num(metrics?.["marketCap"]) ?? num(quote?.["marketCap"]),
      peRatio: num(ratios?.["priceToEarningsRatioTTM"]) ?? num(quote?.["pe"]),
      pegRatio: num(ratios?.["priceToEarningsGrowthRatioTTM"]),
      priceToBook: num(ratios?.["priceToBookRatioTTM"]),
      priceToSales: num(ratios?.["priceToSalesRatioTTM"]) ?? num(metrics?.["evToSalesTTM"]),
      eps: num(quote?.["eps"]) ?? num(ratios?.["netIncomePerShareTTM"]),
      revenue: num(ratios?.["revenuePerShareTTM"]),
      revenueGrowth: null,
      grossMargin: pct(num(ratios?.["grossProfitMarginTTM"])),
      operatingMargin: pct(num(ratios?.["operatingProfitMarginTTM"])),
      netMargin: pct(num(ratios?.["netProfitMarginTTM"])),
      roe: pct(num(ratios?.["returnOnEquityTTM"]) ?? num(metrics?.["returnOnEquityTTM"])),
      roa: pct(num(ratios?.["returnOnAssetsTTM"]) ?? num(metrics?.["returnOnAssetsTTM"])),
      debtToEquity: num(ratios?.["debtToEquityRatioTTM"]) ?? num(metrics?.["netDebtToEBITDATTM"]),
      currentRatio: num(metrics?.["currentRatioTTM"]) ?? num(ratios?.["currentRatioTTM"]),
      dividendYield: pct(num(ratios?.["dividendYieldTTM"])),
      beta: null,
      sharesOutstanding: num(quote?.["sharesOutstanding"]),
      asOf: str(metrics?.["date"]) ?? str(ratios?.["date"]),
      provider: ID,
    };
  },

  async fetchEarnings(inst: Instrument): Promise<EarningsPoint[]> {
    const payload = await providerFetch<unknown>(
      url("earnings", { symbol: inst.symbol, limit: 8 }),
      { provider: ID, maxWaitMs: 800 },
    );

    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const message = str((payload as Record<string, unknown>)["Error Message"]);
      if (message) throw new ProviderError(ID, message.slice(0, 120), 403, true);
    }
    if (!Array.isArray(payload)) return [];

    const points: EarningsPoint[] = [];
    for (const row of payload) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const period = str(r["date"]);
      if (!period) continue;

      const actual = num(r["epsActual"]) ?? num(r["eps"]);
      const estimate = num(r["epsEstimated"]);

      points.push({
        period,
        reportedAt: isoMs(period),
        epsActual: actual,
        epsEstimate: estimate,
        surprisePercent:
          actual != null && estimate != null && estimate !== 0
            ? ((actual - estimate) / Math.abs(estimate)) * 100
            : null,
        revenueActual: num(r["revenueActual"]) ?? num(r["revenue"]),
        revenueEstimate: num(r["revenueEstimated"]),
      });
    }

    // Only past quarters carry a reported figure; upcoming rows are estimates.
    return points
      .filter((p) => p.epsActual != null)
      .sort((a, b) => (b.reportedAt ?? 0) - (a.reportedAt ?? 0))
      .slice(0, 8);
  },
};

export { ID as FMP_ID };
