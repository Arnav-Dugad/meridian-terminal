"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { DataSource, Quote } from "@/lib/twelvedata/types";
import { findBySlug } from "@/lib/market/universe";

/**
 * One live quote store for the entire application.
 *
 * The naive version of this — every component fetching the symbols it needs —
 * produces a dashboard that opens six connections and re-requests RELIANCE
 * four times. Instead, components declare which symbols they care about and
 * the provider maintains a single reference-counted subscription set behind
 * one server-sent-events connection. Mount a watchlist row and its symbol
 * joins the stream; unmount the last consumer and it drops out.
 *
 * Two further details matter in practice:
 *
 *  - Subscription changes are debounced. Rendering a forty-row table mounts
 *    forty subscribers in one frame, and reconnecting the stream forty times
 *    would be worse than not streaming at all.
 *  - There is a polling fallback. SSE is blocked by some corporate proxies and
 *    some hosting tiers cap stream duration, so a failed connection degrades to
 *    interval fetches rather than to a frozen screen.
 */

interface MarketDataValue {
  quotes: Map<string, Quote>;
  source: DataSource;
  /** Epoch ms of the last successful update. */
  updatedAt: number;
  connected: boolean;
  subscribe: (slugs: string[]) => () => void;
  refresh: () => void;
}

const MarketDataContext = createContext<MarketDataValue | null>(null);

const RESUBSCRIBE_DEBOUNCE_MS = 320;
const POLL_INTERVAL_MS = 12_000;
const MAX_STREAM_SYMBOLS = 40;

export function MarketDataProvider({ children }: { children: ReactNode }) {
  const [quotes, setQuotes] = useState<Map<string, Quote>>(() => new Map());
  const [source, setSource] = useState<DataSource>("simulated");
  const [updatedAt, setUpdatedAt] = useState(0);
  const [connected, setConnected] = useState(false);

  /** slug -> number of mounted consumers. */
  const refCounts = useRef<Map<string, number>>(new Map());
  const [activeKey, setActiveKey] = useState("");
  const resubTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventSource = useRef<EventSource | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamFailures = useRef(0);

  const recomputeActive = useCallback(() => {
    if (resubTimer.current) clearTimeout(resubTimer.current);
    resubTimer.current = setTimeout(() => {
      const slugs = Array.from(refCounts.current.entries())
        .filter(([, n]) => n > 0)
        .map(([slug]) => slug)
        .sort();
      setActiveKey(slugs.join(","));
    }, RESUBSCRIBE_DEBOUNCE_MS);
  }, []);

  const subscribe = useCallback(
    (slugs: string[]) => {
      const valid = slugs.filter((s) => Boolean(findBySlug(s)));
      for (const slug of valid) {
        refCounts.current.set(slug, (refCounts.current.get(slug) ?? 0) + 1);
      }
      recomputeActive();

      return () => {
        for (const slug of valid) {
          const next = (refCounts.current.get(slug) ?? 1) - 1;
          if (next <= 0) refCounts.current.delete(slug);
          else refCounts.current.set(slug, next);
        }
        recomputeActive();
      };
    },
    [recomputeActive],
  );

  const ingest = useCallback((incoming: Quote[], nextSource: DataSource) => {
    if (incoming.length === 0) return;
    setQuotes((prev) => {
      const next = new Map(prev);
      for (const q of incoming) next.set(q.slug, q);
      return next;
    });
    setSource(nextSource);
    setUpdatedAt(Date.now());
  }, []);

  const fetchOnce = useCallback(
    async (slugs: string[]) => {
      if (slugs.length === 0) return;
      try {
        const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(slugs.join(","))}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const body = (await res.json()) as { data: Quote[]; source: DataSource };
        ingest(body.data, body.source);
      } catch {
        // Offline or aborted; the next interval will retry.
      }
    },
    [ingest],
  );

  const refresh = useCallback(() => {
    const slugs = activeKey ? activeKey.split(",") : [];
    void fetchOnce(slugs);
  }, [activeKey, fetchOnce]);

  useEffect(() => {
    const slugs = activeKey ? activeKey.split(",").filter(Boolean) : [];

    const teardown = () => {
      eventSource.current?.close();
      eventSource.current = null;
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = null;
      setConnected(false);
    };

    if (slugs.length === 0) {
      teardown();
      return;
    }

    // Prime immediately so the first paint has numbers, then attach the stream.
    void fetchOnce(slugs);

    const startPolling = () => {
      if (pollTimer.current) return;
      pollTimer.current = setInterval(() => void fetchOnce(slugs), POLL_INTERVAL_MS);
    };

    // Beyond the cap, streaming every symbol costs more than it returns;
    // polling the batch endpoint is both cheaper and simpler.
    if (slugs.length > MAX_STREAM_SYMBOLS || typeof EventSource === "undefined") {
      startPolling();
      return teardown;
    }

    const es = new EventSource(`/api/stream?symbols=${encodeURIComponent(slugs.join(","))}`);
    eventSource.current = es;

    es.addEventListener("open", () => {
      setConnected(true);
      streamFailures.current = 0;
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    });

    es.addEventListener("quotes", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as {
          data: Quote[];
          source: DataSource;
        };
        ingest(payload.data, payload.source);
      } catch {
        /* malformed frame — skip it rather than tearing down the stream */
      }
    });

    es.addEventListener("error", () => {
      setConnected(false);
      streamFailures.current += 1;
      // EventSource retries on its own. After a few consecutive failures the
      // environment is probably hostile to streaming, so switch to polling and
      // stop fighting it.
      if (streamFailures.current >= 3) {
        es.close();
        eventSource.current = null;
        startPolling();
      }
    });

    return teardown;
  }, [activeKey, fetchOnce, ingest]);

  // Stop burning requests on a tab nobody is looking at, and catch up on
  // return so the first thing the user sees is current.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refresh]);

  const value = useMemo<MarketDataValue>(
    () => ({ quotes, source, updatedAt, connected, subscribe, refresh }),
    [quotes, source, updatedAt, connected, subscribe, refresh],
  );

  return <MarketDataContext.Provider value={value}>{children}</MarketDataContext.Provider>;
}

function useMarketData(): MarketDataValue {
  const ctx = useContext(MarketDataContext);
  if (!ctx) throw new Error("useMarketData must be used inside <MarketDataProvider>");
  return ctx;
}

/**
 * Subscribe to a set of symbols and receive their live quotes.
 *
 * The returned array is index-aligned with `slugs`, with `undefined` for
 * anything not yet loaded, so a table can render its rows before the data
 * lands rather than collapsing and reflowing when it does.
 */
export function useQuotes(slugs: string[]): {
  quotes: (Quote | undefined)[];
  map: Map<string, Quote>;
  source: DataSource;
  updatedAt: number;
  connected: boolean;
  refresh: () => void;
} {
  const { quotes, subscribe, source, updatedAt, connected, refresh } = useMarketData();
  const key = slugs.join(",");

  useEffect(() => {
    if (!key) return;
    return subscribe(key.split(","));
    // `key` is the stable identity of the slug list; depending on the array
    // itself would resubscribe on every render.
  }, [key, subscribe]);

  const resolved = useMemo(
    () => (key ? key.split(",").map((s) => quotes.get(s)) : []),
    [key, quotes],
  );

  return { quotes: resolved, map: quotes, source, updatedAt, connected, refresh };
}

export function useQuote(slug: string | null | undefined) {
  const slugs = useMemo(() => (slug ? [slug] : []), [slug]);
  const { quotes, source, updatedAt, connected } = useQuotes(slugs);
  return { quote: quotes[0], source, updatedAt, connected };
}
