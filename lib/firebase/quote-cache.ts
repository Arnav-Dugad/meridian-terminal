import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import type { Quote } from "@/lib/twelvedata/types";

/**
 * A shared quote cache in Firestore.
 *
 * The in-process cache is fast but its scope is one warm serverless instance.
 * Every cold start, every parallel instance and every new region begins with
 * an empty map and re-spends provider budget on figures another instance
 * fetched seconds ago. On a stack where the binding constraint is 8 credits a
 * minute, that is the difference between a working terminal and a simulated
 * one.
 *
 * This adds a second tier underneath it:
 *
 *     process cache  →  Firestore  →  provider
 *
 * Firestore reads are ~1ms-scale and effectively free at this volume, while a
 * provider call is 150–600ms and metered. So a Firestore hit is strictly
 * better than a provider call on every axis that matters.
 *
 * ── Rules this layer obeys ────────────────────────────────────────────────
 *
 *  1. **Fail open, always.** Firestore being absent, misconfigured or slow must
 *     never break a quote. Every operation is wrapped and returns empty on
 *     error; the caller proceeds to the provider as though the tier were not
 *     there.
 *  2. **Never cache a simulated value.** Writing fiction into a shared store
 *     would propagate it to every instance and every user, and it would
 *     outlive the outage that produced it.
 *  3. **Write in bounded batches.** A dashboard mount can produce forty quotes;
 *     forty individual writes would be slower than the fetch they are meant to
 *     save. Firestore caps a batch at 500, which is far above anything here.
 *  4. **Read-repair only.** Nothing here is authoritative. An entry past its
 *     TTL is ignored rather than deleted — a sweep would cost writes to save
 *     storage that is already negligible.
 */

const COLLECTION = "quoteCache";

/** Documents older than this are ignored regardless of their own TTL. */
const HARD_MAX_AGE_MS = 15 * 60 * 1000;

interface CachedQuoteDoc {
  quote: Quote;
  storedAt: number;
  /** Wall-clock instant past which this entry is stale. */
  freshUntil: number;
}

/**
 * Firestore rejects `undefined` field values outright, and several providers
 * legitimately return undefined for optional fields. Stripping them is
 * cheaper than making every provider normalise.
 */
function sanitise<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

export async function readCachedQuotes(slugs: string[]): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>();
  if (slugs.length === 0) return out;

  const db = await adminDb();
  if (!db) return out;

  try {
    // getAll is a single round trip for up to a few hundred documents, where
    // N separate gets would be N round trips.
    const refs = slugs.map((slug) => db.collection(COLLECTION).doc(encodeKey(slug)));
    const snapshots = await db.getAll(...refs);
    const now = Date.now();

    for (const snap of snapshots) {
      if (!snap.exists) continue;
      const data = snap.data() as CachedQuoteDoc | undefined;
      if (!data?.quote) continue;

      if (now > data.freshUntil || now - data.storedAt > HARD_MAX_AGE_MS) continue;

      // Provenance is downgraded on the way out: this figure is real, but it
      // was not fetched for this request, and the UI says so.
      out.set(data.quote.slug, { ...data.quote, source: "cached" });
    }
  } catch {
    // Fail open — the provider chain is the fallback.
  }

  return out;
}

export async function writeCachedQuotes(quotes: Quote[], ttlMs: number): Promise<void> {
  if (quotes.length === 0) return;

  const db = await adminDb();
  if (!db) return;

  // Rule 2: never propagate simulation into a shared store.
  const writable = quotes.filter((q) => q.source === "live");
  if (writable.length === 0) return;

  try {
    const now = Date.now();
    const batch = db.batch();

    for (const quote of writable.slice(0, 400)) {
      const ref = db.collection(COLLECTION).doc(encodeKey(quote.slug));
      batch.set(
        ref,
        sanitise({
          quote: sanitise(quote as unknown as Record<string, unknown>),
          storedAt: now,
          freshUntil: now + ttlMs,
        }),
        { merge: false },
      );
    }

    await batch.commit();
  } catch {
    // A failed cache write is invisible to the user by design.
  }
}

/**
 * Firestore document ids cannot contain `/` and must not be `.` or `..`.
 * Instrument slugs are safe today (`RELIANCE.NSE`, `BRK.B`, `BTC`) but the
 * encoding is applied anyway so a future venue suffix cannot break writes.
 */
function encodeKey(slug: string): string {
  return slug.replace(/\//g, "_").slice(0, 1500) || "unknown";
}

export async function isQuoteCacheAvailable(): Promise<boolean> {
  return (await adminDb()) !== null;
}
