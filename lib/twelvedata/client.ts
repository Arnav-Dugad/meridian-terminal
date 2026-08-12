import "server-only";

import { TwelveDataError } from "@/lib/twelvedata/types";
import { acquire, penalise, RateLimitExceeded } from "@/lib/twelvedata/limiter";

/**
 * The only place in the codebase that talks to api.twelvedata.com.
 *
 * `server-only` at the top is load-bearing: it turns any accidental import
 * from a client component into a build error rather than a leaked API key.
 */

const BASE = "https://api.twelvedata.com";
const TIMEOUT_MS = 9_000;

export function apiKey(): string | null {
  const key = process.env.TWELVE_DATA_API_KEY?.trim();
  return key ? key : null;
}

export function hasApiKey(): boolean {
  return apiKey() !== null;
}

export class MissingApiKey extends Error {
  constructor() {
    super("TWELVE_DATA_API_KEY is not configured");
    this.name = "MissingApiKey";
  }
}

export { RateLimitExceeded };

type Params = Record<string, string | number | undefined>;

interface FetchOptions {
  /** Credits this request consumes -- generally the symbol count. */
  cost?: number;
  /** Longest we will wait on the credit budget before degrading. */
  maxWaitMs?: number;
  /** Retries for transient failures. */
  retries?: number;
}

/**
 * Twelve Data reports failure in three different ways, and a robust client has
 * to handle all of them:
 *   - a non-2xx HTTP status
 *   - HTTP 200 with `{ status: "error", code, message }`
 *   - HTTP 200 batch with a per-symbol `{ status: "error" }` inside an
 *     otherwise healthy envelope (handled by the callers, which can still use
 *     the symbols that succeeded)
 */
export async function tdFetch<T>(
  endpoint: string,
  params: Params = {},
  options: FetchOptions = {},
): Promise<T> {
  const key = apiKey();
  if (!key) throw new MissingApiKey();

  const { cost = 1, maxWaitMs = 2500, retries = 2 } = options;

  const url = new URL(`${BASE}/${endpoint.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  url.searchParams.set("apikey", key);
  // UTC everywhere. Parsing exchange-local datetimes without an offset is a
  // reliable source of off-by-hours bugs around DST transitions.
  if (!url.searchParams.has("timezone")) url.searchParams.set("timezone", "UTC");

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    await acquire({ cost, maxWaitMs });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
        // We run our own cache with SWR semantics; Next's fetch cache would
        // fight it and cannot express a credit budget.
        cache: "no-store",
      });

      if (res.status === 429) {
        penalise();
        throw new TwelveDataError("Rate limit exceeded", 429, endpoint);
      }
      if (!res.ok) {
        throw new TwelveDataError(`HTTP ${res.status} from ${endpoint}`, res.status, endpoint);
      }

      const json = (await res.json()) as unknown;

      if (isErrorPayload(json)) {
        if (json.code === 429) penalise();
        throw new TwelveDataError(json.message ?? "Provider error", json.code ?? 500, endpoint);
      }

      return json as T;
    } catch (err) {
      lastError = err;

      const retryable =
        (err instanceof TwelveDataError && err.retryable) ||
        (err instanceof Error && err.name === "AbortError");

      if (!retryable || attempt === retries) break;

      // Exponential backoff with jitter, so a burst of parallel callers does
      // not synchronise into a thundering retry.
      const backoff = 400 * 2 ** attempt + Math.random() * 250;
      await new Promise((r) => setTimeout(r, backoff));
    } finally {
      clearTimeout(timer);
    }
  }

  if (lastError instanceof Error && lastError.name === "AbortError") {
    throw new TwelveDataError(`Timed out after ${TIMEOUT_MS}ms`, 504, endpoint);
  }
  throw lastError instanceof Error ? lastError : new TwelveDataError("Unknown error", 500, endpoint);
}

interface ErrorPayload {
  status: "error";
  code?: number;
  message?: string;
}

function isErrorPayload(x: unknown): x is ErrorPayload {
  return (
    typeof x === "object" &&
    x !== null &&
    "status" in x &&
    (x as { status?: unknown }).status === "error"
  );
}

/* ── Coercion helpers ─────────────────────────────────────────────────────────
   Every numeric field arrives as a string, sometimes as "", sometimes absent,
   and occasionally as the literal "NaN". One place to get this right. */

export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed || trimmed === "NaN") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function numOr(v: unknown, fallback: number): number {
  return num(v) ?? fallback;
}

export function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function bool(v: unknown): boolean {
  return v === true || v === "true";
}

/**
 * Parse a Twelve Data datetime. With `timezone=UTC` requested, values arrive
 * either as `YYYY-MM-DD` (daily and coarser) or `YYYY-MM-DD HH:mm:ss`.
 */
export function parseDatetime(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const iso = s.includes(" ") ? `${s.replace(" ", "T")}Z` : `${s}T00:00:00Z`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Seconds-since-epoch to milliseconds, tolerating either unit. */
export function parseTimestamp(v: unknown): number | null {
  const n = num(v);
  if (n == null) return null;
  return n > 1e11 ? n : n * 1000;
}
