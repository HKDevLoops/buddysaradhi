// Implements: 21_Redis_Caching_Layer.md §3 — cache key taxonomy and grammar.
//
// Every cache key in Buddysaradhi follows the grammar:
//   v1:t:{tutorId}:{domain}:{entity}[:{entityId}][:{subview}][:{param}:{value}]*
//
// The grammar is the contract: a key that does not match is a bug. The tutorId
// prefix enforces tenant isolation (a tutor can never read another tutor's
// cached data because the key space is namespaced). The `v1:` prefix is the
// schema-version tag — bump to `v2:` when the payload shape changes; old keys
// expire naturally by TTL.
//
// This module is pure TypeScript with no deps. The web agent should copy it
// verbatim into `src/lib/cache/key-builder.ts`.

/**
 * The cacheable domains (one per microservice).
 *
 * Maps to the `domain` segment of the key grammar: `v1:t:{tid}:{domain}:...`.
 */
export type CacheDomain =
  | 'students' // student-svc
  | 'student' // single-student record
  | 'ledger' // ledger-svc
  | 'attend' // attendance-svc
  | 'dashboard' // composed dashboard blob
  | 'search' // search-svc query-result cache
  | 'report'; // report-svc artefact cache

/**
 * A cacheable entity within a domain. Examples: `list`, `balance`, `entries`,
 * `roster`, `stats`, `q` (for search queries).
 */
export type CacheEntity = string;

/**
 * Ordered list of `param:value` pairs. We use an array (not a Record) because
 * the grammar requires deterministic ordering — `{param}:{value}` pairs appear
 * in the order they were added, and two semantically equal keys must produce
 * byte-identical strings.
 */
export type CacheParams = ReadonlyArray<readonly [string, string | number]>;

/**
 * The full set of inputs to `buildKey`. All fields except `tutorId`, `domain`,
 * and `entity` are optional and map directly to optional segments of the grammar.
 */
export interface CacheKey {
  tutorId: string;
  domain: CacheDomain;
  entity: CacheEntity;
  entityId?: string;
  subview?: string;
  params?: CacheParams;
}

/**
 * The schema-version prefix. Bumped to `v2:` when the cached payload shape
 * changes in a backward-incompatible way. Old `v1:` keys expire by TTL; no
 * coordinated flush is needed.
 */
const KEY_VERSION = 'v1';

/**
 * Validate a segment: must be non-empty, alphanumeric + a small punctuation set.
 * The set matches what Redis keys typically contain (`:`, `_`, `-`, `.`).
 * This is defence-in-depth against a key-injection bug producing a malformed
 * key (e.g. `entityId` containing a stray `:` would corrupt the grammar).
 *
 * @complexity O(L) where L is the segment length — bounded, so O(1).
 */
function validateSegment(name: string, value: string): void {
  if (value.length === 0) {
    throw new Error(`buildKey: ${name} must be non-empty`);
  }
  // Allow letters, digits, underscore, dash, dot, and a few date/score chars.
  // Disallow `:` (would break grammar parsing) and whitespace.
  if (!/^[A-Za-z0-9_./+-]+$/.test(value)) {
    throw new Error(
      `buildKey: ${name}="${value}" contains illegal chars (allowed: A-Z a-z 0-9 _ . / + -)`,
    );
  }
}

/**
 * Build a cache key matching the grammar:
 *   v1:t:{tutorId}:{domain}:{entity}[:{entityId}][:{subview}][:{param}:{value}]*
 *
 * The `t:` prefix on tutorId is added by this function — callers pass the bare
 * tutorId (`t_7`), the returned key starts with `v1:t:t_7:...`.
 *
 * @complexity O(L) where L is the total key length. Bounded by the schema
 *   (entityId ≤ 36 chars, params ≤ 4 pairs), so O(1) in practice.
 */
export function buildKey(k: CacheKey): string {
  validateSegment('tutorId', k.tutorId);
  validateSegment('domain', k.domain);
  validateSegment('entity', k.entity);

  const parts: string[] = [KEY_VERSION, 't', k.tutorId, k.domain, k.entity];

  if (k.entityId !== undefined) {
    validateSegment('entityId', k.entityId);
    parts.push(k.entityId);
  }
  if (k.subview !== undefined) {
    validateSegment('subview', k.subview);
    parts.push(k.subview);
  }
  if (k.params !== undefined) {
    for (const [param, value] of k.params) {
      validateSegment('param', param);
      const valStr = String(value);
      validateSegment('value', valStr);
      parts.push(param, valStr);
    }
  }
  return parts.join(':');
}

/**
 * Convenience overload: positional arguments for the common case.
 * Equivalent to `buildKey({ tutorId, domain, entity, entityId, subview, params })`.
 *
 * @complexity O(L) = O(1) (see {@link buildKey}).
 */
export function buildKeyPos(
  tutorId: string,
  domain: CacheDomain,
  entity: CacheEntity,
  entityId?: string,
  subview?: string,
  params?: CacheParams,
): string {
  return buildKey({ tutorId, domain, entity, entityId, subview, params });
}

/**
 * The kind of key-tag set to look up. Per spec 21 §5.3:
 *  - `__keys__` — a Redis SET of all keys belonging to one invalidation group
 *    (e.g. all `students:list:*` page keys). Used by the invalidator to DEL
 *    them in O(K) instead of O(N) SCAN.
 *  - `__deps__` — a Redis SET of keys that a composed cache value depends on
 *    (e.g. the Dashboard blob depends on 6 underlying service calls). Used to
 *    cascade-invalidate the composed value when any underlying key changes.
 */
export type KeyTagKind = '__keys__' | '__deps__';

/**
 * Build the name of a key-tag SET for a given pattern prefix.
 *
 * Example: `keyTagSet('v1:t:t_7:students:list', '__keys__')`
 *       → `'v1:t:t_7:students:list:__keys__'`
 *
 * The returned string is itself a Redis key (a SET). The invalidator reads it
 * with `SMEMBERS` (O(K)) and then `DEL`s each member + the SET itself.
 *
 * @complexity O(L) = O(1) (string concat, bounded length).
 */
export function keyTagSet(patternPrefix: string, kind: KeyTagKind): string {
  if (patternPrefix.length === 0) {
    throw new Error('keyTagSet: patternPrefix must be non-empty');
  }
  // Strip a trailing `:*` if the caller passed a glob (common when copying from
  // a SCAN-style rule). The tag set is namespaced under the prefix-without-glob.
  const stripped = patternPrefix.endsWith(':*')
    ? patternPrefix.slice(0, -2)
    : patternPrefix;
  return `${stripped}:${kind}`;
}

/**
 * The distributed-lock key for a cache value (spec 21 §6). Used for SWR
 * background-refresh dedup and report-job dedup.
 *
 * @complexity O(L) = O(1).
 */
export function lockKey(cacheKey: string): string {
  return `${cacheKey}:__lock__`;
}

// ---------------------------------------------------------------------------
// Self-test — runs with `bun run <this-file>`.
// ---------------------------------------------------------------------------

if (import.meta.main) {
  // Examples straight out of spec 21 §3.
  const examples: CacheKey[] = [
    { tutorId: 't_7', domain: 'students', entity: 'list', params: [['page', 1], ['sort', 'name']] },
    { tutorId: 't_7', domain: 'student', entity: 'rec', entityId: 's_a3b1' },
    { tutorId: 't_7', domain: 'student', entity: 'rec', entityId: 's_a3b1', subview: 'feerate' },
    {
      tutorId: 't_7',
      domain: 'student',
      entity: 'rec',
      entityId: 's_a3b1',
      subview: 'expected',
      params: [['period', 'month'], ['month', '202607']],
    },
    { tutorId: 't_7', domain: 'ledger', entity: 'balance', entityId: 's_a3b1' },
    { tutorId: 't_7', domain: 'ledger', entity: 'entries', params: [['since', '20260701'], ['page', 1]] },
    { tutorId: 't_7', domain: 'attend', entity: 'roster', entityId: 'b_math10a', subview: '20260711' },
    { tutorId: 't_7', domain: 'attend', entity: 'stats', params: [['range', 'month'], ['month', '202607']] },
    { tutorId: 't_7', domain: 'dashboard', entity: 'blob' },
    { tutorId: 't_7', domain: 'search', entity: 'q', entityId: 'a1b2c3', params: [['topK', 10]] },
  ];

  console.log('=== buildKey examples (spec 21 §3 grammar) ===');
  for (const k of examples) {
    console.log(`  ${buildKey(k)}`);
  }

  console.log('\n=== keyTagSet (spec 21 §5.3) ===');
  console.log(`  students:list  →  ${keyTagSet('v1:t:t_7:students:list', '__keys__')}`);
  console.log(`  dashboard      →  ${keyTagSet('v1:t:t_7:dashboard', '__deps__')}`);
  console.log(`  search:q:*     →  ${keyTagSet('v1:t:t_7:search:q:*', '__keys__')}`);

  console.log('\n=== lockKey (spec 21 §6) ===');
  console.log(`  ${lockKey(buildKey({ tutorId: 't_7', domain: 'dashboard', entity: 'blob' }))}`);

  // Error cases.
  console.log('\n=== validation ===');
  const badCases: Array<[string, CacheKey]> = [
    ['empty tutorId', { tutorId: '', domain: 'student', entity: 'rec' }],
    ['colon in entityId', { tutorId: 't_7', domain: 'student', entity: 'rec', entityId: 's:evil' }],
    ['space in param', { tutorId: 't_7', domain: 'student', entity: 'rec', params: [['foo', 'has space']] }],
  ];
  for (const [label, k] of badCases) {
    try {
      buildKey(k);
      console.log(`  ✗ ${label}: should have thrown`);
    } catch (e) {
      console.log(`  ✓ ${label}: rejected — ${(e as Error).message}`);
    }
  }
}
