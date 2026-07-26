// Implements: 21_Redis_Caching_Layer.md §5 — event-bus-driven cache invalidation.
//
// Every service mutation publishes a domain event (`student.updated:s_a3b1`,
// `ledger.entry.posted:s_a3b1`, `attendance.marked:b_math10a:20260711`). The
// invalidator subscribes to these events, looks up the invalidation rule for
// the event name, and DELs the affected keys via `CacheAside.invalidatePattern`.
//
// Why this exists: TTLs are a *performance optimisation*, not a correctness
// guarantee. Events are the correctness backstop — a mutated value is never
// served stale beyond the TTL because the invalidator DELs the cache within
// milliseconds of the mutation committing (via the outbox → event bus).
//
// The reference impl uses a Node `EventEmitter` as the bus. The web agent
// replaces it with a Redis Streams consumer (`XREADGROUP`) per spec 18 §4.1.

import { EventEmitter } from 'node:events';
import type { CacheAside } from './cache-aside.js';

/**
 * A domain event on the cache-invalidation bus. The `name` matches a key in
 * `Invalidator.invalidationRules`; the `args` are the entity IDs that appear
 * after the colon in the event stream (e.g. `s_a3b1` in `student.updated:s_a3b1`).
 *
 * Example: `{ name: 'student.updated', args: ['s_a3b1'], tutorId: 't_7' }`.
 */
export interface Event {
  /** Event name without the entity-id suffix (e.g. `student.updated`). */
  name: string;
  /** Entity IDs that the rule templates interpolate. */
  args: string[];
  /** The tutor whose cache namespace this event applies to. */
  tutorId: string;
}

/**
 * A single invalidation step. Either:
 *  - `{ kind: 'key', key }` — DEL a single literal key. O(1).
 *  - `{ kind: 'pattern', tagSetKey }` — SMEMBERS + DEL all members + DEL the
 *    tag set. O(K) where K is bounded.
 *
 * Both `key` and `tagSetKey` are templates: `{tid}` is replaced with the
 * event's tutorId, `{0}`, `{1}`, ... with the event's args.
 */
export type InvalidationStep =
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'pattern'; readonly tagSetKey: string };

/**
 * The invalidation rule for one event name. A list of steps executed in order.
 */
export type InvalidationRule = ReadonlyArray<InvalidationStep>;

/**
 * The default invalidation rules, transcribed from spec 21 §5.2. The web agent
 * should override or extend these via the `Invalidator` constructor.
 */
export const DEFAULT_INVALIDATION_RULES: Readonly<Record<string, InvalidationRule>> = {
  // student.updated:s_a3b1  →  DEL record, DEL list:* (via tag set), DEL dashboard
  'student.updated': [
    { kind: 'key', key: 'v1:t:{tid}:student:rec:{0}' },
    { kind: 'pattern', tagSetKey: 'v1:t:{tid}:students:list:__keys__' },
    { kind: 'pattern', tagSetKey: 'v1:t:{tid}:dashboard:__deps__' },
    { kind: 'key', key: 'v1:t:{tid}:dashboard:blob' },
  ],
  // student.created:s_a3b1 → list keys + dashboard
  'student.created': [
    { kind: 'pattern', tagSetKey: 'v1:t:{tid}:students:list:__keys__' },
    { kind: 'pattern', tagSetKey: 'v1:t:{tid}:dashboard:__deps__' },
    { kind: 'key', key: 'v1:t:{tid}:dashboard:blob' },
  ],
  // student.deleted:s_a3b1 → same as updated
  'student.deleted': [
    { kind: 'key', key: 'v1:t:{tid}:student:rec:{0}' },
    { kind: 'pattern', tagSetKey: 'v1:t:{tid}:students:list:__keys__' },
    { kind: 'key', key: 'v1:t:{tid}:dashboard:blob' },
  ],
  // student.feerate.changed:s_a3b1 → feerate, feerate history, expected, dashboard
  'student.feerate.changed': [
    { kind: 'key', key: 'v1:t:{tid}:student:rec:{0}:feerate' },
    { kind: 'key', key: 'v1:t:{tid}:student:rec:{0}:feerate:history' },
    { kind: 'pattern', tagSetKey: 'v1:t:{tid}:student:rec:{0}:expected:__keys__' },
    { kind: 'pattern', tagSetKey: 'v1:t:{tid}:dashboard:__deps__' },
    { kind: 'key', key: 'v1:t:{tid}:dashboard:blob' },
  ],
  // ledger.entry.posted:s_a3b1 → balance, entries, expected, dashboard
  'ledger.entry.posted': [
    { kind: 'key', key: 'v1:t:{tid}:ledger:balance:{0}' },
    { kind: 'pattern', tagSetKey: 'v1:t:{tid}:ledger:entries:__keys__' },
    { kind: 'pattern', tagSetKey: 'v1:t:{tid}:student:rec:{0}:expected:__keys__' },
    { kind: 'key', key: 'v1:t:{tid}:dashboard:blob' },
  ],
  // attendance.marked:b_math10a:20260711 → roster, stats, dashboard
  'attendance.marked': [
    { kind: 'key', key: 'v1:t:{tid}:attend:roster:{0}:{1}' },
    { kind: 'pattern', tagSetKey: 'v1:t:{tid}:attend:stats:__keys__' },
    { kind: 'key', key: 'v1:t:{tid}:dashboard:blob' },
  ],
};

/**
 * Interpolate a template like `v1:t:{tid}:student:rec:{0}` against an event.
 *
 * @complexity O(L) where L is the template length. Bounded, so O(1).
 */
function interpolate(tpl: string, ev: Event): string {
  // Use split+join instead of replaceAll so the file compiles under ES2017
  // (replaceAll requires ES2021+). The template has at most one occurrence of
  // each placeholder, so this is equivalent.
  return tpl
    .split('{tid}').join(ev.tutorId)
    .split('{0}').join(ev.args[0] ?? '')
    .split('{1}').join(ev.args[1] ?? '')
    .split('{2}').join(ev.args[2] ?? '');
}

/**
 * A small, structured invalidation log entry. The invalidator records one per
 * event processed; the gateway audit-log appender samples these into the audit
 * stream (spec 21 §15.3 shows the format).
 */
export interface InvalidationLogEntry {
  readonly event: Event;
  readonly steps: number;
  readonly keysDeleted: number;
  readonly durationMs: number;
}

/**
 * The cache invalidator. Subscribes to an event bus, applies the rule map,
 * delegates to `CacheAside` for the actual DELs.
 *
 * Construction:
 *   const bus = new EventEmitter();
 *   const invalidator = new Invalidator({ cache, bus, rules: DEFAULT_INVALIDATION_RULES });
 *   invalidator.start();
 *
 * The web agent will replace `EventEmitter` with a Redis Streams consumer.
 */
export class Invalidator {
  private readonly cache: CacheAside;
  private readonly bus: EventEmitter;
  private readonly rules: Readonly<Record<string, InvalidationRule>>;
  private readonly log: (e: InvalidationLogEntry) => void;
  private started = false;
  private readonly handler: (ev: Event) => Promise<void>;

  constructor(opts: {
    cache: CacheAside;
    bus: EventEmitter;
    rules?: Readonly<Record<string, InvalidationRule>>;
    log?: (e: InvalidationLogEntry) => void;
  }) {
    this.cache = opts.cache;
    this.bus = opts.bus;
    this.rules = opts.rules ?? DEFAULT_INVALIDATION_RULES;
    this.log = opts.log ?? (() => undefined);
    this.handler = (ev) => this.handle(ev);
  }

  /**
   * Start listening. Idempotent.
   *
   * @complexity O(1).
   */
  start(): void {
    if (this.started) return;
    this.bus.on('cache-event', this.handler as (ev: Event) => void);
    this.started = true;
  }

  /**
   * Stop listening. Idempotent.
   *
   * @complexity O(1).
   */
  stop(): void {
    if (!this.started) return;
    this.bus.off('cache-event', this.handler as (ev: Event) => void);
    this.started = false;
  }

  /**
   * Publish an event into the bus. This is the call site that microservices
   * use after committing a mutation (via the outbox drainer). The invalidator
   * receives it asynchronously.
   *
   * @complexity O(1) (event-bus emit is O(subscribers) = O(1) here).
   */
  publish(ev: Event): void {
    this.bus.emit('cache-event', ev);
  }

  /**
   * Process one event: look up the rule, execute each step, log the result.
   *
   * Exposed publicly so unit tests can drive the invalidator synchronously
   * without an event bus.
   *
   * @complexity O(R × K) where R = number of steps in the rule (bounded, ~3-5)
   *   and K = keys per tag set (bounded, ~10-50). So O(1) in practice. The
   *   per-step work is O(1) (DEL) or O(K) (invalidatePattern).
   */
  async handle(ev: Event): Promise<void> {
    const rule = this.rules[ev.name];
    if (rule === undefined) {
      // Unknown event — no-op. (The spec lists every event we care about.)
      return;
    }
    const t0 = Date.now();
    let keysDeleted = 0;
    for (const step of rule) {
      if (step.kind === 'key') {
        const key = interpolate(step.key, ev);
        await this.cache.invalidate(key);
        keysDeleted += 1; // DEL on a missing key returns 0, but we count intent.
      } else {
        const tagSetKey = interpolate(step.tagSetKey, ev);
        keysDeleted += await this.cache.invalidatePattern(tagSetKey);
      }
    }
    const entry: InvalidationLogEntry = {
      event: ev,
      steps: rule.length,
      keysDeleted,
      durationMs: Date.now() - t0,
    };
    this.log(entry);
  }
}

// ---------------------------------------------------------------------------
// Self-test — runs with `bun run <this-file>`.
// ---------------------------------------------------------------------------

if (import.meta.main) {
  // Use the in-memory CacheAside so we don't need a live Redis.
  const { CacheAside } = await import('./cache-aside.ts');
  const cache = new CacheAside({ forceInMemory: true });
  const bus = new EventEmitter();

  const log: InvalidationLogEntry[] = [];
  const invalidator = new Invalidator({
    cache,
    bus,
    log: (e) => log.push(e),
  });
  invalidator.start();

  // Pre-populate some keys + tag-sets so the invalidator has something to DEL.
  await cache.set('v1:t:t_7:student:rec:s_a3b1', { name: 'Aarav' }, 60);
  await cache.set('v1:t:t_7:dashboard:blob', { kpis: {} }, 60);
  await cache.tagKey('v1:t:t_7:students:list:__keys__', 'v1:t:t_7:students:list:page:1:sort:name');
  await cache.tagKey('v1:t:t_7:students:list:__keys__', 'v1:t:t_7:students:list:page:2:sort:name');
  await cache.tagKey('v1:t:t_7:dashboard:__deps__', 'v1:t:t_7:ledger:balance:s_a3b1');

  // Fire a student.updated event.
  invalidator.publish({ name: 'student.updated', args: ['s_a3b1'], tutorId: 't_7' });

  // Wait a tick for the async handler.
  await new Promise((r) => setTimeout(r, 20));

  console.log('=== invalidation log ===');
  for (const e of log) {
    console.log(
      `  ${e.event.name}:${e.event.args.join(':')}  steps=${e.steps}  keysDeleted=${e.keysDeleted}  ${e.durationMs}ms`,
    );
  }

  console.log('\n=== ledger.entry.posted (with arg interpolation) ===');
  invalidator.publish({ name: 'ledger.entry.posted', args: ['s_a3b1'], tutorId: 't_7' });
  await new Promise((r) => setTimeout(r, 20));
  for (const e of log.slice(-1)) {
    console.log(
      `  ${e.event.name}:${e.event.args.join(':')}  keysDeleted=${e.keysDeleted}`,
    );
  }

  invalidator.stop();
}
