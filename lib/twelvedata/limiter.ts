/**
 * Credit-aware request governor.
 *
 * Twelve Data bills in credits per minute, and a batch quote for twenty
 * symbols costs twenty credits, not one. The free tier allows eight per
 * minute. That constraint shapes the whole backend: rather than letting calls
 * fail with a 429 and retrying into the same wall, requests take a numbered
 * ticket against a sliding-window budget and either wait their turn or are
 * told up front that there is no room -- at which point the caller degrades to
 * cache or simulation instead of stalling a page render.
 */

const WINDOW_MS = 60_000;

/** Timestamps of spent credits inside the rolling window. */
let spent: number[] = [];

let queue: Promise<void> = Promise.resolve();

function budget(): number {
  const raw = Number(process.env.TWELVE_DATA_CREDITS_PER_MINUTE);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 8;
}

function prune(now: number) {
  const cutoff = now - WINDOW_MS;
  if (spent.length && spent[0]! < cutoff) {
    spent = spent.filter((t) => t >= cutoff);
  }
}

export function creditsAvailable(): number {
  prune(Date.now());
  return Math.max(0, budget() - spent.length);
}

/** Milliseconds until at least `n` credits free up. 0 if available now. */
export function waitTimeFor(n: number): number {
  const now = Date.now();
  prune(now);
  const need = n - (budget() - spent.length);
  if (need <= 0) return 0;
  // The credit that frees the `need`-th slot is the one at index need-1.
  const releasing = spent[need - 1];
  if (releasing == null) return WINDOW_MS;
  return Math.max(0, releasing + WINDOW_MS - now);
}

export interface AcquireOptions {
  /** Credits this call will consume. */
  cost: number;
  /**
   * Longest we are willing to block. Past this, the caller degrades rather
   * than holding a request open -- a serverless function waiting 40 seconds
   * for a rate limit is a timeout with extra steps.
   */
  maxWaitMs?: number;
}

export class RateLimitExceeded extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`Twelve Data credit budget exhausted; retry in ${Math.ceil(retryAfterMs / 1000)}s`);
    this.name = "RateLimitExceeded";
  }
}

/**
 * Reserve `cost` credits, waiting if necessary.
 *
 * Calls are serialised through a promise chain so two concurrent acquirers
 * cannot both observe the same free slot and overspend the window.
 */
export async function acquire({ cost, maxWaitMs = 2500 }: AcquireOptions): Promise<void> {
  const cap = budget();
  const need = Math.max(1, Math.min(cost, cap));

  const run = queue.then(async () => {
    const wait = waitTimeFor(need);
    if (wait > maxWaitMs) throw new RateLimitExceeded(wait);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait + 25));
    const now = Date.now();
    prune(now);
    for (let i = 0; i < need; i++) spent.push(now);
  });

  // Keep the chain alive even when a link rejects.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Provider told us we are over the limit despite our own accounting -- clock
 * skew, or another deployment sharing the key. Burn the window.
 */
export function penalise() {
  const now = Date.now();
  spent = new Array(budget()).fill(now);
}

export function limiterStats() {
  prune(Date.now());
  return { budget: budget(), used: spent.length, available: creditsAvailable() };
}
