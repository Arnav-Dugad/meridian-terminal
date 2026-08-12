import type { ExchangeCode, Region } from "@/lib/market/exchanges";
import { EXCHANGES } from "@/lib/market/exchanges";
import type { Currency } from "@/lib/format";

/**
 * The instrument universe.
 *
 * Twelve Data can enumerate every listed symbol, but walking that endpoint on
 * demand costs credits and returns tens of thousands of rows the interface
 * will never show. Instead we ship a curated large-cap universe -- the names a
 * cross-market desk actually watches -- and use it for search, the screener,
 * the heatmap and route pre-generation. Live figures always come from the API;
 * the constants below are identity (name, sector, listing venue) plus seeds
 * for the offline simulation layer, and are never displayed as market data.
 */

export type Sector =
  | "Technology"
  | "Financials"
  | "Energy"
  | "Healthcare"
  | "Consumer"
  | "Industrials"
  | "Materials"
  | "Utilities"
  | "Communication"
  | "Real Estate"
  | "Index";

export interface Instrument {
  /** Canonical Twelve Data symbol. */
  symbol: string;
  /** Route key: `RELIANCE.NSE`, `AAPL`, `NIFTY50`. */
  slug: string;
  name: string;
  exchange: ExchangeCode;
  region: Region;
  currency: Currency;
  sector: Sector;
  /** Seed price -- simulation layer only. */
  seedPrice: number;
  /** Seed market cap in native currency -- simulation layer only. */
  seedCap: number;
  kind: "equity" | "index";
}

type Row = [symbol: string, name: string, sector: Sector, seedPrice: number, seedCapNative: number];

/* -- India / NSE ------------------------------------------------------------
   Seed caps are written as `<crore>e7` so the figure stays legible in the unit
   Indian filings actually use, while the stored value is plain rupees. */
const NSE_ROWS: Row[] = [
  ["RELIANCE", "Reliance Industries", "Energy", 1478, 20_00_000e7],
  ["TCS", "Tata Consultancy Services", "Technology", 3210, 11_60_000e7],
  ["HDFCBANK", "HDFC Bank", "Financials", 1712, 13_10_000e7],
  ["ICICIBANK", "ICICI Bank", "Financials", 1284, 9_05_000e7],
  ["INFY", "Infosys", "Technology", 1561, 6_48_000e7],
  ["BHARTIARTL", "Bharti Airtel", "Communication", 1892, 10_70_000e7],
  ["SBIN", "State Bank of India", "Financials", 812, 7_25_000e7],
  ["LICI", "Life Insurance Corporation of India", "Financials", 902, 5_70_000e7],
  ["ITC", "ITC Limited", "Consumer", 412, 5_15_000e7],
  ["HINDUNILVR", "Hindustan Unilever", "Consumer", 2340, 5_50_000e7],
  ["LT", "Larsen & Toubro", "Industrials", 3612, 4_96_000e7],
  ["BAJFINANCE", "Bajaj Finance", "Financials", 918, 5_70_000e7],
  ["HCLTECH", "HCL Technologies", "Technology", 1614, 4_38_000e7],
  ["MARUTI", "Maruti Suzuki India", "Consumer", 12_480, 3_92_000e7],
  ["SUNPHARMA", "Sun Pharmaceutical Industries", "Healthcare", 1702, 4_08_000e7],
  ["KOTAKBANK", "Kotak Mahindra Bank", "Financials", 1975, 3_92_000e7],
  ["AXISBANK", "Axis Bank", "Financials", 1108, 3_43_000e7],
  ["ADANIENT", "Adani Enterprises", "Industrials", 2418, 2_79_000e7],
  ["TITAN", "Titan Company", "Consumer", 3390, 3_01_000e7],
  ["ONGC", "Oil & Natural Gas Corporation", "Energy", 243, 3_06_000e7],
  ["NTPC", "NTPC Limited", "Utilities", 336, 3_26_000e7],
  ["ULTRACEMCO", "UltraTech Cement", "Materials", 11_420, 3_30_000e7],
  ["ASIANPAINT", "Asian Paints", "Materials", 2418, 2_32_000e7],
  ["WIPRO", "Wipro", "Technology", 246, 2_58_000e7],
  ["TATAMOTORS", "Tata Motors", "Consumer", 682, 2_51_000e7],
  ["POWERGRID", "Power Grid Corporation of India", "Utilities", 281, 2_61_000e7],
  ["M&M", "Mahindra & Mahindra", "Consumer", 3062, 3_81_000e7],
  ["ADANIPORTS", "Adani Ports & SEZ", "Industrials", 1348, 2_91_000e7],
  ["JSWSTEEL", "JSW Steel", "Materials", 1042, 2_55_000e7],
  ["TATASTEEL", "Tata Steel", "Materials", 148, 1_85_000e7],
  ["COALINDIA", "Coal India", "Energy", 386, 2_38_000e7],
  ["NESTLEIND", "Nestle India", "Consumer", 2210, 2_13_000e7],
  ["BAJAJFINSV", "Bajaj Finserv", "Financials", 1980, 3_16_000e7],
  ["GRASIM", "Grasim Industries", "Materials", 2712, 1_83_000e7],
  ["HINDALCO", "Hindalco Industries", "Materials", 646, 1_45_000e7],
  ["TECHM", "Tech Mahindra", "Technology", 1524, 1_49_000e7],
  ["INDUSINDBK", "IndusInd Bank", "Financials", 762, 59_400e7],
  ["DRREDDY", "Dr. Reddy's Laboratories", "Healthcare", 1218, 1_01_000e7],
  ["CIPLA", "Cipla", "Healthcare", 1486, 1_20_000e7],
  ["BPCL", "Bharat Petroleum Corporation", "Energy", 312, 1_35_000e7],
  ["SBILIFE", "SBI Life Insurance", "Financials", 1802, 1_80_000e7],
  ["HDFCLIFE", "HDFC Life Insurance", "Financials", 742, 1_59_000e7],
  ["BRITANNIA", "Britannia Industries", "Consumer", 5480, 1_32_000e7],
  ["EICHERMOT", "Eicher Motors", "Consumer", 5320, 1_45_000e7],
  ["APOLLOHOSP", "Apollo Hospitals Enterprise", "Healthcare", 7180, 1_03_000e7],
  ["TATACONSUM", "Tata Consumer Products", "Consumer", 1078, 1_06_000e7],
  ["HEROMOTOCO", "Hero MotoCorp", "Consumer", 4290, 85_800e7],
  ["SHRIRAMFIN", "Shriram Finance", "Financials", 618, 1_16_000e7],
  ["BAJAJ-AUTO", "Bajaj Auto", "Consumer", 8420, 2_35_000e7],
  ["DMART", "Avenue Supermarts", "Consumer", 4180, 2_72_000e7],
  ["ZOMATO", "Eternal (Zomato)", "Consumer", 264, 2_54_000e7],
  ["DLF", "DLF Limited", "Real Estate", 762, 1_88_000e7],
  ["PIDILITIND", "Pidilite Industries", "Materials", 2910, 1_48_000e7],
  ["HAVELLS", "Havells India", "Industrials", 1562, 97_900e7],
  ["SIEMENS", "Siemens India", "Industrials", 3120, 1_11_000e7],
  ["VEDL", "Vedanta Limited", "Materials", 452, 1_76_000e7],
  ["GAIL", "GAIL (India)", "Utilities", 186, 1_22_000e7],
  ["IRCTC", "Indian Railway Catering & Tourism", "Consumer", 742, 59_400e7],
  ["PIIND", "PI Industries", "Materials", 3620, 54_900e7],
  ["TRENT", "Trent Limited", "Consumer", 5420, 1_92_000e7],
];

/* -- United States / Nasdaq ------------------------------------------------ */
const NASDAQ_ROWS: Row[] = [
  ["AAPL", "Apple Inc.", "Technology", 232, 3.52e12],
  ["MSFT", "Microsoft Corporation", "Technology", 428, 3.18e12],
  ["NVDA", "NVIDIA Corporation", "Technology", 178, 4.34e12],
  ["GOOGL", "Alphabet Inc. Class A", "Communication", 196, 2.38e12],
  ["AMZN", "Amazon.com Inc.", "Consumer", 224, 2.36e12],
  ["META", "Meta Platforms Inc.", "Communication", 612, 1.55e12],
  ["AVGO", "Broadcom Inc.", "Technology", 268, 1.26e12],
  ["TSLA", "Tesla Inc.", "Consumer", 342, 1.09e12],
  ["COST", "Costco Wholesale Corporation", "Consumer", 918, 4.07e11],
  ["NFLX", "Netflix Inc.", "Communication", 892, 3.81e11],
  ["AMD", "Advanced Micro Devices", "Technology", 162, 2.62e11],
  ["PEP", "PepsiCo Inc.", "Consumer", 152, 2.09e11],
  ["ADBE", "Adobe Inc.", "Technology", 372, 1.58e11],
  ["CSCO", "Cisco Systems", "Technology", 68, 2.71e11],
  ["INTC", "Intel Corporation", "Technology", 24, 1.04e11],
  ["INTU", "Intuit Inc.", "Technology", 642, 1.79e11],
  ["QCOM", "QUALCOMM Incorporated", "Technology", 168, 1.85e11],
  ["TXN", "Texas Instruments", "Technology", 192, 1.75e11],
  ["AMGN", "Amgen Inc.", "Healthcare", 286, 1.54e11],
  ["AMAT", "Applied Materials", "Technology", 178, 1.45e11],
  ["BKNG", "Booking Holdings", "Consumer", 5120, 1.71e11],
  ["MU", "Micron Technology", "Technology", 108, 1.20e11],
  ["PLTR", "Palantir Technologies", "Technology", 78, 1.78e11],
  ["MRVL", "Marvell Technology", "Technology", 92, 7.96e10],
  ["ISRG", "Intuitive Surgical", "Healthcare", 512, 1.82e11],
  ["LRCX", "Lam Research", "Technology", 82, 1.04e11],
  ["ADI", "Analog Devices", "Technology", 224, 1.11e11],
  ["PANW", "Palo Alto Networks", "Technology", 186, 1.22e11],
  ["SBUX", "Starbucks Corporation", "Consumer", 98, 1.11e11],
  ["MDLZ", "Mondelez International", "Consumer", 64, 8.42e10],
];

/* -- United States / NYSE -------------------------------------------------- */
const NYSE_ROWS: Row[] = [
  ["BRK.B", "Berkshire Hathaway Class B", "Financials", 482, 1.04e12],
  ["LLY", "Eli Lilly and Company", "Healthcare", 812, 7.71e11],
  ["JPM", "JPMorgan Chase & Co.", "Financials", 268, 7.48e11],
  ["V", "Visa Inc.", "Financials", 342, 6.62e11],
  ["XOM", "Exxon Mobil Corporation", "Energy", 118, 5.12e11],
  ["UNH", "UnitedHealth Group", "Healthcare", 328, 2.97e11],
  ["MA", "Mastercard Incorporated", "Financials", 542, 4.94e11],
  ["PG", "Procter & Gamble", "Consumer", 158, 3.72e11],
  ["JNJ", "Johnson & Johnson", "Healthcare", 178, 4.28e11],
  ["HD", "The Home Depot", "Consumer", 372, 3.70e11],
  ["ORCL", "Oracle Corporation", "Technology", 218, 6.12e11],
  ["ABBV", "AbbVie Inc.", "Healthcare", 208, 3.68e11],
  ["MRK", "Merck & Co.", "Healthcare", 86, 2.16e11],
  ["CVX", "Chevron Corporation", "Energy", 152, 3.07e11],
  ["KO", "The Coca-Cola Company", "Consumer", 68, 2.93e11],
  ["CRM", "Salesforce Inc.", "Technology", 258, 2.47e11],
  ["WMT", "Walmart Inc.", "Consumer", 98, 7.82e11],
  ["BAC", "Bank of America Corporation", "Financials", 48, 3.62e11],
  ["TMO", "Thermo Fisher Scientific", "Healthcare", 512, 1.93e11],
  ["MCD", "McDonald's Corporation", "Consumer", 302, 2.16e11],
  ["ACN", "Accenture plc", "Technology", 318, 1.98e11],
  ["LIN", "Linde plc", "Materials", 462, 2.20e11],
  ["ABT", "Abbott Laboratories", "Healthcare", 128, 2.22e11],
  ["DIS", "The Walt Disney Company", "Communication", 112, 2.02e11],
  ["VZ", "Verizon Communications", "Communication", 42, 1.77e11],
  ["IBM", "International Business Machines", "Technology", 288, 2.67e11],
  ["NOW", "ServiceNow Inc.", "Technology", 892, 1.84e11],
  ["CAT", "Caterpillar Inc.", "Industrials", 412, 1.96e11],
  ["GE", "GE Aerospace", "Industrials", 268, 2.86e11],
  ["SPGI", "S&P Global Inc.", "Financials", 492, 1.50e11],
  ["UBER", "Uber Technologies", "Industrials", 82, 1.72e11],
  ["PFE", "Pfizer Inc.", "Healthcare", 25, 1.42e11],
  ["RTX", "RTX Corporation", "Industrials", 148, 1.97e11],
  ["BA", "The Boeing Company", "Industrials", 212, 1.60e11],
  ["GS", "The Goldman Sachs Group", "Financials", 712, 2.18e11],
  ["SHOP", "Shopify Inc.", "Technology", 118, 1.52e11],
  ["COIN", "Coinbase Global", "Financials", 288, 7.31e10],
  ["NKE", "NIKE Inc.", "Consumer", 72, 1.06e11],
  ["PLD", "Prologis Inc.", "Real Estate", 108, 1.00e11],
  ["NEE", "NextEra Energy", "Utilities", 72, 1.48e11],
];

/* -- Indices --------------------------------------------------------------- */
interface IndexRow {
  symbol: string;
  slug: string;
  name: string;
  exchange: ExchangeCode;
  seedPrice: number;
}

const INDEX_ROWS: IndexRow[] = [
  { symbol: "NIFTY 50", slug: "NIFTY50", name: "NIFTY 50", exchange: "NSE", seedPrice: 24_820 },
  { symbol: "NIFTY BANK", slug: "NIFTYBANK", name: "NIFTY Bank", exchange: "NSE", seedPrice: 53_120 },
  { symbol: "SENSEX", slug: "SENSEX", name: "BSE SENSEX", exchange: "BSE", seedPrice: 81_240 },
  { symbol: "SPX", slug: "SPX", name: "S&P 500", exchange: "NYSE", seedPrice: 6_412 },
  { symbol: "IXIC", slug: "IXIC", name: "Nasdaq Composite", exchange: "NASDAQ", seedPrice: 21_180 },
  { symbol: "DJI", slug: "DJI", name: "Dow Jones Industrial Average", exchange: "NYSE", seedPrice: 44_620 },
];

function build(rows: Row[], exchange: ExchangeCode): Instrument[] {
  const meta = EXCHANGES[exchange];
  return rows.map(([symbol, name, sector, seedPrice, seedCap]) => ({
    symbol,
    // Indian tickers collide with US ones (e.g. LT), so they carry the venue.
    slug: meta.region === "IN" ? `${symbol}.${exchange}` : symbol,
    name,
    exchange,
    region: meta.region,
    currency: meta.currency,
    sector,
    seedPrice,
    seedCap,
    kind: "equity" as const,
  }));
}

export const INDICES: Instrument[] = INDEX_ROWS.map((r) => {
  const meta = EXCHANGES[r.exchange];
  return {
    symbol: r.symbol,
    slug: r.slug,
    name: r.name,
    exchange: r.exchange,
    region: meta.region,
    currency: meta.currency,
    sector: "Index" as const,
    seedPrice: r.seedPrice,
    seedCap: 0,
    kind: "index" as const,
  };
});

export const EQUITIES: Instrument[] = [
  ...build(NSE_ROWS, "NSE"),
  ...build(NASDAQ_ROWS, "NASDAQ"),
  ...build(NYSE_ROWS, "NYSE"),
];

export const UNIVERSE: Instrument[] = [...INDICES, ...EQUITIES];

const BY_SLUG = new Map<string, Instrument>();
const BY_SYMBOL = new Map<string, Instrument>();
for (const i of UNIVERSE) {
  BY_SLUG.set(i.slug.toUpperCase(), i);
  if (!BY_SYMBOL.has(i.symbol.toUpperCase())) BY_SYMBOL.set(i.symbol.toUpperCase(), i);
}

/** Resolve a route slug (`RELIANCE.NSE`, `AAPL`, `NIFTY50`) to an instrument. */
export function findBySlug(slug: string): Instrument | undefined {
  const key = decodeURIComponent(slug).toUpperCase();
  const bare = key.split(".")[0] ?? "";
  return BY_SLUG.get(key) ?? BY_SYMBOL.get(key) ?? BY_SYMBOL.get(bare);
}

export function findBySymbol(symbol: string, exchange?: ExchangeCode): Instrument | undefined {
  const key = symbol.toUpperCase();
  if (exchange) {
    const exact = UNIVERSE.find((i) => i.symbol.toUpperCase() === key && i.exchange === exchange);
    if (exact) return exact;
  }
  return BY_SYMBOL.get(key);
}

export const SECTORS: Sector[] = [
  "Technology",
  "Financials",
  "Consumer",
  "Healthcare",
  "Energy",
  "Industrials",
  "Materials",
  "Communication",
  "Utilities",
  "Real Estate",
];

export const SECTOR_HUE: Record<Sector, string> = {
  Technology: "#7ba7f0",
  Financials: "#3fbf7f",
  Consumer: "#f0a63c",
  Healthcare: "#d67ef0",
  Energy: "#f0563f",
  Industrials: "#8f9bb3",
  Materials: "#c9a227",
  Communication: "#4fd1c5",
  Utilities: "#6b8f71",
  "Real Estate": "#e08a5f",
  Index: "#f4f2ec",
};

/** Instrument pages worth pre-rendering at build time. */
export const FEATURED_SLUGS: string[] = [
  "NIFTY50", "SENSEX", "SPX", "IXIC",
  "RELIANCE.NSE", "TCS.NSE", "HDFCBANK.NSE", "INFY.NSE", "ICICIBANK.NSE",
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "TSLA", "META",
];

/** The tape shown to signed-out visitors and brand-new accounts. */
export const DEFAULT_WATCHLIST: string[] = [
  "RELIANCE.NSE", "TCS.NSE", "HDFCBANK.NSE", "INFY.NSE", "TATAMOTORS.NSE",
  "AAPL", "NVDA", "MSFT", "TSLA", "AMZN",
];

export function instrumentsByRegion(region: Region): Instrument[] {
  return EQUITIES.filter((i) => i.region === region);
}

export function indicesByRegion(region: Region): Instrument[] {
  return INDICES.filter((i) => i.region === region);
}

/**
 * Ranked search over ticker and company name, with a subsequence fallback so
 * `hdfcb` still finds HDFCBANK and `brk` finds BRK.B.
 */
export function searchUniverse(query: string, limit = 12): Instrument[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { inst: Instrument; score: number }[] = [];

  for (const inst of UNIVERSE) {
    const sym = inst.symbol.toLowerCase();
    const name = inst.name.toLowerCase();
    let score = -1;

    if (sym === q) score = 1000;
    else if (sym.startsWith(q)) score = 800 - sym.length;
    else if (name.startsWith(q)) score = 600 - name.length * 0.4;
    else if (sym.includes(q)) score = 400 - sym.indexOf(q) * 8;
    else if (name.includes(q)) score = 300 - name.indexOf(q) * 3;
    else {
      let si = 0;
      for (let ci = 0; ci < sym.length && si < q.length; ci++) {
        if (sym[ci] === q[si]) si++;
      }
      if (si === q.length) score = 120 - sym.length;
    }

    if (score > 0) {
      if (inst.kind === "index") score += 60;
      scored.push({ inst, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.inst.symbol.localeCompare(b.inst.symbol));
  return scored.slice(0, limit).map((s) => s.inst);
}
