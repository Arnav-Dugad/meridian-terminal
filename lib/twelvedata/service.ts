import "server-only";

import { cached, peek } from "@/lib/twelvedata/cache";
import {
  bool,
  hasApiKey,
  MissingApiKey,
  num,
  parseDatetime,
  parseTimestamp,
  RateLimitExceeded,
  str,
  tdFetch,
} from "@/lib/twelvedata/client";
import { simulateFx, simulateQuote, simulateSeries } from "@/lib/twelvedata/simulate";
import type {
  Candle,
  CompanyProfile,
  DataSource,
  FxRate,
  MarketBreadth,
  Quote,
  RangeKey,
  SectorAggregate,
  Series,
} from "@/lib/twelvedata/types";
import { RANGE_SPEC } from "@/lib/twelvedata/types";
import type { ExchangeCode, Region } from "@/lib/market/exchanges";
import { EXCHANGES, sessionState } from "@/lib/market/exchanges";
import type { Instrument, Sector } from "@/lib/market/universe";
import { findBySlug, SECTORS } from "@/lib/market/universe";

/**
 * The service layer: everything above this asks for domain objects and gets
 * them, always. Provider outages, missing keys and exhausted credit budgets
 * are handled here by degrading to cache and then to simulation, with the
 * resulting `source` propagated so the UI can be honest about what it shows.
 */

export interface Resolved<T> {
  data: T;
  source: DataSource;
  notice?: string;
}

/* ── Quotes ───────────────────────────────────────────────────────────────── */

function quoteTtl(exchange: ExchangeCode): number {
  return sessionState(exchange).isLive ? 12_000 : 120_000;
}

/**
 * Batch quotes for a mixed set of instruments.
 *
 * Requests are grouped by exchange because Twelve Data's `exchange` parameter
 * applies to the whole call, and an unqualified `LT` is ambiguous between the
 * NSE listing and an unrelated US one.
 */
export async function getQuotes(slugs: string[]): Promise<Resolved<Quote[]>> {
  const instruments = slugs
    .map((s) => findBySlug(s))
    .filter((i): i is Instrument => Boolean(i));

  if (instruments.length === 0) return { data: [], source: "simulated" };

  if (!hasApiKey()) {
    return {
      data: instruments.map((i) => simulateQuote(i)),
      source: "simulated",
      notice: "Simulated market — no TWELVE_DATA_API_KEY configured.",
    };
  }

  const byExchange = new Map<ExchangeCode, Instrument[]>();
  for (const inst of instruments) {
    const list = byExchange.get(inst.exchange);
    if (list) list.push(inst);
    else byExchange.set(inst.exchange, [inst]);
  }

  const results = new Map<string, Quote>();
  let degraded = false;
  let notice: string | undefined;

  await Promise.all(
    Array.from(byExchange.entries()).map(async ([exchange, group]) => {
      try {
        const fetched = await fetchQuoteGroup(exchange, group);
        for (const q of fetched) results.set(q.slug, q);
      } catch (err) {
        degraded = true;
        notice ??= describeFailure(err);
      }
    }),
  );

  // Fill gaps: last good cached value if we have one, else simulation.
  const data: Quote[] = instruments.map((inst) => {
    const live = results.get(inst.slug);
    if (live) return live;

    const stale = peek<Quote>(quoteKey(inst));
    if (stale) {
      degraded = true;
      return { ...stale.value, source: "cached" as const };
    }
    degraded = true;
    return simulateQuote(inst);
  });

  const source: DataSource = degraded
    ? data.every((q) => q.source === "simulated")
      ? "simulated"
      : "cached"
    : "live";

  return { data, source, notice: degraded ? (notice ?? "Some symbols degraded to cached or simulated values.") : undefined };
}

function quoteKey(inst: Instrument) {
  return `quote:${inst.slug}`;
}

async function fetchQuoteGroup(exchange: ExchangeCode, group: Instrument[]): Promise<Quote[]> {
  const ttl = quoteTtl(exchange);

  // Serve anything already fresh from cache and only ask upstream for the rest.
  const missing: Instrument[] = [];
  const hits: Quote[] = [];
  for (const inst of group) {
    const hit = peek<Quote>(quoteKey(inst));
    if (hit && !hit.stale) hits.push(hit.value);
    else missing.push(inst);
  }
  if (missing.length === 0) return hits;

  const symbols = missing.map((i) => i.symbol);
  const key = `quotes:${exchange}:${symbols.slice().sort().join(",")}`;
  const isIndexOnly = missing.every((i) => i.kind === "index");

  const { value } = await cached(key, { ttl, maxAge: ttl * 20 }, async () => {
    return tdFetch<unknown>(
      "quote",
      {
        symbol: symbols.join(","),
        // Indices are not scoped by exchange in Twelve Data's namespace.
        exchange: isIndexOnly ? undefined : exchange,
      },
      { cost: symbols.length, maxWaitMs: 2500 },
    );
  });

  const rows = unwrapBatch(value, symbols);
  const out: Quote[] = [...hits];

  for (const inst of missing) {
    const raw = rows.get(inst.symbol);
    const parsed = raw ? normaliseQuote(raw, inst) : null;
    if (parsed) {
      // Seed the per-symbol cache so partial batches can be reused later.
      void cached(quoteKey(inst), { ttl, maxAge: ttl * 20 }, async () => parsed);
      out.push(parsed);
    }
  }
  return out;
}

/**
 * Twelve Data returns a bare object for one symbol and a symbol-keyed map for
 * many. Per-symbol failures arrive as `{ status: "error" }` values inside an
 * otherwise successful map, and must not poison the healthy rows.
 */
function unwrapBatch(payload: unknown, symbols: string[]): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  if (typeof payload !== "object" || payload === null) return out;

  const obj = payload as Record<string, unknown>;

  if (symbols.length === 1 && ("close" in obj || "symbol" in obj || "values" in obj)) {
    const only = symbols[0];
    if (only) out.set(only, obj);
    return out;
  }

  for (const sym of symbols) {
    const row = obj[sym];
    if (typeof row === "object" && row !== null) {
      const rec = row as Record<string, unknown>;
      if (rec["status"] === "error") continue;
      out.set(sym, rec);
    }
  }
  return out;
}

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

  const timestamp =
    parseTimestamp(raw["timestamp"]) ?? parseDatetime(raw["datetime"]) ?? Date.now();

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
    isOpen: bool(raw["is_market_open"]),
    source: "live",
  };
}

/* ── Time series ──────────────────────────────────────────────────────────── */

export async function getSeries(slug: string, range: RangeKey): Promise<Resolved<Series>> {
  const inst = findBySlug(slug);
  if (!inst) throw new Error(`Unknown instrument: ${slug}`);

  if (!hasApiKey()) {
    return {
      data: simulateSeries(inst, range),
      source: "simulated",
      notice: "Simulated history — no TWELVE_DATA_API_KEY configured.",
    };
  }

  const spec = RANGE_SPEC[range];
  const intraday = spec.interval.includes("min") || spec.interval === "1h";
  const ttl = intraday ? 60_000 : 900_000;
  const key = `series:${inst.slug}:${range}`;

  try {
    const { value, stale } = await cached(key, { ttl, maxAge: ttl * 24 }, async () =>
      tdFetch<unknown>(
        "time_series",
        {
          symbol: inst.symbol,
          exchange: inst.kind === "index" ? undefined : inst.exchange,
          interval: spec.interval,
          outputsize: spec.outputsize,
          order: "ASC",
        },
        { cost: 1, maxWaitMs: 3000 },
      ),
    );

    const candles = normaliseCandles(value);
    if (candles.length === 0) throw new Error("Empty series");

    return {
      data: {
        symbol: inst.symbol,
        slug: inst.slug,
        interval: spec.interval,
        range,
        currency: inst.currency,
        candles,
        source: stale ? "cached" : "live",
      },
      source: stale ? "cached" : "live",
    };
  } catch (err) {
    const stale = peek<unknown>(key);
    if (stale) {
      const candles = normaliseCandles(stale.value);
      if (candles.length > 0) {
        return {
          data: {
            symbol: inst.symbol,
            slug: inst.slug,
            interval: spec.interval,
            range,
            currency: inst.currency,
            candles,
            source: "cached",
          },
          source: "cached",
          notice: "Showing the last successfully retrieved history.",
        };
      }
    }
    return {
      data: simulateSeries(inst, range),
      source: "simulated",
      notice: describeFailure(err),
    };
  }
}

function normaliseCandles(payload: unknown): Candle[] {
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
}

/* ── Profile ──────────────────────────────────────────────────────────────── */

export async function getProfile(slug: string): Promise<Resolved<CompanyProfile | null>> {
  const inst = findBySlug(slug);
  if (!inst || inst.kind === "index") return { data: null, source: "simulated" };
  if (!hasApiKey()) return { data: null, source: "simulated" };

  try {
    const { value } = await cached(`profile:${inst.slug}`, { ttl: 86_400_000 }, async () =>
      tdFetch<Record<string, unknown>>(
        "profile",
        { symbol: inst.symbol, exchange: inst.exchange },
        { cost: 1, maxWaitMs: 1500 },
      ),
    );

    return {
      data: {
        symbol: inst.symbol,
        name: str(value["name"]) ?? inst.name,
        exchange: inst.exchange,
        currency: inst.currency,
        sector: str(value["sector"]),
        industry: str(value["industry"]),
        description: str(value["description"]),
        website: str(value["website"]),
        employees: num(value["employees"]),
        ceo: str(value["CEO"]) ?? str(value["ceo"]),
        country: str(value["country"]),
        source: "live",
      },
      source: "live",
    };
  } catch {
    // A missing profile is cosmetic; never fail the page over it.
    return { data: null, source: "simulated" };
  }
}

/* ── FX ───────────────────────────────────────────────────────────────────── */

export async function getFx(pair = "USD/INR"): Promise<Resolved<FxRate>> {
  if (!hasApiKey()) {
    return {
      data: { pair, rate: simulateFx(pair), timestamp: Date.now(), source: "simulated" },
      source: "simulated",
    };
  }
  try {
    const { value, stale } = await cached(`fx:${pair}`, { ttl: 300_000, maxAge: 3_600_000 }, async () =>
      tdFetch<Record<string, unknown>>("exchange_rate", { symbol: pair }, { cost: 1, maxWaitMs: 1500 }),
    );
    const rate = num(value["rate"]);
    if (rate == null) throw new Error("No rate");
    return {
      data: {
        pair,
        rate,
        timestamp: parseTimestamp(value["timestamp"]) ?? Date.now(),
        source: stale ? "cached" : "live",
      },
      source: stale ? "cached" : "live",
    };
  } catch {
    return {
      data: { pair, rate: simulateFx(pair), timestamp: Date.now(), source: "simulated" },
      source: "simulated",
    };
  }
}

/* ── Derived analytics ────────────────────────────────────────────────────── */

/**
 * Breadth is computed locally from the quotes we already hold rather than
 * bought from a dedicated endpoint. It costs nothing extra and stays
 * consistent with whatever the user is actually looking at.
 */
export function computeBreadth(quotes: Quote[], region: Region): MarketBreadth {
  const rows = quotes.filter((q) => q.region === region && q.sector !== "Index");
  let advancing = 0;
  let declining = 0;
  let unchanged = 0;
  let capSum = 0;
  let capWeighted = 0;
  let simpleSum = 0;

  for (const q of rows) {
    if (q.changePercent > 0.02) advancing++;
    else if (q.changePercent < -0.02) declining++;
    else unchanged++;
    const cap = q.marketCap ?? 0;
    capSum += cap;
    capWeighted += cap * q.changePercent;
    simpleSum += q.changePercent;
  }

  const total = rows.length || 1;
  return {
    region,
    advancing,
    declining,
    unchanged,
    weightedChange: capSum > 0 ? capWeighted / capSum : simpleSum / total,
    meanChange: simpleSum / total,
    ratio: (advancing + declining) > 0 ? advancing / (advancing + declining) : 0.5,
  };
}

export function computeSectors(quotes: Quote[], region: Region): SectorAggregate[] {
  const out: SectorAggregate[] = [];

  for (const sector of SECTORS) {
    const rows = quotes.filter((q) => q.region === region && q.sector === sector);
    if (rows.length === 0) continue;

    let capSum = 0;
    let weighted = 0;
    let advancing = 0;
    for (const q of rows) {
      const cap = q.marketCap ?? 1;
      capSum += cap;
      weighted += cap * q.changePercent;
      if (q.changePercent > 0) advancing++;
    }

    const leaders = rows
      .slice()
      .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
      .slice(0, 3)
      .map((q) => ({ slug: q.slug, symbol: q.symbol, changePercent: q.changePercent }));

    out.push({
      sector: sector as Sector,
      region,
      changePercent: capSum > 0 ? weighted / capSum : 0,
      weight: capSum,
      count: rows.length,
      advancing,
      leaders,
    });
  }

  return out.sort((a, b) => b.changePercent - a.changePercent);
}

/* ── Failure messaging ────────────────────────────────────────────────────── */

function describeFailure(err: unknown): string {
  if (err instanceof MissingApiKey) return "Simulated market — no TWELVE_DATA_API_KEY configured.";
  if (err instanceof RateLimitExceeded) {
    return `Twelve Data credit budget reached — showing cached values. Retry in ${Math.ceil(
      err.retryAfterMs / 1000,
    )}s.`;
  }
  if (err instanceof Error) return `Live feed unavailable — ${err.message}`;
  return "Live feed unavailable.";
}

export function marketStatusSnapshot() {
  return (["NSE", "BSE", "NASDAQ", "NYSE"] as ExchangeCode[]).map((code) => ({
    code,
    name: EXCHANGES[code].name,
    region: EXCHANGES[code].region,
    ...sessionState(code),
  }));
}
