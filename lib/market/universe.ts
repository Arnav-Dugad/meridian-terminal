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
  | "Index"
  | "Crypto"
  | "Fund";

export interface Instrument {
  /** Provider-facing ticker. */
  symbol: string;
  /** Route key: `RELIANCE.NSE`, `AAPL`, `NIFTY50`, `BTC`. */
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
  kind: "equity" | "index" | "crypto" | "fund";
  /**
   * CoinGecko's own id. Required for crypto because CoinGecko keys on a slug
   * ("bitcoin"), not a ticker -- and tickers collide across chains in a way
   * that ids do not.
   */
  coinId?: string;
  /** For funds: what the thing actually holds, in one line. */
  mandate?: string;
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

/* -- Funds and ETFs ---------------------------------------------------------
   The instruments people actually hold for broad exposure, which a terminal
   that only lists single stocks quietly pretends do not exist. Three groups:
   globally-diversified UCITS funds on London and Amsterdam (the standard way
   to own the world from outside the US), the large US index funds, and the
   Indian index and gold funds listed on the NSE.

   Currency is declared per row because many London lines are denominated in
   dollars rather than sterling. */
interface FundRow {
  symbol: string;
  name: string;
  exchange: ExchangeCode;
  currency: Currency;
  seedPrice: number;
  seedCap: number;
  /** What the fund actually holds, in one line. */
  mandate: string;
}

const FUND_ROWS: FundRow[] = [
  // Global, UCITS, accumulating — the core holdings for a non-US investor.
  { symbol: "VWRA", name: "Vanguard FTSE All-World (Acc)", exchange: "LSE", currency: "USD", seedPrice: 158, seedCap: 4.1e9, mandate: "Every investable listed company on earth, ~3,600 holdings" },
  { symbol: "VWRP", name: "Vanguard FTSE All-World (Acc, GBP)", exchange: "LSE", currency: "GBP", seedPrice: 145, seedCap: 2.4e9, mandate: "The same all-world index, sterling line" },
  { symbol: "VUAA", name: "Vanguard S&P 500 (Acc)", exchange: "LSE", currency: "USD", seedPrice: 118, seedCap: 1.2e10, mandate: "The S&P 500, accumulating rather than distributing" },
  { symbol: "EIMI", name: "iShares Core MSCI EM IMI", exchange: "LSE", currency: "USD", seedPrice: 38, seedCap: 2.2e10, mandate: "Emerging markets including India, ~3,000 holdings" },
  { symbol: "IWDA", name: "iShares Core MSCI World", exchange: "AMS", currency: "EUR", seedPrice: 130, seedCap: 8.4e10, mandate: "Developed markets only, no emerging exposure" },
  { symbol: "AGGU", name: "iShares Core Global Aggregate Bond", exchange: "LSE", currency: "USD", seedPrice: 5.1, seedCap: 6.8e9, mandate: "Investment-grade bonds worldwide, currency hedged" },

  // United States.
  { symbol: "SPY", name: "SPDR S&P 500 ETF Trust", exchange: "NYSE", currency: "USD", seedPrice: 642, seedCap: 6.2e11, mandate: "The original S&P 500 fund, deepest options market" },
  { symbol: "QQQ", name: "Invesco QQQ Trust", exchange: "NASDAQ", currency: "USD", seedPrice: 568, seedCap: 3.4e11, mandate: "The largest 100 non-financial Nasdaq listings" },
  { symbol: "VOO", name: "Vanguard S&P 500 ETF", exchange: "NYSE", currency: "USD", seedPrice: 588, seedCap: 6.4e11, mandate: "The S&P 500 at the lowest common fee" },
  { symbol: "VTI", name: "Vanguard Total Stock Market", exchange: "NYSE", currency: "USD", seedPrice: 318, seedCap: 4.9e11, mandate: "Every US listed company, not just the large ones" },
  { symbol: "GLD", name: "SPDR Gold Shares", exchange: "NYSE", currency: "USD", seedPrice: 248, seedCap: 8.1e10, mandate: "Physical gold held in a London vault" },
  { symbol: "TLT", name: "iShares 20+ Year Treasury Bond", exchange: "NASDAQ", currency: "USD", seedPrice: 88, seedCap: 4.8e10, mandate: "Long-dated US government bonds — the duration trade" },
  { symbol: "IEMG", name: "iShares Core MSCI Emerging Markets", exchange: "NYSE", currency: "USD", seedPrice: 62, seedCap: 9.2e10, mandate: "Emerging markets, US-listed equivalent of EIMI" },
  { symbol: "INDA", name: "iShares MSCI India ETF", exchange: "NASDAQ", currency: "USD", seedPrice: 54, seedCap: 8.4e9, mandate: "Indian large and mid caps, in dollars" },

  // India.
  { symbol: "NIFTYBEES", name: "Nippon India ETF Nifty 50 BeES", exchange: "NSE", currency: "INR", seedPrice: 272, seedCap: 4_800e7, mandate: "The Nifty 50, India's oldest ETF" },
  { symbol: "GOLDBEES", name: "Nippon India ETF Gold BeES", exchange: "NSE", currency: "INR", seedPrice: 82, seedCap: 2_900e7, mandate: "Physical gold, held domestically" },
  { symbol: "BANKBEES", name: "Nippon India ETF Nifty Bank BeES", exchange: "NSE", currency: "INR", seedPrice: 578, seedCap: 1_100e7, mandate: "The Nifty Bank index" },
  { symbol: "JUNIORBEES", name: "Nippon India ETF Nifty Next 50", exchange: "NSE", currency: "INR", seedPrice: 742, seedCap: 1_400e7, mandate: "The fifty companies behind the Nifty 50" },
  { symbol: "MON100", name: "Motilal Oswal Nasdaq 100 ETF", exchange: "NSE", currency: "INR", seedPrice: 148, seedCap: 4_600e7, mandate: "The Nasdaq 100, bought in rupees from India" },
];

/* -- Digital assets -------------------------------------------------------- */
interface CryptoRow {
  symbol: string;
  coinId: string;
  name: string;
  seedPrice: number;
  seedCap: number;
}

const CRYPTO_ROWS: CryptoRow[] = [
  { symbol: "BTC", coinId: "bitcoin", name: "Bitcoin", seedPrice: 96_400, seedCap: 1.91e12 },
  { symbol: "ETH", coinId: "ethereum", name: "Ethereum", seedPrice: 3_280, seedCap: 3.95e11 },
  { symbol: "SOL", coinId: "solana", name: "Solana", seedPrice: 184, seedCap: 8.86e10 },
  { symbol: "BNB", coinId: "binancecoin", name: "BNB", seedPrice: 672, seedCap: 9.71e10 },
  { symbol: "XRP", coinId: "ripple", name: "XRP", seedPrice: 2.28, seedCap: 1.31e11 },
  { symbol: "ADA", coinId: "cardano", name: "Cardano", seedPrice: 0.86, seedCap: 3.06e10 },
  { symbol: "DOGE", coinId: "dogecoin", name: "Dogecoin", seedPrice: 0.31, seedCap: 4.58e10 },
  { symbol: "AVAX", coinId: "avalanche-2", name: "Avalanche", seedPrice: 36.4, seedCap: 1.49e10 },
  { symbol: "LINK", coinId: "chainlink", name: "Chainlink", seedPrice: 21.8, seedCap: 1.37e10 },
  { symbol: "DOT", coinId: "polkadot", name: "Polkadot", seedPrice: 6.42, seedCap: 9.4e9 },
  { symbol: "MATIC", coinId: "matic-network", name: "Polygon", seedPrice: 0.48, seedCap: 4.6e9 },
  { symbol: "LTC", coinId: "litecoin", name: "Litecoin", seedPrice: 104, seedCap: 7.9e9 },
  { symbol: "TRX", coinId: "tron", name: "TRON", seedPrice: 0.24, seedCap: 2.07e10 },
  { symbol: "ATOM", coinId: "cosmos", name: "Cosmos", seedPrice: 6.9, seedCap: 2.7e9 },
  { symbol: "UNI", coinId: "uniswap", name: "Uniswap", seedPrice: 13.2, seedCap: 7.9e9 },
  { symbol: "NEAR", coinId: "near", name: "NEAR Protocol", seedPrice: 5.1, seedCap: 6.1e9 },
  { symbol: "APT", coinId: "aptos", name: "Aptos", seedPrice: 9.4, seedCap: 5.8e9 },
  { symbol: "ARB", coinId: "arbitrum", name: "Arbitrum", seedPrice: 0.79, seedCap: 3.4e9 },
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

export const FUNDS: Instrument[] = FUND_ROWS.map((r) => ({
  symbol: r.symbol,
  // Indian and European lines are venue-qualified because their tickers can
  // collide with US ones; US funds keep the bare ticker.
  slug: r.exchange === "NSE" || r.exchange === "LSE" || r.exchange === "AMS"
    ? `${r.symbol}.${r.exchange}`
    : r.symbol,
  name: r.name,
  exchange: r.exchange,
  region: EXCHANGES[r.exchange].region,
  currency: r.currency,
  sector: "Fund" as const,
  seedPrice: r.seedPrice,
  seedCap: r.seedCap,
  kind: "fund" as const,
  mandate: r.mandate,
}));

export const CRYPTO: Instrument[] = CRYPTO_ROWS.map((r) => ({
  symbol: r.symbol,
  slug: r.symbol,
  name: r.name,
  exchange: "CRYPTO" as const,
  region: "GLOBAL" as const,
  currency: "USD" as const,
  sector: "Crypto" as const,
  seedPrice: r.seedPrice,
  seedCap: r.seedCap,
  kind: "crypto" as const,
  coinId: r.coinId,
}));

export const UNIVERSE: Instrument[] = [...INDICES, ...EQUITIES, ...FUNDS, ...CRYPTO];

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
  Crypto: "#4fd1c5",
  Fund: "#b48ef0",
};

/** Instrument pages worth pre-rendering at build time. */
export const FEATURED_SLUGS: string[] = [
  "NIFTY50", "SENSEX", "SPX", "IXIC",
  "RELIANCE.NSE", "TCS.NSE", "HDFCBANK.NSE", "INFY.NSE", "ICICIBANK.NSE",
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "TSLA", "META",
  "BTC", "ETH", "SOL",
];

/** The tape shown to signed-out visitors and brand-new accounts. */
export const DEFAULT_WATCHLIST: string[] = [
  "RELIANCE.NSE", "TCS.NSE", "HDFCBANK.NSE", "INFY.NSE", "TATAMOTORS.NSE",
  "AAPL", "NVDA", "MSFT", "TSLA", "AMZN",
  "BTC", "ETH",
];

/**
 * Equities only. Crypto lives in its own region and is excluded deliberately —
 * a 24/7 asset class has no place in an advance-decline line computed against
 * a session that opens and closes.
 */
export function instrumentsByRegion(region: Region): Instrument[] {
  if (region === "GLOBAL") return CRYPTO;
  // Europe is funds-only in this universe — there are no single European
  // equities here, and pretending otherwise would give an empty table.
  if (region === "EU") return FUNDS.filter((i) => i.region === "EU");
  return EQUITIES.filter((i) => i.region === region);
}

/** Every fund, for the dedicated funds surface. */
export function fundsByRegion(region?: Region): Instrument[] {
  return region ? FUNDS.filter((i) => i.region === region) : FUNDS;
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
      // Indices and the major coins float above equities on ties: someone
      // typing "S" more often wants SPX than SBUX.
      if (inst.kind === "index") score += 60;
      if (inst.kind === "crypto") score += 40;
      if (inst.kind === "fund") score += 30;
      scored.push({ inst, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.inst.symbol.localeCompare(b.inst.symbol));
  return scored.slice(0, limit).map((s) => s.inst);
}
