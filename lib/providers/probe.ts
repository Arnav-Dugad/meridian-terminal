import "server-only";

import { alphaVantage } from "@/lib/providers/alphavantage";
import { coingecko } from "@/lib/providers/coingecko";
import { finnhub } from "@/lib/providers/finnhub";
import { fmp } from "@/lib/providers/fmp";
import { twelveData } from "@/lib/providers/twelvedata";
import { yahoo } from "@/lib/providers/yahoo";
import { limiterSnapshot } from "@/lib/providers/limiter";
import { breakerSnapshot } from "@/lib/providers/breaker";
import type { QuoteProvider } from "@/lib/providers/types";
import { findBySlug, type Instrument } from "@/lib/market/universe";

/**
 * Real end-to-end probes, one per provider.
 *
 * Each probe issues a genuine request for a symbol that provider is expected
 * to serve, and reports latency, a sample of what came back, and — when it
 * fails — the upstream's own message. That last part matters more than it
 * sounds: "This symbol is available starting with the Grow plan" and "Legacy
 * Endpoint" are both plan/versioning problems that look exactly like an
 * outage from the application's side, and only the provider's own words
 * distinguish them.
 */

export type ProbeStatus = "ok" | "failed" | "not-configured";

export interface ProbeResult {
  id: string;
  label: string;
  homepage: string;
  status: ProbeStatus;
  /** What this probe actually asked for. */
  probe: string;
  /** Round-trip time in milliseconds. */
  latencyMs: number | null;
  /** A human-readable sample of the response, or the failure reason. */
  detail: string;
  /** What the app loses when this provider is down. */
  role: string;
  envVar: string | null;
  coverage: string[];
  budget: { minute: number | null; day: number | null };
  /** Breaker state, so a paused provider reads as recovering not broken. */
  circuit: { state: "closed" | "open" | "half-open"; retryInSeconds: number };
}

interface ProbeSpec {
  provider: QuoteProvider;
  slug: string;
  role: string;
  run: (inst: Instrument) => Promise<string>;
}

function inst(slug: string): Instrument {
  const found = findBySlug(slug);
  if (!found) throw new Error(`probe misconfigured: unknown slug ${slug}`);
  return found;
}

const SPECS: ProbeSpec[] = [
  {
    provider: yahoo,
    slug: "RELIANCE.NSE",
    role: "Indian equities and indices, all price history, and the universal fallback. Without it, India cannot be priced on a free stack.",
    run: async (i) => {
      const quotes = (await yahoo.fetchQuotes?.([i])) ?? [];
      const q = quotes[0];
      if (!q) throw new Error("no quote returned");
      return `RELIANCE ₹${q.price.toFixed(2)} (${q.changePercent >= 0 ? "+" : ""}${q.changePercent.toFixed(2)}%)`;
    },
  },
  {
    provider: finnhub,
    slug: "AAPL",
    role: "US quotes at 60/min, plus news, analyst consensus, earnings and peers — none of which any other configured provider supplies.",
    run: async (i) => {
      const quotes = (await finnhub.fetchQuotes?.([i])) ?? [];
      const q = quotes[0];
      if (!q) throw new Error("no quote returned");
      return `AAPL $${q.price.toFixed(2)} (${q.changePercent >= 0 ? "+" : ""}${q.changePercent.toFixed(2)}%)`;
    },
  },
  {
    provider: coingecko,
    slug: "BTC",
    role: "Crypto quotes and history, batched. Needs no key.",
    run: async (i) => {
      const quotes = (await coingecko.fetchQuotes?.([i])) ?? [];
      const q = quotes[0];
      if (!q) throw new Error("no quote returned");
      return `BTC $${q.price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    },
  },
  {
    provider: twelveData,
    slug: "AAPL",
    role: "Secondary quote and history source. Note its free tier is US-only — Indian symbols return a plan error.",
    run: async (i) => {
      const quotes = (await twelveData.fetchQuotes?.([i])) ?? [];
      const q = quotes[0];
      if (!q) throw new Error("no quote returned");
      return `AAPL $${q.price.toFixed(2)} — US only on the free tier`;
    },
  },
  {
    provider: fmp,
    slug: "AAPL",
    role: "Fundamentals: valuation multiples, margins, returns and leverage.",
    run: async (i) => {
      const f = await fmp.fetchFundamentals?.(i);
      if (!f) throw new Error("no fundamentals returned");
      const bits = [
        f.peRatio != null ? `P/E ${f.peRatio.toFixed(1)}` : null,
        f.netMargin != null ? `net margin ${f.netMargin.toFixed(1)}%` : null,
      ].filter(Boolean);
      return bits.length > 0 ? `AAPL ${bits.join(", ")}` : "responded, but with no usable metrics";
    },
  },
  {
    provider: alphaVantage,
    slug: "RELIANCE.NSE",
    role: "Last-resort fallback, 25 calls a day. Reaches BSE, so it is a real if tiny second source for Indian prices.",
    run: async (i) => {
      const quotes = (await alphaVantage.fetchQuotes?.([i])) ?? [];
      const q = quotes[0];
      if (!q) throw new Error("no quote returned (or the daily budget is spent)");
      return `RELIANCE.BSE ₹${q.price.toFixed(2)}`;
    },
  },
];

export async function runProviderProbes(): Promise<ProbeResult[]> {
  const budgets = limiterSnapshot();
  const breakers = new Map(breakerSnapshot().map((b) => [b.provider, b]));

  // Probes run in parallel because they draw on independent budgets; running
  // them in series would make the page take six round trips to load.
  return Promise.all(
    SPECS.map(async (spec): Promise<ProbeResult> => {
      const meta = spec.provider.meta;
      const base = {
        id: meta.id,
        label: meta.label,
        homepage: meta.homepage,
        probe: spec.slug,
        role: spec.role,
        envVar: meta.envVar,
        coverage: meta.coverage as string[],
        budget: budgets[meta.id] ?? { minute: null, day: null },
        circuit: (() => {
          const b = breakers.get(meta.id);
          return b
            ? { state: b.state, retryInSeconds: b.retryInSeconds }
            : { state: "closed" as const, retryInSeconds: 0 };
        })(),
      };

      if (!meta.configured) {
        return {
          ...base,
          status: "not-configured",
          latencyMs: null,
          detail: meta.envVar ? `Set ${meta.envVar} to enable.` : "Not available.",
        };
      }

      const started = Date.now();
      try {
        const detail = await spec.run(inst(spec.slug));
        return { ...base, status: "ok", latencyMs: Date.now() - started, detail };
      } catch (err) {
        return {
          ...base,
          status: "failed",
          latencyMs: Date.now() - started,
          // The upstream's own wording is the diagnostic; keep it verbatim.
          detail: err instanceof Error ? err.message.slice(0, 240) : "unknown failure",
        };
      }
    }),
  );
}
