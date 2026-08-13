import "server-only";

import { acquire, penalise, RateLimited } from "@/lib/providers/limiter";
import { ProviderError } from "@/lib/providers/types";

/**
 * Shared fetch for every provider.
 *
 * Centralises the four things each upstream would otherwise get subtly
 * differently: budget acquisition, timeouts, retry with jittered backoff, and
 * turning a vendor's idea of an error into one exception type the registry can
 * route on.
 */

const DEFAULT_TIMEOUT_MS = 8_000;

export interface RequestOptions {
  provider: string;
  /** Units to charge against the provider budget. Usually 1. */
  cost?: number;
  /** Longest to wait on the budget before failing over. */
  maxWaitMs?: number;
  retries?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export async function providerFetch<T>(
  url: string,
  options: RequestOptions,
): Promise<T> {
  const {
    provider,
    cost = 1,
    maxWaitMs = 1200,
    retries = 1,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    headers = {},
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await acquire(provider, cost, maxWaitMs);
    } catch (err) {
      // Budget exhausted. Never retry this — the whole point is to fail over
      // to a provider that still has headroom.
      if (err instanceof RateLimited) {
        throw new ProviderError(provider, err.message, 429, true);
      }
      throw err;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json", ...headers },
        // Providers are cached by our own layer, which understands credits;
        // Next's fetch cache would fight it.
        cache: "no-store",
      });

      if (res.status === 429) {
        penalise(provider);
        throw new ProviderError(provider, "rate limited upstream", 429, true);
      }
      if (res.status === 401 || res.status === 403) {
        // Bad key or a plan that does not cover this symbol. Failing over is
        // right, but retrying the same call never is.
        throw new ProviderError(provider, `not authorised (${res.status})`, res.status, true);
      }
      if (!res.ok) {
        throw new ProviderError(provider, `HTTP ${res.status}`, res.status, res.status >= 500);
      }

      return (await res.json()) as T;
    } catch (err) {
      lastError = err;

      const retryable =
        (err instanceof ProviderError && err.status >= 500) ||
        (err instanceof Error && err.name === "AbortError");

      if (!retryable || attempt === retries) break;

      // Jitter so parallel callers do not synchronise into a retry storm.
      await new Promise((r) => setTimeout(r, 350 * 2 ** attempt + Math.random() * 200));
    } finally {
      clearTimeout(timer);
    }
  }

  if (lastError instanceof ProviderError) throw lastError;
  if (lastError instanceof Error && lastError.name === "AbortError") {
    throw new ProviderError(provider, `timed out after ${timeoutMs}ms`, 504, true);
  }
  throw new ProviderError(
    provider,
    lastError instanceof Error ? lastError.message : "unknown failure",
    500,
    true,
  );
}

/* ── Coercion ─────────────────────────────────────────────────────────────── */

export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t === "NaN" || t === "None" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Seconds-or-milliseconds epoch to milliseconds. */
export function epochMs(v: unknown): number | null {
  const n = num(v);
  if (n == null || n <= 0) return null;
  return n > 1e11 ? n : n * 1000;
}

export function isoMs(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const iso = s.includes(" ") && !s.includes("T") ? `${s.replace(" ", "T")}Z` : s;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}
