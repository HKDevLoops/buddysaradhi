// Implements: 10_Security.md §7 (a tenant-scoped endpoint that cannot be made
// to stop is not scoped) + 17_API_Gateway_System.md §4 (the GraphQL read surface
// is scoped to one tenant and rate-limited per REQUEST) + AGENTS.md §2 Rule 9
// (a query the gateway refuses is refused with a typed error naming the limit —
// never silently truncated, never left to run to completion).
//
// ── Why this hand-rolled executor carries its own limits ───────────────────────
// `graphql` and graphql-yoga both crash the Supabase Edge function at boot (see
// `graphql/index.ts:7-10`), so the executor is hand-written. That means the two
// defences a real GraphQL server gets for free — a depth limit and a
// cost/complexity budget — have to be written by hand as well, and were not.
// Three holes, all reachable from ONE authenticated `POST /graphql`:
//
//   1. NO DEPTH CEILING. `tokenizeSelection` recursed on `{` with nothing above
//      it, and each level re-slices the rest of the string, so a body of N
//      nested braces cost O(N²) to tokenise before a single row was read.
//   2. NO TOP-LEVEL FIELD CAP and NO DE-DUPLICATION. `{students{…}}` repeated
//      ~30 000 times ran the resolver 30 000 times. `students` issues TWO
//      statements (`resolvers.ts:71-74` — the page and the count), so that is
//      ~60 000 SQLite round trips inside one request — behind a rate limiter that
//      was consulted ONCE, before any of it began.
//   3. SEQUENTIAL EXECUTION. The `for` loop awaited each resolver in turn, so
//      those round trips were serialised rather than concurrent: an amplifier
//      that was also a wall-clock one.
//
// The four things below close all three at once, and de-duplication is what
// makes the field cap cheap — see `MAX_TOP_LEVEL_FIELDS`.
import type { DB } from "../lib/db.ts";
import { resolvers } from "./resolvers.ts";

interface Field {
  name: string;
  args: Record<string, unknown>;
  selection: Field[];
}

/**
 * How deeply a selection set may nest. Top-level fields are depth 1, so the
 * schema's deepest reachable path is depth 3:
 *
 *   Query.students → StudentPage.items → Student.name
 *
 * (`graphql/schema.ts` — the whole schema is three types deep from `Query`.) A
 * limit of 8 therefore refuses nothing the declared schema can express and
 * leaves five levels of headroom before it must be revisited. It is a REAL
 * limit, not a formality: the tokenizer slices the remaining string at each
 * level, so without a ceiling a body of N braces costs O(N²) to parse — the
 * parse, not the query, becomes the denial of service.
 */
export const MAX_SELECTION_DEPTH = 8;

/**
 * How many top-level fields one query may name. `type Query` in
 * `graphql/schema.ts` declares FOUR (`health`, `settings`, `students`,
 * `ledgerEntries`), so 16 is four times the widest thing the schema can say —
 * enough headroom that growing the schema never forces this number to move
 * under a shipped client, and small enough that one request can drive at most
 * 16 resolvers (~32 statements at two per resolver, against the ~60 000 the
 * uncapped loop permitted).
 *
 * This bounds the field count, NOT the response size. `students` and
 * `ledgerEntries` are already capped at 200 rows by `clampPage` in
 * `resolvers.ts`, so a legal query's payload is bounded independently of this.
 */
export const MAX_TOP_LEVEL_FIELDS = 16;

/**
 * A query refused BEFORE it reaches the database, because the query TEXT itself
 * exceeds one of the two caps above. Carries the repo-wide `CODE: detail`
 * prefix so it reads like every other typed gateway refusal (`lib/errors.ts`
 * `sanitizeError`; the web dispatch key in `apps/web/src/lib/app-errors.ts`).
 *
 * It is REPORTED in the GraphQL `errors` envelope rather than thrown, and the
 * split is deliberate:
 *
 *   - A LIMIT is a fact about the request, known before execution begins. It is
 *     returned with NO `data` key at all, so a caller cannot mistake it for a
 *     partial success and read the absence of fields as "nothing to report".
 *   - A RESOLVER failure still THROWS, exactly as it always has — `execLocal`
 *     rejecting is the existing contract (`__tests__/graphql.test.ts` asserts
 *     `rejects.toThrow("forbidden: tenant mismatch")`), and quietly turning that
 *     into a 200 is precisely the silent failure AGENTS.md §2 Rule 9 exists to
 *     prevent.
 *
 * Known limitation, reported rather than worked around: both entrypoints that
 * call this (`apps/gateway/index.ts:334` and `graphql/index.ts:425`) hardcode
 * HTTP 200 for the envelope, so a refusal arrives as `200 {errors:[…]}` — the
 * GraphQL-over-HTTP "request error" shape — rather than a `400`. Changing the
 * status means editing `apps/gateway/index.ts`, which is not this file and is
 * owned elsewhere.
 */
export class GraphQLLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphQLLimitError";
  }
}

function parseArgs(argStr: string, variables: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let i = 0;
  while (i < argStr.length) {
    while (i < argStr.length && /[\s,]/.test(argStr[i])) i++;
    if (i >= argStr.length) break;
    let key = "";
    while (i < argStr.length && argStr[i] !== ":") {
      key += argStr[i];
      i++;
    }
    i++;
    while (i < argStr.length && /\s/.test(argStr[i])) i++;
    let val = "";
    while (i < argStr.length && argStr[i] !== "," && argStr[i] !== ")") {
      val += argStr[i];
      i++;
    }
    val = val.trim();
    if (val.startsWith("$")) out[key] = variables[val.slice(1)];
    else if (val.startsWith('"') || val.startsWith("'")) out[key] = val.slice(1, -1);
    else if (val === "true") out[key] = true;
    else if (val === "false") out[key] = false;
    else if (val !== "") out[key] = Number(val);
  }
  return out;
}

/**
 * Parse one selection set.
 *
 * `variables` is threaded through to `parseArgs` — see the note in `execLocal`
 * about `$var` in an argument position. `depth` is the depth of the fields being
 * produced here, so the first call is depth 1 and both caps are enforced on the
 * way IN rather than on the finished tree.
 */
function tokenizeSelection(
  s: string,
  variables: Record<string, unknown>,
  depth: number,
): Field[] {
  const fields: Field[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    let name = "";
    while (i < s.length && !/[\s({]/.test(s[i])) {
      name += s[i];
      i++;
    }
    let args: Record<string, unknown> = {};
    if (s[i] === "(") {
      let depth0 = 0;
      let j = i;
      for (; j < s.length; j++) {
        if (s[j] === "(") depth0++;
        else if (s[j] === ")") { depth0--; if (depth0 === 0) break; }
      }
      // The REAL variables, not `{}`. Previously a `$var` in an argument
      // position resolved to `undefined` and the caller had to pass the
      // argument as a top-level variable with the argument's own name to make
      // it work at all — see the `execLocal` note.
      args = parseArgs(s.slice(i + 1, j), variables);
      i = j + 1;
    }
    let selection: Field[] = [];
    if (s[i] === "{") {
      let braceDepth = 0;
      let j = i;
      for (; j < s.length; j++) {
        if (s[j] === "{") braceDepth++;
        else if (s[j] === "}") { braceDepth--; if (braceDepth === 0) break; }
      }
      // Refuse BEFORE recursing, so the refusal costs one comparison rather
      // than another O(length) slice of a body nobody will read.
      if (depth + 1 > MAX_SELECTION_DEPTH) {
        throw new GraphQLLimitError(
          `QUERY_TOO_DEEP: selection nesting exceeds the depth limit of ` +
            `${MAX_SELECTION_DEPTH}. The declared schema is 3 deep from Query.`,
        );
      }
      selection = tokenizeSelection(s.slice(i + 1, j), variables, depth + 1);
      i = j + 1;
    }
    // Top level only: a nested selection set is bounded by its parent's field
    // names, which the schema fixes. Enforced HERE, on the 17th field, rather
    // than after the parse — a 30 000-field body must not get to build 30 000
    // objects before it is refused.
    if (depth === 1 && fields.length >= MAX_TOP_LEVEL_FIELDS) {
      throw new GraphQLLimitError(
        `QUERY_TOO_COMPLEX: more than ${MAX_TOP_LEVEL_FIELDS} top-level fields. ` +
          `The declared schema has 4.`,
      );
    }
    fields.push({ name, args, selection });
  }
  return fields;
}

function queryBody(query: string): string {
  const first = query.indexOf("{");
  if (first === -1) return query;
  let depth = 0;
  let end = -1;
  for (let k = first; k < query.length; k++) {
    if (query[k] === "{") depth++;
    else if (query[k] === "}") { depth--; if (depth === 0) { end = k; break; } }
  }
  return query.slice(first + 1, end);
}

function project(field: Field, value: unknown): unknown {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map((v) => project(field, v));
  if (typeof value !== "object") return value;
  if (!field.selection.length) return value;
  const out: Record<string, unknown> = {};
  for (const sub of field.selection) {
    out[sub.name] = project(sub, (value as Record<string, unknown>)[sub.name]);
  }
  return out;
}

/**
 * A canonical string for one field's EFFECTIVE arguments, so two occurrences of
 * the same field with the same arguments share one resolver call.
 *
 * Keys are sorted at every level because `JSON.stringify` preserves insertion
 * order — otherwise the same call written `{page:1}` and `{search:null,page:1}`
 * would miss and re-run work already done. The value is parsed from JSON and so
 * is acyclic by construction; `JSON.stringify` cannot throw on a cycle here.
 */
function canonicalArgs(value: Record<string, unknown>): string {
  return JSON.stringify(value, (_key: string, val: unknown): unknown =>
    val !== null && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(
        Object.entries(val as Record<string, unknown>).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0
        ),
      )
      : val,
  );
}

export interface GraphQLResult {
  data?: Record<string, unknown>;
  errors?: { message: string }[];
}

/** One top-level field, and the promise that will produce its value. `promise`
 *  is `null` for a field no resolver claims, which the old loop answered with
 *  `null` without doing any work and still does. */
interface Slot {
  field: Field;
  promise: Promise<unknown> | null;
}

export async function execLocal(
  query: string,
  variables: Record<string, unknown>,
  ctx: { db: DB; tenantId: string | null },
): Promise<GraphQLResult> {
  // ── Parse, and refuse an over-budget query here ────────────────────────────
  // Both caps live in the tokenizer, so a query that exceeds either is refused
  // on its 17th field or its 9th brace — before any statement is built and long
  // before any statement runs.
  let top: Field[];
  try {
    top = tokenizeSelection(queryBody(query), variables, 1);
  } catch (err) {
    if (err instanceof GraphQLLimitError) return { errors: [{ message: err.message }] };
    throw err;
  }

  // ── Resolve each DISTINCT (field, arguments) pair once ─────────────────────
  //
  // `$var` in an argument position used to resolve to `undefined`: `parseArgs`
  // was called with `{}`, and the caller's variables were merged over the parsed
  // arguments afterwards. So `students(tenantId: $t)` saw `args.tenantId ===
  // undefined` and every resolver guard (`resolvers.ts:28,68,101`,
  // `args.tenantId !== ctx.tenantId`) was satisfied — or not — by a top-level
  // variable of the same NAME rather than by the query text. The variable merge
  // below is kept, because it is the only shape some existing callers use, but
  // `$var` now resolves properly, so the guard finally reads the argument the
  // query actually wrote.
  //
  // Isolation is unchanged and still does not depend on that guard: every
  // statement is built from `ctx.tenantId`, which comes from the verified JWT
  // (`apps/gateway/index.ts:391`, `graphql/index.ts:391`). A caller can only
  // ever satisfy `args.tenantId` with its OWN id.
  //
  // De-duplication is keyed on the EFFECTIVE arguments — what the resolver is
  // actually handed — so two occurrences that would receive the same object
  // share one call, and two that would receive different objects do not.
  //
  // Every resolver in `resolvers.ts` is a read (`health` resolves a constant;
  // the other three issue SELECTs against `ctx.db`), so running the distinct
  // ones concurrently is safe: there is no transaction, no write, and nothing
  // for one to observe mid-flight in another. The libSQL client takes concurrent
  // `execute` calls on one handle.
  const slots: Slot[] = [];
  const inFlight = new Map<string, Promise<unknown>>();
  for (const f of top) {
    const resolver = resolvers[f.name];
    if (!resolver) {
      slots.push({ field: f, promise: null });
      continue;
    }
    const effective: Record<string, unknown> = { ...f.args, ...variables };
    const key = `${f.name}|${canonicalArgs(effective)}`;
    let promise = inFlight.get(key);
    if (!promise) {
      promise = resolver(effective, ctx);
      inFlight.set(key, promise);
    }
    slots.push({ field: f, promise });
  }

  // Await all of them, but settle each one individually so a single rejection
  // cannot become an unhandled rejection while the others are still in flight.
  const settled = await Promise.all(
    slots.map(async (slot): Promise<{ ok: true; value: unknown } | { ok: false; err: unknown }> => {
      if (slot.promise === null) return { ok: true, value: null };
      try {
        return { ok: true, value: await slot.promise };
      } catch (err) {
        return { ok: false, err };
      }
    }),
  );

  // Re-throw the FIRST failure IN FIELD ORDER, not whichever rejected first in
  // wall-clock time. That is what the old `for … await` loop did, so a query
  // whose second field fails still reports the second field's error and not
  // whichever sibling happened to reject first under concurrency.
  const data: Record<string, unknown> = {};
  for (let i = 0; i < slots.length; i += 1) {
    const outcome = settled[i];
    const slot = slots[i];
    // SAFETY: `Promise.all` resolves to exactly one entry per input, in order,
    // so `settled[i]` and `slots[i]` are both defined for every `i < slots.length`.
    if (!outcome || !slot) break;
    if (!outcome.ok) throw outcome.err;
    data[slot.field.name] = project(slot.field, outcome.value);
  }
  return { data };
}
