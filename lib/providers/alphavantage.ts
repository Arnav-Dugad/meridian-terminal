import "server-only";

import { num, providerFetch, str } from "@/lib/providers/http";
import { registerLimiter } from "@/lib/providers/limiter";
import type { ProviderMeta, QuoteProvider } from "@/lib/providers/types";
import { ProviderError } from "@/lib/providers/types";
import type { Instrument } from "@/lib/market/universe";
import type { Candle, Quote, RangeKey } from "@/lib/twelvedata/types";
import { RANGE_SPEC } from "@/lib/twelvedata/types";

/**
 * Alpha Vantage.
 *
 * Twenty-five calls a day. That is not a data source, it is a spare tyre — and
 * it is wired up as exactly that: last in every chain, never consulted while a
 * provider with headroom exists. Its value is on the day a key expires or an
 * upstream has an outage, when twenty-five calls is the difference between a
 * degraded terminal and a simulated one.
 *
 * Alpha Vantage also answers HTTP 200 with a `Note` or `Information` field
 * when you exceed the limit, so the throttle has to be detected in the body
 * rather than the status line.
 */

const BASE = "https://www.alphavantage.co/query";
const ID = "alphavantage";

registerLimiter(ID, { perDay: 22, perMinute: 5 });

function key(): string | null {
  return process.env.ALPHA_VANTAGE_API_KEY?.trim() || null;
}

export const alphaVantageMeta: ProviderMeta = {
  id: ID,
  label: "Alpha Vantage",
  homepage: "https://www.alphavantage.co",
  capabilities: ["quote", "series"],
  coverage: ["US"],
  get configured() {
    return key() !== null;
  },
  envVar: "ALPHA_VANTAGE_API_KEY",
};

function url(params: Record<string, string>): string {
  const k = key();
  if (!k) throw new ProviderError(ID, "ALPHA_VANTAGE_API_KEY not configured", 401, true);
  const u = new URL(BASE);
  for (const [name, value] of Object.entries(params)) u.searchParams.set(name, value);
  u.searchParams.set("apikey", k);
  return u.toString();
}

/** The limit notice arrives as a 200 with a prose field. */
function assertNotThrottled(payload: Record<string, unknown>): void {
  const note = str(payload["Note"]) ?? str(payload["Information"]);
  if (note) throw new ProviderError(ID, note.slice(0, 120), 429, true);
  const err = str(payload["Error Message"]);
  if (err) throw new ProviderError(ID, err.slice(0, 120), 404, true);
}

export const alphaVantage: QuoteProvider = {
  meta: alphaVantageMeta,

  async fetchQuotes(instruments: Instrument[]): Promise<Quote[]> {
    const out: Quote[] = [];

    // One symbol per call and a day's budget of twenty-two: this is a
    // deliberate trickle, never a batch.
    for (const inst of instruments.slice(0, 4)) {
      try {
        const payload = await providerFetch<Record<string, unknown>>(
          url({ function: "GLOBAL_QUOTE", symbol: inst.symbol }),
          { provider: ID, maxWaitMs: 600 },
        );
        assertNotThrottled(payload);

        const q = payload["Global Quote"];
        if (typeof q !== "object" || q === null) continue;
        const row = q as Record<string, unknown>;

        const price = num(row["05. price"]);
        if (price == null) continue;
        const previousClose = num(row["08. previous close"]) ?? price;

        out.push({
          symbol: inst.symbol,
          slug: inst.slug,
          name: inst.name,
          exchange: inst.exchange,
          region: inst.region,
          currency: inst.currency,
          sector: inst.sector,
          price,
          previousClose,
          open: num(row["02. open"]) ?? price,
          dayHigh: num(row["03. high"]) ?? price,
          dayLow: num(row["04. low"]) ?? price,
          change: num(row["09. change"]) ?? price - previousClose,
          changePercent: num(String(row["10. change percent"] ?? "").replace("%", "")) ?? 0,
          volume: num(row["06. volume"]) ?? 0,
          fiftyTwoWeekHigh: null,
          fiftyTwoWeekLow: null,
          fiftyTwoWeekPosition: null,
          marketCap: null,
          timestamp: Date.now(),
          isOpen: false,
          source: "live",
          provider: ID,
        });
      } catch (err) {
        if (err instanceof ProviderError && err.status === 429) break;
      }
    }

    return out;
  },

  async fetchSeries(inst: Instrument, range: RangeKey): Promise<Candle[]> {
    const spec = RANGE_SPEC[range];
    const daily = !spec.interval.includes("min") && spec.interval !== "1h";

    const payload = await providerFetch<Record<string, unknown>>(
      url(
        daily
          ? { function: "TIME_SERIES_DAILY", symbol: inst.symbol, outputsize: "compact" }
          : { function: "TIME_SERIES_INTRADAY", symbol: inst.symbol, interval: "5min", outputsize: "compact" },
      ),
      { provider: ID, maxWaitMs: 900 },
    );
    assertNotThrottled(payload);

    const seriesKey = Object.keys(payload).find((k) => k.includes("Time Series"));
    if (!seriesKey) return [];
    const series = payload[seriesKey];
    if (typeof series !== "object" || series === null) return [];

    const out: Candle[] = [];
    for (const [stamp, value] of Object.entries(series as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) continue;
      const row = value as Record<string, unknown>;
      const c = num(row["4. close"]);
      if (c == null) continue;
      const t = Date.parse(stamp.includes(" ") ? `${stamp.replace(" ", "T")}Z` : `${stamp}T00:00:00Z`);
      if (Number.isNaN(t)) continue;

      out.push({
        t,
        o: num(row["1. open"]) ?? c,
        h: num(row["2. high"]) ?? c,
        l: num(row["3. low"]) ?? c,
        c,
        v: num(row["5. volume"]) ?? 0,
      });
    }

    out.sort((a, b) => a.t - b.t);
    return out.slice(-spec.outputsize);
  },
};

export { ID as ALPHAVANTAGE_ID };
