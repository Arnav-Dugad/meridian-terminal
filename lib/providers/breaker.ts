import "server-only";

/**
 * Circuit breakers, one per provider.
 *
 * The failover chain is only cheap when failures are cheap. A provider that is
 * down still costs a DNS lookup, a TCP handshake and a timeout on *every*
 * request that reaches it — so a single dead upstream in a five-provider chain
 * adds its full timeout to every page load, and under load that is how one
 * degraded dependency takes the whole app with it.
 *
 * The breaker fixes that by remembering. After enough consecutive failures it
 * opens, and every subsequent call is refused instantly without a request. It
 * then lets exactly one probe through after a cool-off; if that succeeds the
 * circuit closes, and if it fails the cool-off doubles up to a ceiling.
 *
 * Three states, the standard shape:
 *
 *   closed     normal — requests flow, failures are counted
 *   open       refusing instantly, waiting out the cool-off
 *   half-open  one probe allowed through to test recovery
 *
 * Deliberately *not* shared across instances. A breaker is a local judgement
 * about what this process has recently observed; coordinating it through a
 * store would add a network round trip to the mechanism whose entire purpose
 * is avoiding network round trips.
 */

type State = "closed" | "open" | "half-open";

interface Circuit {
  state: State;
  consecutiveFailures: number;
  /** Timestamp the breaker may next allow a probe. */
  openUntil: number;
  /** Current cool-off, doubling on each failed probe. */
  cooloffMs: number;
  lastError: string | null;
  totalTrips: number;
}

/** Consecutive failures before the circuit opens. */
const FAILURE_THRESHOLD = 4;
const BASE_COOLOFF_MS = 20_000;
const MAX_COOLOFF_MS = 5 * 60_000;

const circuits = new Map<string, Circuit>();

function circuitFor(provider: string): Circuit {
  let c = circuits.get(provider);
  if (!c) {
    c = {
      state: "closed",
      consecutiveFailures: 0,
      openUntil: 0,
      cooloffMs: BASE_COOLOFF_MS,
      lastError: null,
      totalTrips: 0,
    };
    circuits.set(provider, c);
  }
  return c;
}

/**
 * Whether a call may proceed.
 *
 * Transitions `open` to `half-open` when the cool-off has elapsed, which is
 * what lets exactly one probe through.
 */
export function canAttempt(provider: string): boolean {
  const c = circuitFor(provider);
  if (c.state === "closed") return true;

  if (Date.now() >= c.openUntil) {
    c.state = "half-open";
    return true;
  }
  return false;
}

export function recordSuccess(provider: string): void {
  const c = circuitFor(provider);
  c.state = "closed";
  c.consecutiveFailures = 0;
  c.cooloffMs = BASE_COOLOFF_MS;
  c.lastError = null;
}

export function recordFailure(provider: string, error: unknown): void {
  const c = circuitFor(provider);
  c.lastError = error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160);

  // A probe that fails re-opens immediately and backs off further — no point
  // counting to four again when we just proved the provider is still down.
  if (c.state === "half-open") {
    c.state = "open";
    c.cooloffMs = Math.min(MAX_COOLOFF_MS, c.cooloffMs * 2);
    c.openUntil = Date.now() + c.cooloffMs;
    c.totalTrips += 1;
    return;
  }

  c.consecutiveFailures += 1;
  if (c.consecutiveFailures >= FAILURE_THRESHOLD) {
    c.state = "open";
    c.openUntil = Date.now() + c.cooloffMs;
    c.totalTrips += 1;
  }
}

/**
 * Run `fn` under the breaker.
 *
 * `onOpen` supplies what to do when the circuit is open — normally throwing so
 * the chain moves to the next provider without spending a timeout.
 */
export async function withBreaker<T>(
  provider: string,
  fn: () => Promise<T>,
  onOpen: () => T | Promise<T>,
): Promise<T> {
  if (!canAttempt(provider)) return onOpen();

  try {
    const result = await fn();
    recordSuccess(provider);
    return result;
  } catch (err) {
    recordFailure(provider, err);
    throw err;
  }
}

export interface BreakerStatus {
  provider: string;
  state: State;
  consecutiveFailures: number;
  /** Seconds until the next probe is allowed; 0 when closed. */
  retryInSeconds: number;
  lastError: string | null;
  totalTrips: number;
}

export function breakerSnapshot(): BreakerStatus[] {
  const now = Date.now();
  return Array.from(circuits.entries()).map(([provider, c]) => ({
    provider,
    state: c.state,
    consecutiveFailures: c.consecutiveFailures,
    retryInSeconds: c.state === "open" ? Math.max(0, Math.ceil((c.openUntil - now) / 1000)) : 0,
    lastError: c.lastError,
    totalTrips: c.totalTrips,
  }));
}

/** Clears a breaker, for the diagnostics page's manual retry. */
export function resetBreaker(provider?: string): void {
  if (provider) circuits.delete(provider);
  else circuits.clear();
}
