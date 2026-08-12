/**
 * Process-local cache with stale-while-revalidate and single-flight.
 *
 * Scope note: on Vercel this lives inside one warm serverless instance, so it
 * is a hit-rate optimisation rather than a shared cache. That is exactly what
 * we need -- the expensive resource is the Twelve Data credit budget, and the
 * hot path (a dashboard polling twenty tickers every few seconds) is served by
 * whichever instance the connection landed on.
 *
 * Three behaviours matter here:
 *
 *  1. Single-flight. Twenty concurrent requests for RELIANCE must produce one
 *     upstream call, not twenty. Without this, a page mount instantly burns a
 *     free tier's entire minute of credits.
 *  2. Stale-while-revalidate. Past `ttl` we still return the stale value and
 *     refresh in the background, so a slow upstream never blocks a render.
 *  3. A hard `maxAge` past which stale data is refused outright, because a
 *     nine-minute-old quote presented as current is worse than no quote.
 */

interface Entry<T> {
  value: T;
  storedAt: number;
  /** Fresh until this timestamp. */
  freshUntil: number;
  /** Unusable after this timestamp. */
  deadAt: number;
}

export interface CacheOptions {
  /** Milliseconds the value is considered fresh. */
  ttl: number;
  /** Milliseconds after which a stale value is no longer served at all. */
  maxAge?: number;
}

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/** Bound the map so a long-lived instance cannot leak unboundedly. */
const MAX_ENTRIES = 2000;

function evictIfNeeded() {
  if (store.size <= MAX_ENTRIES) return;
  // Map preserves insertion order, so the head is the oldest write.
  const overflow = store.size - MAX_ENTRIES;
  let i = 0;
  for (const key of store.keys()) {
    store.delete(key);
    if (++i >= overflow) break;
  }
}

export interface CachedResult<T> {
  value: T;
  /** True when the value was served from cache without hitting the source. */
  hit: boolean;
  /** True when the value was past its TTL (a background refresh was queued). */
  stale: boolean;
  ageMs: number;
}

export async function cached<T>(
  key: string,
  options: CacheOptions,
  loader: () => Promise<T>,
): Promise<CachedResult<T>> {
  const now = Date.now();
  const maxAge = options.maxAge ?? options.ttl * 12;
  const entry = store.get(key) as Entry<T> | undefined;

  if (entry && now < entry.freshUntil) {
    return { value: entry.value, hit: true, stale: false, ageMs: now - entry.storedAt };
  }

  // Stale but usable: return immediately, refresh behind the request.
  if (entry && now < entry.deadAt) {
    void revalidate(key, options, loader);
    return { value: entry.value, hit: true, stale: true, ageMs: now - entry.storedAt };
  }

  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) {
    return { value: await existing, hit: false, stale: false, ageMs: 0 };
  }

  const promise = loader()
    .then((value) => {
      write(key, value, options.ttl, maxAge);
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return { value: await promise, hit: false, stale: false, ageMs: 0 };
}

function revalidate<T>(key: string, options: CacheOptions, loader: () => Promise<T>) {
  if (inflight.has(key)) return;
  const maxAge = options.maxAge ?? options.ttl * 12;
  const promise = loader()
    .then((value) => {
      write(key, value, options.ttl, maxAge);
      return value;
    })
    .catch(() => {
      // A failed background refresh must never surface: the caller already has
      // a usable value. Extend the death clock a little so we do not hammer a
      // provider that is having a bad minute.
      const entry = store.get(key);
      if (entry) entry.deadAt = Date.now() + Math.min(30_000, options.ttl * 3);
      return undefined;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
}

function write<T>(key: string, value: T, ttl: number, maxAge: number) {
  const now = Date.now();
  store.set(key, { value, storedAt: now, freshUntil: now + ttl, deadAt: now + maxAge });
  evictIfNeeded();
}

/** Read without triggering a load. Used by the degradation path. */
export function peek<T>(key: string): CachedResult<T> | null {
  const entry = store.get(key) as Entry<T> | undefined;
  if (!entry) return null;
  const now = Date.now();
  if (now >= entry.deadAt) return null;
  return {
    value: entry.value,
    hit: true,
    stale: now >= entry.freshUntil,
    ageMs: now - entry.storedAt,
  };
}

export function invalidate(prefix: string) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function cacheStats() {
  return { entries: store.size, inflight: inflight.size };
}
