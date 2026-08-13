import "server-only";

import { registerLimiter } from "@/lib/providers/limiter";
import { providerFetch, num, str } from "@/lib/providers/http";
import type { ProviderMeta, QuoteProvider } from "@/lib/providers/types";
import { ProviderError } from "@/lib/providers/types";
import type { Instrument } from "@/lib/market/universe";
import type { Candle, Quote, RangeKey } from "@/lib/twelvedata/types";
import { RANGE_SPEC } from "@/lib/twelvedata/types";
import type { ExchangeCode } from "@/lib/market/exchanges";

/**
 * Twelve Data.
 *
 * The only provider in this stack whose free tier reaches the Indian
 * exchanges, which makes it irreplaceable for NSE and BSE — and its budget is
 * the tightest at eight credits a minute, where a twenty-symbol batch costs
 * twenty. Those two facts together define its role: it is reserved for what
 * nothing else can do (India, and price history everywhere), and deliberately
 * *not* used for US quotes, which Finnhub serves from a budget seven times
 * larger.
 *
 * If your plan does not include the Indian exchanges, NSE requests here return
 * 403 and the registry falls through to the simulation layer — which is why
 * India can read "Simulated" even with a valid key. The health endpoint says
 * so explicitly.
 */

const BASE = "https://api.twelvedata.com";
const ID = "twelvedata";

function budget(): number {
  const raw = Number(process.env.TWELVE_DATA_CREDITS_PER_MINUTE);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 8;
}

registerLimiter(ID, { perMinute: budget() });

function key(): string | null {
  return process.env.TWELVE_DATA_API_KEY?.trim() || null;
}

export const twelveDataMeta: ProviderMeta = {
  id: ID,
  label: "Twelve Data",
  homepage: "https://twelvedata.com",
  capabilities: ["quote", "series", "profile", "fx"],
  coverage: ["US", "IN", "FX"],
  get configured() {
    return key() !== null;
  },
  envVar: "TWELVE_DATA_API_KEY",
};

function url(path: string, params: Record<string, string | number | undefined> = {}): string {
  const k = key();
  if (!k) throw new ProviderError(ID, "TWELVE_DATA_API_KEY not configured", 401, true);
  const u = new URL(`${BASE}/${path.replace(/^\//, "")}`);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") u.searchParams.set(name, String(value));
  }
  u.searchParams.set("apikey", k);
  // UTC everywhere: parsing exchange-local datetimes without an offset is a
  // reliable source of off-by-hours bugs around DST transitions.
  u.searchParams.set("timezone", "UTC");
  return u.toString();
}

/**
 * Twelve Data signals failure three ways — a non-2xx status, HTTP 200 with
 * `{status:"error"}`, and HTTP 200 with a per-symbol error nested inside an
 * otherwise healthy batch. `providerFetch` catches the first; these handle the
 * rest.
 */
function assertOk(payload: unknown, context: string): void {
  if (typeof payload !== "object" || payload === null) return;
  const p = payload as Record<string, unknown>;
  if (p["status"] === "error") {
    const code = num(p["code"]) ?? 500;
    throw new ProviderError(ID, `${str(p["message"]) ?? "provider error"} (${context})`, code, true);
  }
}

function unwrapBatch(payload: unknown, symbols: string[]): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  if (typeof payload !== "object" || payload === null) return out;
  const obj = payload as Record<string, unknown>;

  // A single-symbol request returns the bare object; many return a keyed map.
  if (symbols.length === 1 && ("close" in obj || "symbol" in obj || "values" in obj)) {
    const only = symbols[0];
    if (only) out.set(only, obj);
    return out;
  }

  for (const sym of symbols) {
    const row = obj[sym];
    if (typeof row === "object" && row !== null) {
      const rec = row as Record<string, unknown>;
      // Per-symbol failures must not poison the healthy rows.
      if (rec["status"] === "error") continue;
      out.set(sym, rec);
    }
  }
  return out;
}

export const twelveData: QuoteProvider = {
  meta: twelveDataMeta,

  /**
   * Batched by exchange, because the `exchange` parameter applies to the whole
   * call and an unqualified `LT` is ambiguous between its NSE listing and an
   * unrelated US one.
   */
  async fetchQuotes(instruments: Instrument[]): Promise<Quote[]> {
    const byExchange = new Map<ExchangeCode, Instrument[]>();
    for (const inst of instruments) {
      const list = byExchange.get(inst.exchange);
      if (list) list.push(inst);
      else byExchange.set(inst.exchange, [inst]);
    }

    const out: Quote[] = [];

    for (const [exchange, group] of byExchange) {
      const symbols = group.map((i) => i.symbol);
      const indexOnly = group.every((i) => i.kind === "index");

      try {
        const payload = await providerFetch<unknown>(
          url("quote", {
            symbol: symbols.join(","),
            // Indices are not scoped by exchange in Twelve Data's namespace.
            exchange: indexOnly ? undefined : exchange,
          }),
          { provider: ID, cost: symbols.length, maxWaitMs: 2000 },
        );
        assertOk(payload, `quote/${exchange}`);

        const rows = unwrapBatch(payload, symbols);
        for (const inst of group) {
          const raw = rows.get(inst.symbol);
          const quote = raw ? normaliseQuote(raw, inst) : null;
          if (quote) out.push(quote);
        }
      } catch (err) {
        // One exchange failing (commonly NSE on a US-only plan) must not sink
        // the others in the same request.
        if (err instanceof ProviderError && err.status === 429) break;
      }
    }

    return out;
  },

  async fetchSeries(inst: Instrument, range: RangeKey): Promise<Candle[]> {
    const spec = RANGE_SPEC[range];
    const payload = await providerFetch<unknown>(
      url("time_series", {
        symbol: inst.symbol,
        exchange: inst.kind === "index" ? undefined : inst.exchange,
        interval: spec.interval,
        outputsize: spec.outputsize,
        order: "ASC",
      }),
      { provider: ID, cost: 1, maxWaitMs: 2500 },
    );
    assertOk(payload, `time_series/${inst.symbol}`);

    if (typeof payload !== "object" || payload === null) return [];
    const values = (payload as Record<string, unknown>)["values"];
    if (!Array.isArray(values)) return [];

    const out: Candle[] = [];
    for (const v of values) {
      if (typeof v !== "object" || v === null) continue;
      const row = v as Record<string, unknown>;
      const t = parseDatetime(row["datetime"]);
      const c = num(row["close"]);
      if (t == null || c == null) continue;
      const o = num(row["open"]) ?? c;
      const h = num(row["high"]) ?? Math.max(o, c);
      const l = num(row["low"]) ?? Math.min(o, c);
      out.push({ t, o, h, l, c, v: num(row["volume"]) ?? 0 });
    }

    // `order=ASC` is requested, but never trust an upstream ordering guarantee
    // when every downstream renderer assumes it.
    out.sort((a, b) => a.t - b.t);
    return out;
  },
};

function normaliseQuote(raw: Record<string, unknown>, inst: Instrument): Quote | null {
  const price = num(raw["close"]) ?? num(raw["price"]);
  if (price == null) return null;

  const previousClose = num(raw["previous_close"]) ?? price;
  const change = num(raw["change"]) ?? price - previousClose;
  const changePercent =
    num(raw["percent_change"]) ?? (previousClose > 0 ? (change / previousClose) * 100 : 0);

  const fiftyTwo = raw["fifty_two_week"];
  let high52: number | null = null;
  let low52: number | null = null;
  if (typeof fiftyTwo === "object" && fiftyTwo !== null) {
    const f = fiftyTwo as Record<string, unknown>;
    high52 = num(f["high"]);
    low52 = num(f["low"]);
  }

  const timestamp = parseTimestamp(raw["timestamp"]) ?? parseDatetime(raw["datetime"]) ?? Date.now();

  return {
    symbol: inst.symbol,
    slug: inst.slug,
    name: str(raw["name"]) ?? inst.name,
    exchange: inst.exchange,
    region: inst.region,
    currency: inst.currency,
    sector: inst.sector,
    price,
    previousClose,
    open: num(raw["open"]) ?? price,
    dayHigh: num(raw["high"]) ?? price,
    dayLow: num(raw["low"]) ?? price,
    change,
    changePercent,
    volume: num(raw["volume"]) ?? 0,
    fiftyTwoWeekHigh: high52,
    fiftyTwoWeekLow: low52,
    fiftyTwoWeekPosition:
      high52 != null && low52 != null && high52 > low52 ? (price - low52) / (high52 - low52) : null,
    marketCap: num(raw["market_cap"]),
    timestamp,
    isOpen: raw["is_market_open"] === true || raw["is_market_open"] === "true",
    source: "live",
    provider: ID,
  };
}

/** `YYYY-MM-DD` or `YYYY-MM-DD HH:mm:ss`, already in UTC by request. */
function parseDatetime(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const iso = s.includes(" ") ? `${s.replace(" ", "T")}Z` : `${s}T00:00:00Z`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function parseTimestamp(v: unknown): number | null {
  const n = num(v);
  if (n == null) return null;
  return n > 1e11 ? n : n * 1000;
}

/** Exchange rate, used by the portfolio's currency conversion. */
export async function fetchExchangeRate(pair: string): Promise<number | null> {
  const payload = await providerFetch<Record<string, unknown>>(
    url("exchange_rate", { symbol: pair }),
    { provider: ID, cost: 1, maxWaitMs: 1200 },
  );
  assertOk(payload, `exchange_rate/${pair}`);
  return num(payload["rate"]);
}

export { ID as TWELVEDATA_ID };
