// Implements: 21_Redis_Caching_Layer.md §8.1 — Redis circuit breaker.
//
// Redis is a dependency, and dependencies fail. The cache stage (3.5) **never
// blocks a request on Redis** — when Redis is down, the gateway degrades to
// "no cache" and every request goes straight to the DB. The circuit breaker
// implements this fail-open behaviour:
//
//   State     Condition                              Behaviour
//   --------  -------------------------------------  ----------------------------------
//   CLOSED    normal operation                       every request consults Redis
//   OPEN      > 5 consecutive failures in 10 sec     skip Redis for 30 sec; fail-open
//   HALF-OPEN after 30 sec cooldown                  allow 1 probe; on success → CLOSED,
//                                                    on failure → re-OPEN
//
// All state transitions and counters are O(1) — the breaker is just a few
// integers and timestamps.

/**
 * Typed error thrown when `withCircuit` short-circuits because the circuit is
 * OPEN. Callers MUST catch this and fall through to the DB (fail-open).
 */
export class CircuitOpenError extends Error {
  readonly name = 'CircuitOpenError';
  readonly openedAt: number;
  readonly cooldownMs: number;

  constructor(openedAt: number, cooldownMs: number) {
    super(`circuit open until ${new Date(openedAt + cooldownMs).toISOString()}`);
    this.openedAt = openedAt;
    this.cooldownMs = cooldownMs;
  }
}

/**
 * The three breaker states (spec 21 §8.1).
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF-OPEN';

/**
 * Breaker configuration. Defaults match the spec:
 *  - 5 failures in 10 sec → OPEN
 *  - 30 sec cooldown → HALF-OPEN
 *  - 1 probe in HALF-OPEN; success → CLOSED, failure → OPEN
 */
export interface CircuitBreakerOptions {
  /** Failure threshold within `failureWindowMs` that trips the breaker. */
  failureThreshold?: number;
  /** Sliding window length for counting failures. */
  failureWindowMs?: number;
  /** How long the breaker stays OPEN before transitioning to HALF-OPEN. */
  cooldownMs?: number;
  /** Optional logger. */
  log?: (level: 'info' | 'warn' | 'error', msg: string, fields?: Record<string, unknown>) => void;
}

/**
 * A Redis circuit breaker.
 *
 * Wrap any Redis-touching call in `withCircuit`:
 *   const result = await breaker.withCircuit(() => redis.get(key));
 *   // throws CircuitOpenError when OPEN — catch and fail-open.
 *
 * The breaker is single-instance (per gateway worker). Each worker has its own
 * breaker; if one worker's Redis client fails but another's is healthy, the
 * second worker's breaker stays CLOSED. This is acceptable because Redis is a
 * shared dependency — if it's down for one worker, it's down for all, and
 * every worker's breaker will trip within a few seconds.
 *
 * @complexity All operations are O(1) — a few integer ops and a timestamp
 *   comparison. The failure window is a sliding counter, not a list of
 *   timestamps (we cap the count and reset on state transition).
 */
export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly failureWindowMs: number;
  private readonly cooldownMs: number;
  private readonly log: NonNullable<CircuitBreakerOptions['log']>;

  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private firstFailureAt = 0;
  private openedAt = 0;
  private probeInFlight = false;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.failureWindowMs = opts.failureWindowMs ?? 10_000;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.log = opts.log ?? (() => undefined);
  }

  /**
   * @returns the current state. O(1).
   */
  getState(): CircuitState {
    this.maybeTransitionToHalfOpen();
    return this.state;
  }

  /**
   * Run `fn` under the breaker. Throws `CircuitOpenError` immediately if the
   * breaker is OPEN (and the cooldown has not elapsed). On success, resets the
   * failure counter (HALF-OPEN → CLOSED). On failure, increments the counter
   * and possibly trips the breaker.
   *
   * @complexity O(1) (constant state-machine work) plus the cost of `fn`.
   */
  async withCircuit<T>(fn: () => Promise<T>): Promise<T> {
    // Check current state — may transition OPEN → HALF-OPEN if cooldown elapsed.
    this.maybeTransitionToHalfOpen();

    if (this.state === 'OPEN') {
      throw new CircuitOpenError(this.openedAt, this.cooldownMs);
    }

    if (this.state === 'HALF-OPEN') {
      // Only one probe at a time. Concurrent callers in HALF-OPEN fail fast.
      if (this.probeInFlight) {
        throw new CircuitOpenError(this.openedAt, this.cooldownMs);
      }
      this.probeInFlight = true;
      try {
        const result = await fn();
        // Probe succeeded — close the circuit.
        this.toClosed('probe succeeded');
        return result;
      } catch (e) {
        // Probe failed — re-open the circuit.
        this.toOpen('probe failed', e);
        throw e;
      } finally {
        this.probeInFlight = false;
      }
    }

    // CLOSED — run fn, count failures.
    try {
      const result = await fn();
      // Success resets the failure counter (sliding window).
      this.failures = 0;
      this.firstFailureAt = 0;
      return result;
    } catch (e) {
      this.recordFailure();
      throw e;
    }
  }

  /**
   * Reset the breaker to CLOSED. Used in tests and by an operator endpoint
   * (`POST /admin/cache/circuit/reset`) when Redis is known to be back.
   *
   * @complexity O(1).
   */
  reset(): void {
    this.toClosed('manual reset');
  }

  // -------------------------------------------------------------------------
  // Internal state-machine helpers. All O(1).
  // -------------------------------------------------------------------------

  private maybeTransitionToHalfOpen(): void {
    if (this.state === 'OPEN' && Date.now() - this.openedAt >= this.cooldownMs) {
      this.state = 'HALF-OPEN';
      this.probeInFlight = false;
      this.log('info', 'circuit: OPEN → HALF-OPEN (cooldown elapsed)');
    }
  }

  private recordFailure(): void {
    const now = Date.now();
    if (this.failures === 0 || now - this.firstFailureAt > this.failureWindowMs) {
      // Start a new window.
      this.failures = 1;
      this.firstFailureAt = now;
    } else {
      this.failures++;
    }
    if (this.failures >= this.failureThreshold) {
      this.toOpen('failure threshold reached', undefined);
    }
  }

  private toOpen(reason: string, err: unknown): void {
    if (this.state === 'OPEN') return;
    this.state = 'OPEN';
    this.openedAt = Date.now();
    this.failures = 0;
    this.firstFailureAt = 0;
    this.log('warn', `circuit: → OPEN (${reason})`, {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  private toClosed(reason: string): void {
    if (this.state === 'CLOSED') return;
    this.state = 'CLOSED';
    this.failures = 0;
    this.firstFailureAt = 0;
    this.openedAt = 0;
    this.probeInFlight = false;
    this.log('info', `circuit: → CLOSED (${reason})`);
  }
}

// ---------------------------------------------------------------------------
// Self-test — runs with `bun run <this-file>`.
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const log: Array<[string, string]> = [];
  const breaker = new CircuitBreaker({
    failureThreshold: 3,
    failureWindowMs: 1000,
    cooldownMs: 100,
    log: (level, msg) => log.push([level, msg]),
  });

  console.log('=== initial state ===');
  console.log(`  state = ${breaker.getState()}`);

  const fail = async (): Promise<void> => {
    throw new Error('redis down');
  };
  const ok = async (): Promise<string> => 'OK';

  console.log('\n=== trip the breaker with 3 failures ===');
  for (let i = 1; i <= 3; i++) {
    try {
      await breaker.withCircuit(fail);
    } catch (e) {
      console.log(`  call ${i}: threw ${e instanceof Error ? e.name : 'error'}`);
    }
    console.log(`  state after call ${i}: ${breaker.getState()}`);
  }

  console.log('\n=== short-circuit while OPEN ===');
  try {
    await breaker.withCircuit(ok);
    console.log('  ✗ should have short-circuited');
  } catch (e) {
    console.log(`  ✓ threw ${e instanceof Error ? e.name : 'error'}`);
  }

  console.log('\n=== wait for cooldown (HALF-OPEN) ===');
  await new Promise((r) => setTimeout(r, 120));
  console.log(`  state = ${breaker.getState()}`);
  const r = await breaker.withCircuit(ok);
  console.log(`  probe result = ${r}  state = ${breaker.getState()}`);

  console.log('\n=== log ===');
  for (const [lvl, msg] of log) console.log(`  [${lvl}] ${msg}`);
}
