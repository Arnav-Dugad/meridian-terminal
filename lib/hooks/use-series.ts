"use client";

import { useEffect, useRef, useState } from "react";

import type { ApiEnvelope, DataSource, RangeKey, Series } from "@/lib/twelvedata/types";

/**
 * Fetch a price series for a symbol and range.
 *
 * Two behaviours that matter when someone is clicking through ranges quickly:
 *
 *  - Previously fetched ranges stay in a per-hook cache, so going 1M → 1Y → 1M
 *    is instant the second time and costs nothing.
 *  - The previous series stays on screen while the next one loads. Clearing to
 *    empty first would collapse the chart's height and throw away the morph
 *    the engine is about to animate.
 */
export function useSeries(
  slug: string,
  range: RangeKey,
  initial?: Series,
): {
  series: Series | null;
  loading: boolean;
  error: string | null;
  source: DataSource;
  reload: () => void;
} {
  const cache = useRef<Map<string, Series>>(new Map());
  const [series, setSeries] = useState<Series | null>(initial ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<DataSource>(initial?.source ?? "simulated");
  const [nonce, setNonce] = useState(0);

  // Seed the cache from the server-rendered series so its range is free.
  useEffect(() => {
    if (initial) cache.current.set(`${initial.slug}:${initial.range}`, initial);
  }, [initial]);

  useEffect(() => {
    const key = `${slug}:${range}`;
    const hit = cache.current.get(key);
    if (hit && nonce === 0) {
      setSeries(hit);
      setSource(hit.source);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(
          `/api/series?symbol=${encodeURIComponent(slug)}&range=${range}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`Series request failed (${res.status})`);

        const body = (await res.json()) as ApiEnvelope<Series>;
        if (cancelled) return;

        cache.current.set(key, body.data);
        setSeries(body.data);
        setSource(body.source);
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === "AbortError")) return;
        setError(err instanceof Error ? err.message : "Could not load history");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [slug, range, nonce]);

  return { series, loading, error, source, reload: () => setNonce((n) => n + 1) };
}

/**
 * Fetch several series at once, for the comparison view.
 * Requests run in parallel; a failure on one symbol does not sink the rest.
 */
export function useMultiSeries(
  slugs: string[],
  range: RangeKey,
): { series: Map<string, Series>; loading: boolean } {
  const [series, setSeries] = useState<Map<string, Series>>(new Map());
  const [loading, setLoading] = useState(false);
  const key = slugs.join(",");

  useEffect(() => {
    const list = key ? key.split(",") : [];
    if (list.length === 0) {
      setSeries(new Map());
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);

    (async () => {
      const results = await Promise.all(
        list.map(async (slug) => {
          try {
            const res = await fetch(
              `/api/series?symbol=${encodeURIComponent(slug)}&range=${range}`,
              { signal: controller.signal },
            );
            if (!res.ok) return null;
            const body = (await res.json()) as ApiEnvelope<Series>;
            return [slug, body.data] as const;
          } catch {
            return null;
          }
        }),
      );

      if (cancelled) return;
      setSeries(new Map(results.filter((r): r is readonly [string, Series] => r !== null)));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key, range]);

  return { series, loading };
}
