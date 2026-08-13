import "server-only";

import { num, str } from "@/lib/providers/http";
import { registerLimiter, acquire } from "@/lib/providers/limiter";
import { ProviderError } from "@/lib/providers/types";

/**
 * National Stock Exchange of India — public endpoints.
 *
 * NSE publishes daily institutional flow figures that no commercial data API
 * in the free tier carries, and which are the single most-watched number on
 * an Indian trading desk: how much foreign and domestic institutions bought
 * and sold, in crore, each session.
 *
 * ── Why this needs its own client ─────────────────────────────────────────
 * NSE sits behind Akamai bot protection. A cold request to any /api/ path
 * returns an HTML "Resource not found" page regardless of headers. The site
 * issues its session cookies on a normal page load, so the client performs a
 * handshake — fetch a real page, keep the cookies, then call the API with them
 * and a matching Referer. Cookies are cached in-process and refreshed when
 * they stop working.
 *
 * The option chain is *also* behind this, but its endpoint additionally
 * requires a token minted by client-side JavaScript, which a server cannot
 * reproduce. Flow data does not, which is why this module covers flows and
 * not chains.
 */

const ID = "nse";
const BASE = "https://www.nseindia.com";

registerLimiter(ID, { perMinute: 10 });

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
};

/** Session cookies, cached until they stop working. */
let cookieJar: string | null = null;
let cookieFetchedAt = 0;
const COOKIE_TTL_MS = 8 * 60 * 1000;

async function refreshCookies(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/`, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });

    // `getSetCookie` returns every Set-Cookie header separately; a plain
    // `get` would collapse them into one comma-joined string and corrupt
    // cookie values that legitimately contain commas.
    const raw = res.headers.getSetCookie?.() ?? [];
    if (raw.length === 0) return null;

    cookieJar = raw.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
    cookieFetchedAt = Date.now();
    return cookieJar;
  } catch {
    return null;
  }
}

async function nseFetch<T>(path: string, referer: string): Promise<T> {
  await acquire(ID, 1, 1200);

  if (!cookieJar || Date.now() - cookieFetchedAt > COOKIE_TTL_MS) {
    await refreshCookies();
  }

  const attempt = async (): Promise<T> => {
    const res = await fetch(`${BASE}${path}`, {
      headers: {
        ...BROWSER_HEADERS,
        Referer: referer,
        ...(cookieJar ? { Cookie: cookieJar } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new ProviderError(ID, `HTTP ${res.status}`, res.status, true);

    // Akamai answers a blocked request with 200 and an HTML body, so the
    // content type is the only reliable signal that this actually worked.
    const text = await res.text();
    if (text.trimStart().startsWith("<")) {
      throw new ProviderError(ID, "blocked by bot protection", 403, true);
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ProviderError(ID, "malformed response", 502, true);
    }
  };

  try {
    return await attempt();
  } catch (err) {
    // One retry with fresh cookies — an expired session is the single most
    // common failure and is fixed by re-handshaking.
    if (err instanceof ProviderError && (err.status === 403 || err.status === 401)) {
      cookieJar = null;
      await refreshCookies();
      return attempt();
    }
    throw err;
  }
}

/* ── Institutional flows ──────────────────────────────────────────────────── */

export interface FlowDay {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  /** Original NSE label, e.g. `12-Aug-2026`. */
  label: string;
  /** Foreign institutional investors, in crore. */
  fii: { buy: number; sell: number; net: number };
  /** Domestic institutional investors, in crore. */
  dii: { buy: number; sell: number; net: number };
}

interface RawFlowRow {
  category?: string;
  date?: string;
  buyValue?: string;
  sellValue?: string;
  netValue?: string;
}

/**
 * Today's (or the most recent session's) FII and DII activity.
 *
 * NSE returns two rows — one per category — for a single date. The shape is
 * flattened into one record per day so the UI can treat it as a time series
 * once several days have accumulated.
 */
export async function fetchInstitutionalFlows(): Promise<FlowDay | null> {
  const rows = await nseFetch<RawFlowRow[]>("/api/fiidiiTradeReact", `${BASE}/reports/fii-dii`);
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const pick = (needle: string) =>
    rows.find((r) => (r.category ?? "").toUpperCase().includes(needle));

  const fiiRow = pick("FII") ?? pick("FPI");
  const diiRow = pick("DII");
  if (!fiiRow && !diiRow) return null;

  const label = str(fiiRow?.date) ?? str(diiRow?.date) ?? "";
  const side = (r: RawFlowRow | undefined) => ({
    buy: num(r?.buyValue) ?? 0,
    sell: num(r?.sellValue) ?? 0,
    net: num(r?.netValue) ?? 0,
  });

  return {
    date: toIsoDate(label),
    label,
    fii: side(fiiRow),
    dii: side(diiRow),
  };
}

/* ── Corporate actions ────────────────────────────────────────────────────── */

export type CorporateActionKind =
  | "dividend"
  | "split"
  | "bonus"
  | "rights"
  | "buyback"
  | "meeting"
  | "other";

export interface CorporateAction {
  symbol: string;
  slug: string | null;
  company: string;
  /** The purpose string exactly as the exchange published it. */
  subject: string;
  kind: CorporateActionKind;
  /** Parsed rupee amount for dividends, or the ratio for splits and bonuses. */
  value: number | null;
  ratio: string | null;
  /** ISO date the stock trades without the entitlement. */
  exDate: string;
  recordDate: string | null;
  series: string;
  faceValue: number | null;
}

interface RawAction {
  symbol?: string;
  comp?: string;
  subject?: string;
  exDate?: string;
  recDate?: string;
  series?: string;
  faceVal?: string;
}

/**
 * Dividends, splits, bonuses and buybacks across the whole exchange.
 *
 * This is the corporate-actions feed almost nothing consumer-facing surfaces,
 * and it matters because an ex-dividend date looks exactly like a sudden drop
 * on a chart if you do not know it is coming.
 *
 * The exchange publishes the purpose as free text — "Dividend - Rs 3.75 Per
 * Share", "Face Value Split From Rs 10 To Re 1" — so the type and the numbers
 * are parsed out of it here rather than being available as fields.
 */
export async function fetchCorporateActions(): Promise<CorporateAction[]> {
  const rows = await nseFetch<RawAction[]>(
    "/api/corporates-corporateActions?index=equities",
    `${BASE}/companies-listing/corporate-filings-actions`,
  );
  if (!Array.isArray(rows)) return [];

  const out: CorporateAction[] = [];
  for (const row of rows) {
    const symbol = str(row.symbol);
    const subject = str(row.subject);
    const exDate = str(row.exDate);
    if (!symbol || !subject || !exDate) continue;

    const { kind, value, ratio } = classify(subject);

    out.push({
      symbol,
      slug: null, // Resolved against the universe by the route.
      company: str(row.comp) ?? symbol,
      subject,
      kind,
      value,
      ratio,
      exDate: toIsoDate(exDate),
      recordDate: str(row.recDate) && row.recDate !== "-" ? toIsoDate(row.recDate!) : null,
      series: str(row.series) ?? "EQ",
      faceValue: num(row.faceVal),
    });
  }

  return out.sort((a, b) => a.exDate.localeCompare(b.exDate));
}

/**
 * Read the exchange's free-text purpose.
 *
 * Order matters: "Bonus" is checked before "Dividend" because a combined
 * announcement mentions both, and the bonus is the more consequential event
 * for a chart.
 */
function classify(subject: string): {
  kind: CorporateActionKind;
  value: number | null;
  ratio: string | null;
} {
  const s = subject.toLowerCase();

  if (s.includes("bonus")) {
    const m = subject.match(/(\d+)\s*:\s*(\d+)/);
    return { kind: "bonus", value: null, ratio: m ? `${m[1]}:${m[2]}` : null };
  }
  if (s.includes("split") || s.includes("sub-division") || s.includes("subdivision")) {
    // "From Rs 10 To Re 1" is the common phrasing; the ratio is the quotient.
    const m = subject.match(/from\s*(?:rs\.?|re\.?)?\s*(\d+(?:\.\d+)?)\s*to\s*(?:rs\.?|re\.?)?\s*(\d+(?:\.\d+)?)/i);
    const from = m ? Number(m[1]) : null;
    const to = m ? Number(m[2]) : null;
    return {
      kind: "split",
      value: null,
      ratio: from && to && to > 0 ? `${(from / to).toFixed(0)}:1` : null,
    };
  }
  if (s.includes("buy back") || s.includes("buyback")) {
    return { kind: "buyback", value: null, ratio: null };
  }
  if (s.includes("rights")) {
    const m = subject.match(/(\d+)\s*:\s*(\d+)/);
    return { kind: "rights", value: null, ratio: m ? `${m[1]}:${m[2]}` : null };
  }
  if (s.includes("dividend")) {
    const m = subject.match(/(?:rs\.?|inr)\s*(\d+(?:\.\d+)?)/i);
    return { kind: "dividend", value: m ? Number(m[1]) : null, ratio: null };
  }
  if (s.includes("meeting") || s.includes("agm") || s.includes("egm")) {
    return { kind: "meeting", value: null, ratio: null };
  }
  return { kind: "other", value: null, ratio: null };
}

/* ── Bulk and block deals ─────────────────────────────────────────────────── */

export type DealKind = "bulk" | "block" | "short";

export interface LargeDeal {
  kind: DealKind;
  symbol: string;
  slug: string | null;
  name: string;
  /** The institution or individual on the other side. */
  client: string;
  side: "BUY" | "SELL" | null;
  quantity: number;
  /** Weighted average traded price. */
  price: number | null;
  /** Quantity times price, in rupees. */
  value: number | null;
  date: string;
}

interface RawDeal {
  symbol?: string;
  name?: string;
  clientName?: string;
  buySell?: string | null;
  qty?: string;
  watp?: string | null;
  date?: string;
}

/**
 * Who took a large position in what, yesterday.
 *
 * A bulk deal is any trade above 0.5% of a company's shares; a block deal is a
 * negotiated trade above a size threshold, done in a separate window. Both are
 * disclosed by name, which makes this one of the few places you can see a
 * specific fund building or exiting a specific position.
 *
 * Uses the snapshot endpoint rather than the historical one — the historical
 * range query is rejected outright, while the snapshot returns the full latest
 * session for all three categories in one call.
 */
export async function fetchLargeDeals(): Promise<{ asOf: string; deals: LargeDeal[] }> {
  const payload = await nseFetch<Record<string, unknown>>(
    "/api/snapshot-capital-market-largedeal",
    `${BASE}/report-detail/display-bulk-and-block-deals`,
  );

  const asOf = str(payload["as_on_date"]) ?? "";
  const buckets: [string, DealKind][] = [
    ["BULK_DEALS_DATA", "bulk"],
    ["BLOCK_DEALS_DATA", "block"],
    ["SHORT_DEALS_DATA", "short"],
  ];

  const deals: LargeDeal[] = [];

  for (const [key, kind] of buckets) {
    const rows = payload[key];
    if (!Array.isArray(rows)) continue;

    for (const raw of rows as RawDeal[]) {
      const symbol = str(raw.symbol);
      const quantity = num(raw.qty);
      if (!symbol || quantity == null) continue;

      const price = num(raw.watp);
      const side = str(raw.buySell)?.toUpperCase();

      deals.push({
        kind,
        symbol,
        slug: null, // Resolved against the universe by the route.
        name: str(raw.name) ?? symbol,
        client: str(raw.clientName) ?? "Not disclosed",
        side: side === "BUY" || side === "SELL" ? side : null,
        quantity,
        price,
        value: price != null ? quantity * price : null,
        date: str(raw.date) ? toIsoDate(raw.date!) : "",
      });
    }
  }

  // Largest first — the whole point is to see the consequential ones.
  deals.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return { asOf, deals };
}

/** `12-Aug-2026` to `2026-08-12`. */
function toIsoDate(label: string): string {
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const m = label.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return new Date().toISOString().slice(0, 10);
  const month = months[(m[2] ?? "").toLowerCase()] ?? "01";
  return `${m[3]}-${month}-${(m[1] ?? "1").padStart(2, "0")}`;
}

export { ID as NSE_ID };
