import "server-only";

import { acquire } from "@/lib/providers/limiter";
import { ProviderError } from "@/lib/providers/types";
import type {
  AnalystConsensus,
  EarningsPoint,
  Fundamentals,
  ProviderMeta,
  QuoteProvider,
} from "@/lib/providers/types";
import type { Instrument } from "@/lib/market/universe";
import { yahooSymbolFor } from "@/lib/providers/yahoo";

/**
 * Yahoo `quoteSummary` — fundamentals, analyst coverage and earnings.
 *
 * This is the module that finally gives Indian listings a research panel.
 * Finnhub and FMP both restrict fundamentals to US symbols on their free
 * tiers, so RELIANCE had a chart and nothing else. `quoteSummary` returns
 * trailing and forward multiples, margins, leverage, growth, analyst
 * recommendation and price targets for NSE and BSE symbols exactly as it does
 * for Nasdaq ones.
 *
 * It shares the cookie-plus-crumb handshake with the options endpoint, and the
 * same caveat: undocumented, not contractual, and inside the failover chain
 * rather than trusted on its own.
 *
 * ── On the payload shape ──────────────────────────────────────────────────
 * Yahoo wraps almost every number as `{ raw, fmt, longFmt }`, and omits the
 * key entirely when it has no value — so a naive `data.trailingPE` is
 * sometimes a number, sometimes an object, and sometimes undefined. `pick()`
 * below is the single place that is untangled.
 */

const ID = "yahoo-summary";
const BASE = "https://query1.finance.yahoo.com/v10/finance/quoteSummary";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const MODULES = [
  "defaultKeyStatistics",
  "financialData",
  "summaryDetail",
  "calendarEvents",
  "recommendationTrend",
  "earningsHistory",
  "assetProfile",
  // Ownership and rating changes come free with the request already being
  // made, so there is no reason not to ask for them.
  "majorHoldersBreakdown",
  "institutionOwnership",
  "upgradeDowngradeHistory",
].join(",");

export const yahooSummaryMeta: ProviderMeta = {
  id: ID,
  label: "Yahoo Finance",
  homepage: "https://finance.yahoo.com",
  capabilities: ["fundamentals", "recommendations", "earnings", "profile"],
  coverage: ["IN", "US"],
  configured: true,
  envVar: null,
};

/* ── Crumb handshake, shared shape with the options client ────────────────── */

let crumb: string | null = null;
let cookies: string | null = null;
let mintedAt = 0;
const CRUMB_TTL_MS = 25 * 60 * 1000;

async function ensureCrumb(): Promise<void> {
  if (crumb && Date.now() - mintedAt < CRUMB_TTL_MS) return;

  const seed = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": UA, Accept: "text/html" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);

  const jar = seed?.headers.getSetCookie?.() ?? [];
  cookies = jar.map((c) => c.split(";")[0]).filter(Boolean).join("; ") || null;
  if (!cookies) throw new ProviderError(ID, "no Yahoo session cookies", 403, true);

  const res = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Accept: "text/plain", Cookie: cookies },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });

  const value = (await res.text()).trim();
  if (!value || value.length > 32 || value.includes("<")) {
    throw new ProviderError(ID, "no Yahoo crumb", 403, true);
  }
  crumb = value;
  mintedAt = Date.now();
}

/* ── Value extraction ─────────────────────────────────────────────────────── */

type Wrapped = { raw?: unknown; fmt?: string } | number | string | null | undefined;

/** Unwraps Yahoo's `{ raw, fmt }` envelope, or a bare value, to a number. */
function pick(value: Wrapped): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  const raw = (value as { raw?: unknown }).raw;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    const fmt = (value as { fmt?: unknown }).fmt;
    if (typeof fmt === "string" && fmt.trim()) return fmt.trim();
  }
  return null;
}

/** Yahoo expresses ratios as fractions; the UI renders percent. */
const asPercent = (v: number | null) => (v == null ? null : v * 100);

interface SummaryResult {
  defaultKeyStatistics?: Record<string, Wrapped>;
  financialData?: Record<string, Wrapped> & { recommendationKey?: string };
  summaryDetail?: Record<string, Wrapped>;
  calendarEvents?: { earnings?: { earningsDate?: { raw?: number; fmt?: string }[] } };
  recommendationTrend?: { trend?: Record<string, unknown>[] };
  earningsHistory?: { history?: Record<string, Wrapped>[] };
  assetProfile?: { sector?: string; industry?: string; longBusinessSummary?: string; website?: string; fullTimeEmployees?: number; country?: string };
  majorHoldersBreakdown?: Record<string, Wrapped>;
  institutionOwnership?: { ownershipList?: Record<string, unknown>[] };
  upgradeDowngradeHistory?: { history?: Record<string, unknown>[] };
}

/**
 * One request per symbol, shared by every capability.
 *
 * Fundamentals, analyst consensus and earnings all come from the *same*
 * payload, and the research route asks for all three at once. Left alone that
 * fires three identical requests in parallel, which Yahoo answers by
 * invalidating the crumb — the first call succeeds and the other two race,
 * clear the shared crumb, and return nothing. The visible symptom was an
 * Indian stock showing earnings history but no fundamentals.
 *
 * Collapsing them onto one in-flight promise fixes the race and cuts the
 * request count by two thirds.
 */
const inflight = new Map<string, Promise<SummaryResult | null>>();
const recent = new Map<string, { at: number; value: SummaryResult | null }>();
const MEMO_TTL_MS = 30_000;

async function fetchSummary(inst: Instrument): Promise<SummaryResult | null> {
  const symbol = yahooSymbolFor(inst);
  if (!symbol) return null;

  const hit = recent.get(symbol);
  if (hit && Date.now() - hit.at < MEMO_TTL_MS) return hit.value;

  const existing = inflight.get(symbol);
  if (existing) return existing;

  const promise = fetchSummaryUncached(inst, symbol)
    .then((value) => {
      recent.set(symbol, { at: Date.now(), value });
      if (recent.size > 200) recent.clear();
      return value;
    })
    .finally(() => {
      inflight.delete(symbol);
    });

  inflight.set(symbol, promise);
  return promise;
}

async function fetchSummaryUncached(
  inst: Instrument,
  symbol: string,
): Promise<SummaryResult | null> {
  void inst;
  await acquire("yahoo", 1, 1200);
  await ensureCrumb();

  const url = new URL(`${BASE}/${encodeURIComponent(symbol)}`);
  url.searchParams.set("modules", MODULES);
  url.searchParams.set("crumb", crumb!);

  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", Cookie: cookies ?? "" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new ProviderError(ID, `HTTP ${res.status}`, res.status, true);

  const payload = (await res.json()) as {
    quoteSummary?: { result?: SummaryResult[] | null; error?: { description?: string } | null };
  };

  if (payload.quoteSummary?.error) {
    // A stale crumb is the usual cause; drop it so the next call re-mints.
    crumb = null;
    throw new ProviderError(ID, payload.quoteSummary.error.description ?? "unavailable", 401, true);
  }

  return payload.quoteSummary?.result?.[0] ?? null;
}

export const yahooSummary: QuoteProvider = {
  meta: yahooSummaryMeta,

  async fetchFundamentals(inst: Instrument): Promise<Fundamentals | null> {
    const r = await fetchSummary(inst);
    if (!r) return null;

    const k = r.defaultKeyStatistics ?? {};
    const f = r.financialData ?? {};
    const s = r.summaryDetail ?? {};

    const fundamentals: Fundamentals = {
      symbol: inst.symbol,
      marketCap: pick(s["marketCap"]) ?? pick(k["marketCap"]),
      peRatio: pick(s["trailingPE"]) ?? pick(k["trailingPE"]),
      pegRatio: pick(k["pegRatio"]),
      priceToBook: pick(k["priceToBook"]),
      priceToSales: pick(k["priceToSalesTrailing12Months"]) ?? pick(s["priceToSalesTrailing12Months"]),
      eps: pick(k["trailingEps"]) ?? pick(s["trailingEps"]),
      revenue: pick(f["totalRevenue"]),
      revenueGrowth: asPercent(pick(f["revenueGrowth"])),
      grossMargin: asPercent(pick(f["grossMargins"])),
      operatingMargin: asPercent(pick(f["operatingMargins"])),
      netMargin: asPercent(pick(f["profitMargins"])),
      roe: asPercent(pick(f["returnOnEquity"])),
      roa: asPercent(pick(f["returnOnAssets"])),
      // Yahoo already reports this as a percentage, unlike its other ratios.
      debtToEquity: pick(f["debtToEquity"]),
      currentRatio: pick(f["currentRatio"]),
      dividendYield: asPercent(pick(s["dividendYield"])),
      beta: pick(k["beta"]) ?? pick(s["beta"]),
      sharesOutstanding: pick(k["sharesOutstanding"]),
      asOf: null,
      provider: ID,
    };

    // Reject an empty shell so the chain can try the next provider.
    const populated = Object.values(fundamentals).filter((v) => typeof v === "number").length;
    return populated >= 3 ? fundamentals : null;
  },

  async fetchRecommendations(inst: Instrument): Promise<AnalystConsensus | null> {
    const r = await fetchSummary(inst);
    if (!r) return null;

    const f = (r.financialData ?? {}) as Record<string, Wrapped> & { recommendationKey?: string };
    const trend = r.recommendationTrend?.trend?.[0] as Record<string, unknown> | undefined;

    const strongBuy = pick(trend?.["strongBuy"] as Wrapped) ?? 0;
    const buy = pick(trend?.["buy"] as Wrapped) ?? 0;
    const hold = pick(trend?.["hold"] as Wrapped) ?? 0;
    const sell = pick(trend?.["sell"] as Wrapped) ?? 0;
    const strongSell = pick(trend?.["strongSell"] as Wrapped) ?? 0;
    const total = strongBuy + buy + hold + sell + strongSell;

    const targetMean = pick(f["targetMeanPrice"]);
    // Yahoo's own 1–5 mean, which accounts for analysts the breakdown omits.
    const meanRating = pick(f["recommendationMean"]);

    if (total === 0 && targetMean == null && meanRating == null) return null;

    const score =
      meanRating ??
      (total > 0
        ? (strongBuy * 1 + buy * 2 + hold * 3 + sell * 4 + strongSell * 5) / total
        : 3);

    return {
      symbol: inst.symbol,
      strongBuy,
      buy,
      hold,
      sell,
      strongSell,
      score,
      // Fall back to the analyst count Yahoo reports alongside its targets.
      total: total > 0 ? total : (pick(f["numberOfAnalystOpinions"]) ?? 0),
      period: pickString(trend?.["period"]),
      targetHigh: pick(f["targetHighPrice"]),
      targetLow: pick(f["targetLowPrice"]),
      targetMean,
      provider: ID,
    };
  },

  async fetchEarnings(inst: Instrument): Promise<EarningsPoint[]> {
    const r = await fetchSummary(inst);
    const history = r?.earningsHistory?.history;
    if (!Array.isArray(history)) return [];

    const points: EarningsPoint[] = [];
    for (const row of history) {
      const quarter = row["quarter"] as { raw?: number; fmt?: string } | undefined;
      const period = pickString(quarter);
      const reportedAt = pick(quarter as Wrapped);
      if (!period) continue;

      const actual = pick(row["epsActual"]);
      const estimate = pick(row["epsEstimate"]);

      points.push({
        period,
        reportedAt: reportedAt != null ? reportedAt * 1000 : null,
        epsActual: actual,
        epsEstimate: estimate,
        surprisePercent:
          asPercent(pick(row["surprisePercent"])) ??
          (actual != null && estimate != null && estimate !== 0
            ? ((actual - estimate) / Math.abs(estimate)) * 100
            : null),
        revenueActual: null,
        revenueEstimate: null,
      });
    }

    return points.sort((a, b) => (b.reportedAt ?? 0) - (a.reportedAt ?? 0)).slice(0, 8);
  },
};

/** The next scheduled earnings date, used by the calendar. */
export async function fetchNextEarningsDate(inst: Instrument): Promise<number | null> {
  try {
    const r = await fetchSummary(inst);
    const first = r?.calendarEvents?.earnings?.earningsDate?.[0];
    return first?.raw != null ? first.raw * 1000 : null;
  } catch {
    return null;
  }
}

/* ── Ownership and rating changes ─────────────────────────────────────────── */

export interface OwnershipHolder {
  name: string;
  /** Share of the company held, as a percentage. */
  percentHeld: number | null;
  shares: number | null;
  value: number | null;
  reportedAt: number | null;
}

export interface Ownership {
  /** Percentage held by insiders. */
  insiderPercent: number | null;
  /** Percentage held by institutions. */
  institutionPercent: number | null;
  institutionCount: number | null;
  topHolders: OwnershipHolder[];
}

export interface RatingChange {
  firm: string;
  from: string | null;
  to: string;
  /** "up", "down", "init", "main" — Yahoo's own wording, normalised. */
  action: "upgrade" | "downgrade" | "initiated" | "maintained" | "other";
  at: number | null;
}

/**
 * Who owns the company, and who changed their mind about it.
 *
 * Both arrive in the same payload as the fundamentals, so this costs nothing
 * beyond the parsing — the memoised fetch means calling it after
 * `fetchFundamentals` reuses the same response.
 */
export async function fetchOwnershipAndRatings(inst: Instrument): Promise<{
  ownership: Ownership | null;
  ratings: RatingChange[];
}> {
  try {
    const r = await fetchSummary(inst);
    if (!r) return { ownership: null, ratings: [] };

    const holders = r.majorHoldersBreakdown ?? {};
    const institutions = r.institutionOwnership?.ownershipList ?? [];

    const ownership: Ownership = {
      insiderPercent: asPercent(pick(holders["insidersPercentHeld"] as Wrapped)),
      institutionPercent: asPercent(pick(holders["institutionsPercentHeld"] as Wrapped)),
      institutionCount: pick(holders["institutionsCount"] as Wrapped),
      topHolders: institutions
        .map((h) => {
          const row = h as Record<string, Wrapped>;
          const name = pickString(row["organization"]);
          if (!name) return null;
          return {
            name,
            percentHeld: asPercent(pick(row["pctHeld"])),
            shares: pick(row["position"]),
            value: pick(row["value"]),
            reportedAt: (() => {
              const t = pick(row["reportDate"]);
              return t != null ? t * 1000 : null;
            })(),
          } satisfies OwnershipHolder;
        })
        .filter((h): h is OwnershipHolder => h !== null)
        .slice(0, 8),
    };

    const history = r.upgradeDowngradeHistory?.history ?? [];
    const ratings: RatingChange[] = [];
    for (const row of history.slice(0, 12)) {
      const h = row as Record<string, unknown>;
      const firm = typeof h["firm"] === "string" ? h["firm"] : null;
      const to = typeof h["toGrade"] === "string" ? h["toGrade"] : null;
      if (!firm || !to) continue;

      const raw = typeof h["action"] === "string" ? h["action"] : "";
      ratings.push({
        firm,
        from: typeof h["fromGrade"] === "string" && h["fromGrade"] ? h["fromGrade"] : null,
        to,
        action:
          raw === "up"
            ? "upgrade"
            : raw === "down"
              ? "downgrade"
              : raw === "init"
                ? "initiated"
                : raw === "main"
                  ? "maintained"
                  : "other",
        at: (() => {
          const t = pick(h["epochGradeDate"] as Wrapped);
          return t != null ? (t > 1e11 ? t : t * 1000) : null;
        })(),
      });
    }

    const hasOwnership =
      ownership.insiderPercent != null ||
      ownership.institutionPercent != null ||
      ownership.topHolders.length > 0;

    return { ownership: hasOwnership ? ownership : null, ratings };
  } catch {
    return { ownership: null, ratings: [] };
  }
}

/** Company profile text, which Finnhub only serves for US listings. */
export async function fetchCompanyProfile(inst: Instrument): Promise<{
  sector: string | null;
  industry: string | null;
  description: string | null;
  website: string | null;
  employees: number | null;
  country: string | null;
} | null> {
  try {
    const r = await fetchSummary(inst);
    const p = r?.assetProfile;
    if (!p) return null;
    return {
      sector: p.sector ?? null,
      industry: p.industry ?? null,
      description: p.longBusinessSummary ?? null,
      website: p.website ?? null,
      employees: typeof p.fullTimeEmployees === "number" ? p.fullTimeEmployees : null,
      country: p.country ?? null,
    };
  } catch {
    return null;
  }
}

export { ID as YAHOO_SUMMARY_ID };
