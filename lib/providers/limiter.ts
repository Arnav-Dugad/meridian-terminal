import "server-only";

/**
 * Per-provider request governor.
 *
 * Every free data tier meters differently — Finnhub counts calls per minute,
 * FMP counts them per day, Twelve Data counts *credits* per minute where one
 * batched quote for twenty symbols costs twenty. A single global limiter
 * cannot express that, so each provider gets its own budget with independent
 * minute and day windows, and a request must satisfy both to proceed.
 *
 * Two properties matter:
 *
 *  - Acquisitions serialise through a promise chain, so two concurrent callers
 *    cannot both observe the same free slot and overspend the window. Without
 *    this, a page that mounts six panels at once reliably overdraws.
 *  - A caller that would have to wait longer than `maxWaitMs` is refused
 *    immediately rather than parked. Holding a serverless invocation open for
 *    forty seconds waiting on a rate limit is a timeout with extra steps; the
 *    right answer is to fail fast so the caller can fall through to the next
 *    provider in the chain.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export interface Budget {
  /** Requests (or credits) per rolling minute. Omit for no minute cap. */
  perMinute?: number;
  /** Requests per rolling day. Omit for no daily cap. */
  perDay?: number;
}

export class RateLimited extends Error {
  constructor(
    readonly provider: string,
    readonly retryAfterMs: number,
    readonly window: "minute" | "day",
  ) {
    super(
      `${provider} ${window} budget exhausted; retry in ${Math.ceil(retryAfterMs / 1000)}s`,
    );
    this.name = "RateLimited";
  }
}

interface Window {
  limit: number;
  span: number;
  /** Timestamps of spent units inside the window, ascending. */
  spent: number[];
}

class ProviderLimiter {
  private minute: Window | null;
  private day: Window | null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    readonly name: string,
    budget: Budget,
  ) {
    this.minute = budget.perMinute ? { limit: budget.perMinute, span: MINUTE_MS, spent: [] } : null;
    this.day = budget.perDay ? { limit: budget.perDay, span: DAY_MS, spent: [] } : null;
  }

  private prune(w: Window, now: number) {
    const cutoff = now - w.span;
    if (w.spent.length > 0 && w.spent[0]! < cutoff) {
      w.spent = w.spent.filter((t) => t >= cutoff);
    }
  }

  /** Milliseconds until `cost` units free up in this window. */
  private waitFor(w: Window, cost: number, now: number): number {
    this.prune(w, now);
    const need = cost - (w.limit - w.spent.length);
    if (need <= 0) return 0;
    // The unit that frees the `need`-th slot is at index need-1.
    const releasing = w.spent[need - 1];
    return releasing == null ? w.span : Math.max(0, releasing + w.span - now);
  }

  available(): { minute: number | null; day: number | null } {
    const now = Date.now();
    if (this.minute) this.prune(this.minute, now);
    if (this.day) this.prune(this.day, now);
    return {
      minute: this.minute ? Math.max(0, this.minute.limit - this.minute.spent.length) : null,
      day: this.day ? Math.max(0, this.day.limit - this.day.spent.length) : null,
    };
  }

  /** True when `cost` units can be spent right now with no wait. */
  canSpend(cost = 1): boolean {
    const now = Date.now();
    const m = this.minute ? this.waitFor(this.minute, cost, now) : 0;
    const d = this.day ? this.waitFor(this.day, cost, now) : 0;
    return m === 0 && d === 0;
  }

  async acquire(cost = 1, maxWaitMs = 1500): Promise<void> {
    const run = this.chain.then(async () => {
      const now = Date.now();

      // A daily budget cannot be waited out inside a request. If it is spent,
      // refuse immediately so the caller moves to the next provider.
      if (this.day) {
        const dayWait = this.waitFor(this.day, cost, now);
        if (dayWait > 0) throw new RateLimited(this.name, dayWait, "day");
      }

      if (this.minute) {
        const wait = this.waitFor(this.minute, cost, now);
        if (wait > maxWaitMs) throw new RateLimited(this.name, wait, "minute");
        if (wait > 0) await new Promise((r) => setTimeout(r, wait + 25));
      }

      const stamp = Date.now();
      for (let i = 0; i < cost; i++) {
        this.minute?.spent.push(stamp);
        this.day?.spent.push(stamp);
      }
    });

    // Keep the chain alive even when a link rejects.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * The provider told us we are over the limit despite our own accounting —
   * clock skew, or another deployment sharing the key. Burn the minute window.
   */
  penalise() {
    const now = Date.now();
    if (this.minute) this.minute.spent = new Array(this.minute.limit).fill(now);
  }
}

const limiters = new Map<string, ProviderLimiter>();

export function registerLimiter(name: string, budget: Budget): void {
  limiters.set(name, new ProviderLimiter(name, budget));
}

function limiterFor(name: string): ProviderLimiter {
  const existing = limiters.get(name);
  if (existing) return existing;
  // Unregistered providers get a conservative default rather than free rein.
  const created = new ProviderLimiter(name, { perMinute: 30 });
  limiters.set(name, created);
  return created;
}

export function acquire(provider: string, cost = 1, maxWaitMs = 1500): Promise<void> {
  return limiterFor(provider).acquire(cost, maxWaitMs);
}

export function canSpend(provider: string, cost = 1): boolean {
  return limiterFor(provider).canSpend(cost);
}

export function penalise(provider: string): void {
  limiterFor(provider).penalise();
}

export function limiterSnapshot(): Record<string, { minute: number | null; day: number | null }> {
  const out: Record<string, { minute: number | null; day: number | null }> = {};
  for (const [name, limiter] of limiters) out[name] = limiter.available();
  return out;
}
