// Implements: AGENTS.md §3.4 (every runtime DB access goes through the
// ORM-style handle; no raw-SQL escape hatch in app code) + Rule 9
// (12_Business_Rules.md / 10_Security.md — typed errors, no silent failure).
//
// This module holds the *transport-independent* half of lib/db.ts: the
// statement helpers (`run`/`allRows`/`oneRow`/`batchExecute`), the Turso
// endpoint/token resolvers and the raw-pipeline fallback. It deliberately does
// NOT import `@libsql/client` (a Deno/edge ESM dependency that vitest cannot
// resolve from the repo root), so `lib/orm.ts`, `lib/ledger-chain.ts` and
// `routes/ledger.ts` can be exercised in integration tests against a real
// SQLite handle. `lib/db.ts` keeps the `@libsql/client` connection factory and
// re-exports these helpers, so no caller changes behaviour.

/** The minimal handle every statement helper needs — `Client`, an interactive
 * `Transaction`, or the SQLite test adapter all satisfy it structurally.
 *
 * The statement parameter is `unknown` on purpose: libsql's own
 * `InStatement = string | { sql; args: InArgs }` is neither a super- nor a
 * sub-type of `{ sql; args?: unknown[] }`, so a narrower parameter would make
 * every `Client` call site fail to type-check. `run()` is the only place that
 * builds a statement, and it always builds `{ sql, args }`. */
import { z } from "zod";

export interface SqlHandle {
  execute(stmt: unknown): Promise<{
    rows?: Record<string, unknown>[];
    rowsAffected?: number;
  }>;
}

/** A parameterized statement built by an audited builder below. Callers
 * execute it via `run`/`allRows`/`oneRow` — they never interpolate values. */
export interface BuiltStatement {
  sql: string;
  args: unknown[];
}

export function resolveTursoUrl(url?: string): string {
  if (
    url &&
    (url.startsWith("libsql://") ||
      url.startsWith("https://") ||
      url.startsWith("http://")) &&
    !url.includes("supabase.co") &&
    !url.includes("gmqwdnvbfnwpzpctwvho")
  ) {
    return url;
  }
  const envUrl =
    typeof Deno !== "undefined" ? Deno.env.get("TURSO_DATABASE_URL") : undefined;
  if (
    envUrl &&
    (envUrl.startsWith("libsql://") ||
      envUrl.startsWith("https://") ||
      envUrl.startsWith("http://"))
  ) {
    return envUrl;
  }
  throw new Error(
    "TURSO_DATABASE_URL is required but not configured. " +
      "Set TURSO_DATABASE_URL in your environment secrets (Supabase dashboard → Edge Functions → Secrets)."
  );
}

export function resolveToken(dbToken?: string): string {
  const envToken =
    typeof Deno !== "undefined"
      ? Deno.env.get("TURSO_AUTH_TOKEN") || Deno.env.get("TURSO_TOKEN")
      : undefined;
  if (dbToken && dbToken.length > 20) return dbToken;
  if (envToken && envToken.length > 20) return envToken;
  // No hardcoded fallback — fail loudly in production per Rule 9 (no silent failures)
  throw new Error(
    "TURSO_AUTH_TOKEN is required but not configured. " +
      "Set TURSO_AUTH_TOKEN in your environment secrets (Supabase dashboard → Edge Functions → Secrets)."
  );
}

/** An interactive `Transaction` is identified by its commit/rollback pair.
 * We probe structurally instead of importing the type so this module stays
 * dependency-free (see the header comment). */
type MaybeTransaction = SqlHandle & { commit?: unknown; rollback?: unknown };

function isInteractiveTransaction(db: SqlHandle): boolean {
  const candidate = db as MaybeTransaction;
  // SAFETY: structural capability probe only — no value is reinterpreted.
  return (
    typeof candidate.commit === "function" &&
    typeof candidate.rollback === "function"
  );
}

/**
 * Budget for ONE statement against the tenant database (GW-10).
 *
 * WHY A BUDGET. The tenant database's location is caller-supplied
 * (`x-db-url`), so a host that accepts the connection and then never answers
 * held the request open until the platform's own limit — the audit measured a
 * dial to an unreachable host that never returned. `@libsql/client`'s only
 * timeout option is documented as a busy timeout for LOCAL `file:` databases
 * ("remote clients ignore it"), so there is no client-side knob to turn: the
 * bound has to live in the gateway's own statement layer.
 *
 * 8 s matches the budget `batchExecute` already applies to the schema heal's
 * pipeline POST, and it sits inside the web client's own 12 s abort, so a
 * refused statement still answers before the caller gives up.
 */
export const STATEMENT_TIMEOUT_MS = 8000;

/**
 * Typed error for a statement that did not answer inside the budget.
 *
 * The message carries a dispatch code so the server-side log is greppable
 * (10_Security.md §8). It says what happened and nothing about the database,
 * the tenant or the statement's values.
 */
export class StatementTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(
      `TENANT_DB_TIMEOUT: the tenant database did not answer a statement within ${timeoutMs}ms`,
    );
    this.name = "StatementTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Stop WAITING for a statement that outruns its budget.
 *
 * WHAT THIS DOES AND DOES NOT DO. The request stops waiting and the caller
 * gets a typed error; the statement itself is NOT cancelled — the database may
 * still be executing it, and the abandoned promise settles later. That is the
 * honest limit of a bound placed above the driver: the gateway can refuse to
 * hang, it cannot un-send a statement.
 *
 * The abandoned promise keeps a rejection handler attached (Promise.race
 * subscribes to it), so a late failure is not an unhandled rejection.
 */
function withStatementBudget<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new StatementTimeoutError(timeoutMs)),
      timeoutMs,
    );
  });
  return Promise.race([work, budget]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export async function run(
  db: SqlHandle,
  sql: string,
  args: unknown[] = [],
  timeoutMs: number = STATEMENT_TIMEOUT_MS,
): Promise<{ rows: Record<string, unknown>[]; rowsAffected?: number }> {
  try {
    const res = await withStatementBudget(db.execute({ sql, args }), timeoutMs);
    return { rows: res.rows ?? [], rowsAffected: res.rowsAffected };
  } catch (err) {
    if (isInteractiveTransaction(db)) {
      // Rule 9 (no silent failures) + Rule 7 (BR-SYN-01): a failed statement
      // inside an open transaction must abort that transaction. Falling back
      // to the HTTP pipeline here would re-run the statement *outside* BEGIN,
      // escaping the atomicity the ledger routes depend on — the exact
      // "5 separate awaits, no transaction" defect audit 2026-09-26 G2.
      throw err;
    }
    // THE HTTP PIPELINE FALLBACK WAS REMOVED HERE, DELIBERATELY.
    //
    // It used to be: on any `db.execute` failure, re-issue the statement through
    // `directPipelineExecute(sql, args)` — which, called without `dbUrl`/
    // `dbToken`, resolves its target from the environment via
    // `resolveTursoUrl(undefined)` / `resolveToken(undefined)`, i.e.
    // `TURSO_DATABASE_URL` / `TURSO_TOKEN`.
    //
    // This gateway is multi-tenant: the database for a request comes from the
    // caller's `x-db-url`/`x-db-token`, bound by the HMAC in `lib/auth.ts`.
    // `TURSO_DATABASE_URL` is a DIFFERENT database — a single shared one. So the
    // fallback did not "retry", it RE-TARGETED: whenever the primary handle
    // failed for a transport reason (a dropped socket, a cold isolate, an 8s
    // abort) the statement was silently re-issued against the shared database.
    // On a multi-tenant deployment that is a cross-tenant write with no error,
    // no audit row and no `tenant_id` guarantee — the worst possible failure
    // direction for a fee-collection product, because it corrupts a tutor's
    // books rather than refusing the request.
    //
    // It could not be made safe in place: `SqlHandle` does not carry the URL it
    // was created with, so there is no way to prove the pipeline is pointed at
    // the same database. A control that cannot be verified must not be trusted
    // (10_Security.md fail-closed; BR-SEC-03).
    //
    // Failing closed is also the CLEARER outcome. The old path reported success
    // only when the retarget happened to work; when it did not, the operator
    // was shown `statement failed: <primary> (pipeline fallback: <fallback>)` —
    // a network error pointing away from the real cause. The primary error
    // alone is the honest one. `directPipelineExecute` had no other caller in
    // this module, and `db.execute` is the path every caller here is verified
    // against.
    throw err;
  }
}

export async function allRows(
  db: SqlHandle,
  sql: string,
  args: unknown[] = []
): Promise<Record<string, unknown>[]> {
  const res = await run(db, sql, args);
  return res.rows ?? [];
}

export async function oneRow(
  db: SqlHandle,
  sql: string,
  args: unknown[] = []
): Promise<Record<string, unknown> | null> {
  const rows = await allRows(db, sql, args);
  return rows[0] ?? null;
}

export async function batchExecute(
  stmts: string[],
  dbUrl?: string,
  dbToken?: string
): Promise<void> {
  let host = resolveTursoUrl(dbUrl);
  const token = resolveToken(dbToken);

  if (host.startsWith("libsql://")) {
    host = host.replace("libsql://", "https://");
  }

  // The pipeline protocol wants a bare `{"type":"close"}` as the final request;
  // typing `stmt` as optional avoids a cast on the array (AGENTS.md §6.1).
  const requests: { type: string; stmt?: { sql: string; args: never[] } }[] =
    stmts.map((sql) => ({
      type: "execute",
      stmt: { sql, args: [] },
    }));
  requests.push({ type: "close" });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  let res;
  try {
    res = await fetch(`${host}/v2/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({ requests }),
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Turso pipeline HTTP ${res.status}: ${errText}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Audited statement builders (fallback for Kysely — see worklog).
//
// Implements: AGENTS.md §3.4 + Rule 9 + 17_API_Gateway_System.md §5.
// All runtime SELECT/INSERT/UPDATE/DELETE is built HERE. Routes, lib and
// graphql call these builders and execute via `run`/`allRows`/`oneRow` —
// they never hold a SQL string literal. DDL stays in `lib/schema.ts`
// (authorized authority) and one-time `migrations/` (untouched).
//
// Discipline: every VALUE via `?` + args (today's `?` discipline preserved;
// LIMIT/OFFSET also via `?`, strengthening the old `${take}` interpolation);
// every IDENTIFIER (table/column/sort) via allowlist or audited regex;
// every input via Zod before any string is built (AGENTS.md §6.1).
// Integer paise untouched (pass-through); no ledger UPDATE/DELETE builder
// exists (Rule 1); outbox op strings unchanged (callers still pass the same
// literals to `recordOutbox`); transactions keep using `withWriteTransaction`
// (builders take whatever `SqlHandle` the caller holds — Client or open tx).
// ──────────────────────────────────────────────────────────────────────────

const TenantIdSchema = z.string().min(1).max(128);
const IdSchema = z.string().min(1).max(128);
const TableNameSchema = z.enum([
  "students",
  "batches",
  "tutors",
  "student_enrollments",
  "attendance_sessions",
  "attendance_records",
  "fee_plans",
  "fee_schedule_items",
  "invoices",
  "ledger_entries",
  "receipts",
  "settings",
  "notifications",
  "audit_log",
  "sync_outbox",
  "idempotency_keys",
]);
type TableName = z.infer<typeof TableNameSchema>;

/** Each table's primary-key column, read off the DDL in lib/schema.ts. Used as
 * the deterministic tie-break appended to every ORDER BY (see
 * `stmtSelectWhere`): a sort column is not unique (`first_name` repeats, so do
 * `balance_paise`, `status`, `category`), and SQLite is free to return tied rows
 * in any order across queries — which means the SAME row can appear on page 1
 * and page 2 of a LIMIT/OFFSET read. `settings` is keyed by `tenant_id`, not
 * `id` (lib/schema.ts:19); `idempotency_keys` has a composite key
 * (lib/schema.ts:331) and is never paged. */
const TABLE_PK: Readonly<Record<TableName, string>> = Object.freeze({
  students: "id",
  batches: "id",
  student_enrollments: "id",
  attendance_sessions: "id",
  attendance_records: "id",
  invoices: "id",
  ledger_entries: "id",
  receipts: "id",
  settings: "tenant_id",
  notifications: "id",
  audit_log: "id",
  sync_outbox: "id",
  idempotency_keys: "tenant_id",
} as Record<TableName, string>);

const ColumnRefSchema = z.string().regex(/^[a-z_][a-z0-9_]*$/).max(64);
const SortDirSchema = z.enum(["ASC", "DESC"]);
const LimitSchema = z.number().int().min(1).max(1000);
const OffsetSchema = z.number().int().min(0).max(100000);

function auditedCamelToSnake(key: string): string {
  const raw = key.length > 0 ? key : "";
  const snake = raw.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  const parsed = ColumnRefSchema.safeParse(snake);
  if (!parsed.success) {
    // Rule 9: an identifier that is not `[a-z_][a-z0-9_]*` is a loud throw —
    // never interpolated into SQL.
    throw new Error(`invalid column identifier: ${key}`);
  }
  return parsed.data;
}

function auditedTable(table: string): TableName {
  const parsed = TableNameSchema.safeParse(table);
  if (!parsed.success) throw new Error(`invalid table identifier: ${table}`);
  return parsed.data;
}

function auditedTenant(tenantId: string): string {
  const parsed = TenantIdSchema.safeParse(tenantId);
  if (!parsed.success) throw new Error("tenantId is required");
  return parsed.data;
}

/** The range vocabulary — the ONLY four comparison operators a `where` filter
 * may use, and the complete list.
 *
 * Operator names are INTERNAL literals, fixed at module load and frozen. A
 * caller picks one by using its object key (`{ balancePaise: { gt: 0 } }`); there
 * is no `op`/`operator` string anywhere in the interface, so no caller-supplied
 * operator name — nor a fragment of one — can reach the SQL string. The SQL text
 * is the value in this map and nothing else.
 *
 * Thresholds are bounded by `RangeThresholdSchema`: a date string (TEXT
 * `YYYY-MM-DD`, which sorts lexicographically — lib/schema.ts:95) or an INTEGER.
 * A float threshold is REJECTED so a money comparison can never introduce
 * floating-point drift into an integer-paise balance (Rule 6 / BR-M-01). */
const RANGE_CLAUSE: Readonly<Record<string, string>> = Object.freeze({
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
});
const RangeThresholdSchema = z.union([z.string().max(64), z.number().int()]);

/**
 * The one legal two-sided form: an INCLUSIVE window expressed as a single
 * `between` key holding both endpoints.
 *
 * Why this exists instead of letting callers write `{ gte: x, lte: y }`: the
 * builder's rule is one operator per column, and that rule is load-bearing —
 * it is what guarantees no caller-supplied SQL fragment ever reaches the query
 * (10_Security.md §11). A window needs BOTH bounds on ONE column, which a flat
 * one-key-per-column object cannot express, and loosening the rule to admit
 * `{ gte, lte }` would let ANY pair of operators through — `{ gt, like }`,
 * `{ gte, gte }` — reopening exactly the hole the rule closes.
 *
 * `between` is therefore an ALTERNATIVE to the four one-sided operators, never
 * a fifth one: a bag may be either exactly one key from `RANGE_CLAUSE`, or the
 * single key `between`. Both branches below append their own `?` placeholders,
 * so no endpoint is ever concatenated into SQL text — `BETWEEN ? AND ?` is
 * fixed text and both values remain bound parameters.
 *
 * Endpoints are validated by the same `RangeThresholdSchema` as every other
 * threshold, so a float still cannot reach a money comparison (Rule 6), and both
 * endpoints being `YYYY-MM-DD` strings keeps the window lexicographically exact.
 */
const BetweenWindowSchema = z.tuple([
  RangeThresholdSchema,
  RangeThresholdSchema,
]);

/** Audited `tenant_id = ? AND ...` builder (preserves `orm.ts buildWhere`
 * semantics byte-for-byte: `IS NULL` / `IS NOT NULL` / `!= ?` / `IN (?,..)` /
 * empty-IN `1=0` / `= ?`; `tenantId`/`tenant_id` keys skipped), plus the four
 * range comparisons above. Values via `?`; only audited column refs are
 * interpolated.
 *
 * Fail-closed: a `where` value that is an object of ANY other shape (including
 * a bare array, or `{ op: ">= 0 OR 1=1", value: 0 }`) THROWS rather than
 * degrading into `col = ?` with an object bound. "Accept and drop" is the defect
 * — a silently-widened filter is a wrong answer to a tutor, and an unrecognised
 * operator shape is exactly what an injection attempt looks like. */
export function buildTenantWhere(
  tenantId: string,
  where: Record<string, unknown> = {}
): BuiltStatement {
  const tenant = auditedTenant(tenantId);
  const clauses: string[] = ["tenant_id = ?"];
  const params: unknown[] = [tenant];
  for (const [key, val] of Object.entries(where ?? {})) {
    if (key === "tenantId" || key === "tenant_id") continue;
    const col = auditedCamelToSnake(key);
    if (val === null || val === undefined) {
      clauses.push(`${col} IS NULL`);
    } else if (typeof val === "object" && val !== null && "not" in (val as Record<string, unknown>)) {
      const notVal = (val as Record<string, unknown>).not;
      if (notVal === null || notVal === undefined) {
        clauses.push(`${col} IS NOT NULL`);
      } else {
        clauses.push(`${col} != ?`);
        params.push(notVal);
      }
    } else if (
      typeof val === "object" && val !== null && "in" in (val as Record<string, unknown>) &&
      Array.isArray((val as Record<string, unknown>).in)
    ) {
      const list = (val as Record<string, unknown>).in as unknown[];
      if (list.length === 0) {
        clauses.push("1=0");
      } else {
        clauses.push(`${col} IN (${list.map(() => "?").join(",")})`);
        params.push(...list);
      }
    } else if (typeof val === "object" && val !== null) {
      // Exactly one recognised range key must be present, and nothing else — UNLESS
      // it is the single `between` window (see BetweenWindowSchema for why that
      // is a separate branch and not a second operator).
      const bag = val as Record<string, unknown>;
      const keys = Object.keys(bag);
      const isBetween = keys.length === 1 && keys[0] === "between";
      const rangeKeys = keys.filter((k) => k in RANGE_CLAUSE);
      if (!isBetween && (rangeKeys.length !== 1 || keys.length !== 1)) {
        throw new Error(
          `unsupported filter operator for column "${key}": expected exactly one of ` +
            `${Object.keys(RANGE_CLAUSE).join(", ")}, or between (10_Security.md §11 — no operator is ever taken from the request)`,
        );
      }
      if (isBetween) {
        const window = BetweenWindowSchema.safeParse(bag.between);
        if (!window.success) {
          throw new Error(
            `filter window for column "${key}" must be a two-element tuple of date strings or integers ` +
              `(BR-M-01 — no float money ever reaches a comparison)`,
          );
        }
        clauses.push(`${col} BETWEEN ? AND ?`);
        params.push(window.data[0], window.data[1]);
      } else {
        const opKey = rangeKeys[0] as string;
        const threshold = RangeThresholdSchema.safeParse(bag[opKey]);
        if (!threshold.success) {
          throw new Error(
            `filter threshold for column "${key}" must be a date string or an integer ` +
              `(BR-M-01 — no float money ever reaches a comparison)`,
          );
        }
        clauses.push(`${col} ${RANGE_CLAUSE[opKey]} ?`);
        params.push(threshold.data);
      }
    } else {
      clauses.push(`${col} = ?`);
      params.push(val);
    }
  }
  return { sql: clauses.join(" AND "), args: params };
}

// Sort allowlists. Every entry is verified against the DDL in lib/schema.ts —
// an allowlist that names a column which does not exist is worse than no
// allowlist: it advertises a sort the caller can never get, and the next person
// to trust it removes the `EFFECTIVE_SORT_COLUMNS` intersection in lib/orm.ts
// that is currently hiding the mistake. `__tests__/sql-range-operators.test.ts`
// asserts each name against the real DDL, so a schema change that invalidates a
// name fails the build instead of silently becoming unreachable.
//
//   students            → lib/schema.ts:82-108
//   attendance_sessions → lib/schema.ts:273-285  (`batch_id`; there is NO `batch_name`)
//   ledger_entries      → lib/schema.ts:121-145
//   notifications       → lib/schema.ts:260-271  (`read_at`; there is NO `read`)
const STUDENT_SORT = new Set([
  "first_name",
  "last_name",
  "created_at",
  "updated_at",
  "admission_date",
  "code",
  "status",
  "grade",
  "balance_paise",
]);
const ATTENDANCE_SESSION_SORT = new Set(["session_date", "batch_id", "created_at"]);
const LEDGER_SORT = new Set(["occurred_on", "type", "created_at"]);
const NOTIFICATION_SORT = new Set(["category", "created_at", "read_at"]);

// ── Generic audited SELECT/COUNT/DELETE ─────────────────────────────────

export function stmtSelectWhere(
  table: string,
  tenantId: string,
  where: Record<string, unknown> = {},
  opts: { orderBy?: Record<string, string>; take?: number; skip?: number; orderAllowed?: Set<string> } = {}
): BuiltStatement {
  const t = auditedTable(table);
  const { sql: clause, args: whereArgs } = buildTenantWhere(tenantId, where);
  let sql = `SELECT * FROM ${t} WHERE ${clause}`;
  const args: unknown[] = [...whereArgs];
  if (opts.orderBy && opts.orderAllowed) {
    const entries = Object.entries(opts.orderBy);
    if (entries.length > 0) {
      const [col, dir] = entries[0] as [string, string];
      const snakeCol = auditedCamelToSnake(col);
      const upperDir = String(dir).toUpperCase();
      const dirParsed = SortDirSchema.safeParse(upperDir);
      if (opts.orderAllowed.has(snakeCol) && dirParsed.success) {
        sql += ` ORDER BY ${snakeCol} ${dirParsed.data}`;
        // Deterministic paging: the sort column is not unique (two students can
        // share a first name, a balance, or a status), so append the primary key
        // as a tie-break and the (sort, pk) pair becomes a total order. Without
        // it, LIMIT/OFFSET can return the same row on two pages and skip another
        // entirely — the web roster pages on this statement. `TABLE_PK` values are
        // module literals, so the tie-break is never caller-influenced; it is
        // skipped when the sort column IS the primary key (no duplicate term).
        const pk = TABLE_PK[t];
        if (pk !== snakeCol) {
          sql += `, ${pk} ASC`;
        }
      }
    }
  }
  if (opts.take !== undefined) {
    const take = LimitSchema.parse(opts.take);
    sql += " LIMIT ?";
    args.push(take);
  }
  if (opts.skip !== undefined) {
    const skip = OffsetSchema.parse(opts.skip);
    sql += " OFFSET ?";
    args.push(skip);
  }
  return { sql, args };
}

export function stmtSelectOneWhere(
  table: string,
  tenantId: string,
  where: Record<string, unknown> = {}
): BuiltStatement {
  const t = auditedTable(table);
  const { sql: clause, args } = buildTenantWhere(tenantId, where);
  return { sql: `SELECT * FROM ${t} WHERE ${clause} LIMIT 1`, args };
}

export function stmtCountWhere(
  table: string,
  tenantId: string,
  where: Record<string, unknown> = {}
): BuiltStatement {
  const t = auditedTable(table);
  const { sql: clause, args } = buildTenantWhere(tenantId, where);
  return { sql: `SELECT COUNT(*) AS c FROM ${t} WHERE ${clause}`, args };
}

export function stmtDeleteWhere(
  table: string,
  tenantId: string,
  where: Record<string, unknown> = {}
): BuiltStatement {
  const t = auditedTable(table);
  if (t === "ledger_entries") {
    // Rule 1: no builder exists for ledger UPDATE/DELETE — fail-closed even
    // if a caller asks.
    throw new Error("ledger_entries is append-only (Rule 1): DELETE forbidden");
  }
  const { sql: clause, args } = buildTenantWhere(tenantId, where);
  return { sql: `DELETE FROM ${t} WHERE ${clause}`, args };
}

/** Audited `UPDATE {table} SET {cols} WHERE {clause}`. `data` keys are
 * camelCase or snake_case; each converts to an audited column ref. Values via
 * `?`. An extra `updated_at = ?` is appended by the caller when needed (the
 * caller passes it inside `data` or appends after — builders never invent
 * columns). */
export function stmtUpdateWhere(
  table: string,
  tenantId: string,
  where: Record<string, unknown>,
  data: Record<string, unknown>
): BuiltStatement {
  const t = auditedTable(table);
  if (t === "ledger_entries") {
    throw new Error("ledger_entries is append-only (Rule 1): UPDATE forbidden");
  }
  const { sql: clause, args: whereArgs } = buildTenantWhere(tenantId, where);
  const sets: string[] = [];
  const setArgs: unknown[] = [];
  for (const [k, v] of Object.entries(data ?? {})) {
    const col = auditedCamelToSnake(k);
    sets.push(`${col} = ?`);
    setArgs.push(v);
  }
  if (sets.length === 0) throw new Error(`no valid fields to update ${t}`);
  return { sql: `UPDATE ${t} SET ${sets.join(",")} WHERE ${clause}`, args: [...setArgs, ...whereArgs] };
}

// ── Entity INSERT builders (fixed column lists mirror `orm.ts` verbatim) ─

export function stmtInsertStudent(
  tenantId: string,
  d: Record<string, unknown>
): BuiltStatement {
  const tenant = auditedTenant(tenantId);
  const now = new Date().toISOString();
  const studentId = typeof d.id === "string" && d.id.length > 0 ? d.id : crypto.randomUUID();
  IdSchema.parse(studentId);
  const dupKeyVal = (d.dupKey as string | undefined) ??
    (d.dup_key as string | undefined) ??
    (d.code as string | undefined) ??
    studentId;
  const cols = [
    "id",
    "tenant_id",
    "code",
    "first_name",
    "last_name",
    "dob",
    "gender",
    "phone",
    "email",
    "address",
    "school",
    "grade",
    "board",
    "admission_date",
    "status",
    "fee_model",
    "base_fee_paise",
    "balance_paise",
    "dup_key",
    "notes",
    "created_at",
    "updated_at",
  ];
  for (const c of cols) ColumnRefSchema.parse(c);
  const vals = [
    studentId,
    tenant,
    (d.code as unknown ?? null) as unknown,
    (d.firstName as unknown ?? d.first_name as unknown ?? "Unknown") as unknown,
    (d.lastName as unknown ?? d.last_name as unknown ?? null) as unknown,
    (d.dob as unknown ?? null) as unknown,
    (d.gender as unknown ?? null) as unknown,
    (d.phone as unknown ?? null) as unknown,
    (d.email as unknown ?? null) as unknown,
    (d.address as unknown ?? null) as unknown,
    (d.school as unknown ?? null) as unknown,
    (d.grade as unknown ?? null) as unknown,
    (d.board as unknown ?? null) as unknown,
    ((d.admissionDate as string | undefined) ?? (d.admission_date as string | undefined) ?? now.slice(0, 10)) as unknown,
    ((d.status as string | undefined) ?? "active") as unknown,
    ((d.feeModel as string | undefined) ?? (d.fee_model as string | undefined) ?? "postpaid") as unknown,
    ((d.baseFeePaise as number | undefined) ?? (d.base_fee_paise as number | undefined) ?? 0) as unknown,
    ((d.balancePaise as number | undefined) ?? (d.balance_paise as number | undefined) ?? 0) as unknown,
    dupKeyVal as unknown,
    ((d.notes as string | null | undefined) ?? null) as unknown,
    now as unknown,
    now as unknown,
  ];
  return {
    sql: `INSERT INTO students (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
    args: vals,
  };
}

export function stmtInsertBatch(
  tenantId: string,
  d: Record<string, unknown>
): BuiltStatement {
  const tenant = auditedTenant(tenantId);
  const now = new Date().toISOString();
  const id = typeof d.id === "string" && d.id.length > 0 ? d.id : crypto.randomUUID();
  IdSchema.parse(id);
  const name = z.string().min(1).max(300).parse(d.name);
  return {
    sql: "INSERT INTO batches (id, tenant_id, name, subject, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: [id, tenant, name, (d.subject as unknown ?? null) as unknown, now, now],
  };
}

export function stmtInsertEnrollment(
  tenantId: string,
  d: Record<string, unknown>
): BuiltStatement {
  const tenant = auditedTenant(tenantId);
  const now = new Date().toISOString();
  const id = typeof d.id === "string" && d.id.length > 0 ? d.id : crypto.randomUUID();
  IdSchema.parse(id);
  return {
    sql: "INSERT INTO student_enrollments (id, tenant_id, student_id, batch_id, joined_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [
      id,
      tenant,
      IdSchema.parse(d.studentId),
      IdSchema.parse(d.batchId),
      ((d.joinedOn as string | undefined) ?? now.slice(0, 10)) as unknown,
      now,
      now,
    ],
  };
}

export function stmtInsertAttendanceSession(
  tenantId: string,
  d: Record<string, unknown>
): BuiltStatement {
  const tenant = auditedTenant(tenantId);
  const now = new Date().toISOString();
  const id = typeof d.id === "string" && d.id.length > 0 ? d.id : crypto.randomUUID();
  IdSchema.parse(id);
  return {
    sql: "INSERT INTO attendance_sessions (id, tenant_id, batch_id, session_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: [
      id,
      tenant,
      (d.batchId as unknown ?? null) as unknown,
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(d.sessionDate),
      now,
      now,
    ],
  };
}

export function stmtInsertAttendanceRecordUpsert(
  tenantId: string,
  d: Record<string, unknown>
): BuiltStatement {
  const tenant = auditedTenant(tenantId);
  const now = new Date().toISOString();
  const id = typeof d.id === "string" && d.id.length > 0 ? d.id : crypto.randomUUID();
  IdSchema.parse(id);
  return {
    sql: `INSERT INTO attendance_records (id, tenant_id, session_id, student_id, status, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?)
                         ON CONFLICT(session_id, student_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
    args: [
      id,
      tenant,
      IdSchema.parse(d.sessionId),
      IdSchema.parse(d.studentId),
      z.enum(["present", "absent", "late", "excused", "holiday"]).parse(d.status),
      now,
      now,
    ],
  };
}

export function stmtInsertInvoice(
  tenantId: string,
  d: Record<string, unknown>
): BuiltStatement {
  const tenant = auditedTenant(tenantId);
  if (typeof d.number !== "string" || d.number.length === 0) {
    throw new Error(
      `invoices.number is required (11_Data_Model.md §4.12) for student ${String(d.studentId)}`
    );
  }
  if (typeof d.tamperHash !== "string" || d.tamperHash.length === 0) {
    throw new Error(
      `invoices.tamper_hash is required (10_Security.md §10) for invoice ${d.number as string}`
    );
  }
  const subtotal = (d.subtotal as number | undefined) ?? 0;
  const discount = (d.discount as number | undefined) ?? 0;
  const extraCharges = (d.extraCharges as number | undefined) ?? 0;
  const total = (d.total as number | undefined) ?? subtotal;
  if (
    !Number.isSafeInteger(subtotal) ||
    !Number.isSafeInteger(discount) ||
    !Number.isSafeInteger(extraCharges) ||
    !Number.isSafeInteger(total)
  ) {
    throw new Error(
      `invoices money columns must be integer paise (12_Business_Rules.md BR-M-01) for invoice ${d.number as string}`
    );
  }
  const now = new Date().toISOString();
  const issueDate = typeof d.issueDate === "string" ? d.issueDate : now.slice(0, 10);
  const id = typeof d.id === "string" && d.id.length > 0 ? d.id : crypto.randomUUID();
  IdSchema.parse(id);
  return {
    sql: `INSERT INTO invoices (id, tenant_id, number, student_id, fee_schedule_item_id, issue_date, due_date, subtotal, discount, extra_charges, total, status, tamper_hash, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      tenant,
      d.number,
      IdSchema.parse(d.studentId),
      (d.feeScheduleItemId as unknown ?? null) as unknown,
      issueDate,
      (d.dueDate as unknown ?? null) as unknown,
      subtotal,
      discount,
      extraCharges,
      total,
      ((d.status as string | undefined) ?? "unpaid") as unknown,
      d.tamperHash,
      now,
      now,
    ],
  };
}

export function stmtInsertLedgerEntry(
  tenantId: string,
  d: Record<string, unknown>
): BuiltStatement {
  const tenant = auditedTenant(tenantId);
  if (typeof d.thisHash !== "string" || d.thisHash.length === 0) {
    throw new Error(
      `ledger_entries.this_hash is required (BR-LED-06) for ${d.type as string} entry`
    );
  }
  const now = new Date().toISOString();
  const createdAt = typeof d.createdAt === "string" ? d.createdAt : now;
  const id = typeof d.id === "string" && d.id.length > 0 ? d.id : crypto.randomUUID();
  IdSchema.parse(id);
  return {
    sql: `INSERT INTO ledger_entries (id, tenant_id, student_id, batch_id, invoice_id, type, debit_paise, credit_paise, balance_after_paise, description, receipt_no, payment_method, payment_ref, prev_hash, this_hash, void_of_id, occurred_on, source, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      tenant,
      IdSchema.parse(d.studentId),
      (d.batchId as unknown ?? null) as unknown,
      (d.invoiceId as unknown ?? null) as unknown,
      d.type,
      ((d.debitPaise as number | undefined) ?? 0) as unknown,
      ((d.creditPaise as number | undefined) ?? 0) as unknown,
      ((d.balanceAfterPaise as number | undefined) ?? 0) as unknown,
      (d.description as unknown ?? null) as unknown,
      (d.receiptNo as unknown ?? null) as unknown,
      (d.paymentMethod as unknown ?? null) as unknown,
      (d.paymentRef as unknown ?? null) as unknown,
      (d.prevHash as unknown ?? null) as unknown,
      d.thisHash,
      (d.voidOfId as unknown ?? null) as unknown,
      ((d.occurredOn as string | undefined) ?? (createdAt as string).slice(0, 10)) as unknown,
      ((d.source as string | undefined) ?? "manual") as unknown,
      createdAt,
      createdAt,
    ],
  };
}

export function stmtInsertReceipt(
  tenantId: string,
  d: Record<string, unknown>
): BuiltStatement {
  const tenant = auditedTenant(tenantId);
  const now = new Date().toISOString();
  const id = typeof d.id === "string" && d.id.length > 0 ? d.id : crypto.randomUUID();
  IdSchema.parse(id);
  return {
    // `ledger_entry_id` is nullable on the receipts table precisely so this
    // legacy builder keeps working without one; `packages/core`'s flow always
    // supplies it (07 §9.6 step 4). `receiptNo` is still accepted as an alias
    // because the outbox payloads replayed from older devices still carry it.
    sql: `INSERT INTO receipts (id, tenant_id, number, ledger_entry_id, student_id, invoice_id, amount, payment_method, payment_ref, received_on, tamper_hash, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      tenant,
      ((d.receiptNo as string | undefined) ?? (d.number as string | undefined)) as unknown,
      (d.ledgerEntryId as unknown ?? null) as unknown,
      IdSchema.parse(d.studentId),
      (d.invoiceId as unknown ?? null) as unknown,
      d.amount,
      ((d.paymentMethod as string | undefined) ?? "cash") as unknown,
      (d.paymentRef as unknown ?? null) as unknown,
      ((d.receivedOn as string | undefined) ?? now.slice(0, 10)) as unknown,
      ((d.tamperHash as string | undefined) ?? "hash") as unknown,
      now,
      now,
    ],
  };
}

export function stmtInsertSetting(
  tenantId: string,
  d: Record<string, unknown>
): BuiltStatement {
  const tenant = auditedTenant(tenantId);
  const now = new Date().toISOString();
  const cols: string[] = [
    "tenant_id",
    "institute_name",
    "currency_code",
    "default_fee_model",
    "palette",
    "theme",
    "density",
    "tenant_secret",
    "created_at",
    "updated_at",
  ];
  for (const c of cols) ColumnRefSchema.parse(c);
  const vals: unknown[] = [
    tenant,
    ((d.instituteName as string | undefined) ?? (d.institute_name as string | undefined) ?? "My Tuition") as unknown,
    ((d.currencyCode as string | undefined) ?? (d.currency_code as string | undefined) ?? "INR") as unknown,
    ((d.defaultFeeModel as string | undefined) ?? (d.default_fee_model as string | undefined) ?? "postpaid") as unknown,
    ((d.palette as string | undefined) ?? "aurora-cosmic") as unknown,
    ((d.theme as string | undefined) ?? "system") as unknown,
    ((d.density as string | undefined) ?? "comfortable") as unknown,
    ((d.tenantSecret as string | undefined) ?? (d.tenant_secret as string | undefined) ?? crypto.randomUUID()) as unknown,
    now,
    now,
  ];
  // Columns a settings INSERT may carry BEYOND the fixed set above. This used to be
  // "append every key of `d` that passes the identifier regex", which made this
  // builder a mass-assignment primitive with no second line of defence: a caller
  // reaching it with an unfiltered object could set `pin_hash`, `tenant_secret`,
  // `backup_passphrase_hash`, the monotonic `next_*_seq` counters (BR-RC-01) or
  // `deleted_at`. routes/settings.ts rejects unknown fields before it gets here,
  // but a builder should not depend on its only caller for that. Mirrors
  // SETTINGS_PATCH_SCHEMA in routes/settings.ts; server-owned columns are absent
  // by construction rather than by rejection.
const SETTINGS_INSERT_EXTRA = new Set([
  "institute_address",
  "institute_phone",
  "institute_email",
  "locale",
  "timezone",
  "invoice_prefix",
  "receipt_prefix",
  "grace_days",
  "auto_invoice",
  "attendance_lock_hours",
  "default_attendance_status",
  "notify_due_fee",
  "notify_upcoming_due",
  "notify_missing_attendance",
  "notify_inactive_student",
  "session_timeout_min",
  "biometric_enabled",
  "auto_archive_inactive_days",
  "reduced_motion",
]);

for (const [k, v] of Object.entries(d ?? {})) {
    const col = auditedCamelToSnake(k);
    if (!cols.includes(col) && SETTINGS_INSERT_EXTRA.has(col)) {
      cols.push(col);
      vals.push(v);
    }
  }
  return {
    sql: `INSERT INTO settings (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    args: vals,
  };
}

export function stmtInsertNotification(
  tenantId: string,
  d: Record<string, unknown>
): BuiltStatement {
  const tenant = auditedTenant(tenantId);
  const now = new Date().toISOString();
  const id = typeof d.id === "string" && d.id.length > 0 ? d.id : crypto.randomUUID();
  IdSchema.parse(id);
  return {
    sql: "INSERT INTO notifications (id, tenant_id, category, title, body, ref_type, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      id,
      tenant,
      ((d.category as string | undefined) ?? "general") as unknown,
      z.string().min(1).max(500).parse(d.title),
      (d.body as unknown ?? null) as unknown,
      (d.refType as unknown ?? null) as unknown,
      (d.refId as unknown ?? null) as unknown,
      now,
    ],
  };
}

export function stmtInsertAuditLog(
  tenantId: string,
  d: Record<string, unknown>
): BuiltStatement {
  const tenant = auditedTenant(tenantId);
  const now = new Date().toISOString();
  const id = typeof d.id === "string" && d.id.length > 0 ? d.id : crypto.randomUUID();
  IdSchema.parse(id);
  const meta = typeof d.metadata === "object" ? JSON.stringify(d.metadata) : (d.metadata as unknown ?? null);
  return {
    sql: "INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      id,
      tenant,
      ((d.actor as string | undefined) ?? tenant) as unknown,
      z.string().min(1).max(128).parse(d.action),
      (d.refType as unknown ?? null) as unknown,
      (d.refId as unknown ?? null) as unknown,
      meta as unknown,
      now,
    ],
  };
}

export function stmtInsertSyncOutbox(
  tenantId: string,
  d: Record<string, unknown>
): BuiltStatement {
  const tenant = auditedTenant(tenantId);
  const now = new Date().toISOString();
  const id = typeof d.id === "string" && d.id.length > 0 ? d.id : crypto.randomUUID();
  IdSchema.parse(id);
  const payload = typeof d.payload === "object" ? JSON.stringify(d.payload) : (d.payload as unknown ?? "{}");
  return {
    sql: "INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      id,
      tenant,
      z.string().min(1).max(64).parse((d.tableName as string | undefined) ?? (d.table_name as string | undefined)),
      z.string().min(1).max(128).parse((d.rowId as string | undefined) ?? (d.row_id as string | undefined)),
      z.string().min(1).max(32).parse(d.op),
      payload as unknown,
      ((d.status as string | undefined) ?? "pending") as unknown,
      now,
    ],
  };
}

export function stmtInsertIdempotencyKey(
  tenantId: string,
  route: string,
  key: string,
  code: number,
  body: string
): BuiltStatement {
  const tenant = auditedTenant(tenantId);
  return {
    sql: `INSERT INTO idempotency_keys (tenant_id, route, "key", response_code, response_body, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      tenant,
      z.string().min(1).max(256).parse(route),
      z.string().uuid().parse(key),
      z.number().int().parse(code),
      z.string().min(1).parse(body),
      new Date().toISOString(),
    ],
  };
}

// ── Chain / idempotency / sequence / balance / receipt-void / erase ─────────

export function stmtTenantSecret(tenantId: string): BuiltStatement {
  return {
    sql: "SELECT tenant_secret FROM settings WHERE tenant_id = ?",
    args: [auditedTenant(tenantId)],
  };
}

/**
 * BR-SEC-04 / 10_Security.md §18.1 step 1 — reads BOTH the argon2id presence
 * marker and the edge-verifiable HMAC PIN proof.
 *
 * WHY THIS EXISTS. Presence alone is not proof. Checking that `pin_hash` is
 * non-null proves that a PIN was ever set, not that the caller knows it, so a
 * stolen session satisfied the gate and could then run the erase cascade. The
 * web action proves knowledge by verifying the PIN against argon2id; the edge
 * cannot, so the app also publishes `pin_proof` — an HMAC over the PIN under a
 * server-side key — which the edge CAN verify in constant time.
 *
 * `pin_proof` is NOT the PIN and is not a hash of the hash: it is an HMAC under
 * a key that never leaves the server, so possessing it does not let an attacker
 * offline-brute the PIN any more than possessing `pin_hash` would (and `pin_hash`
 * is already argon2id at m=64MiB). Both columns are read here so the route can
 * distinguish "no PIN at all" from "PIN set but proof not yet derived".
 */
export function stmtSettingPinProof(tenantId: string): BuiltStatement {
  return {
    sql: "SELECT pin_hash, pin_proof FROM settings WHERE tenant_id = ?",
    args: [auditedTenant(tenantId)],
  };
}

/**
 * The chain's tip: the row a new entry extends (BR-LED-06).
 *
 * The order is `created_at DESC`, which is CORRECT because a writer gives its
 * new row a `created_at` strictly greater than the tip's — the per-chain
 * logical clock (`nextChainCreatedAtIso`, apps/gateway/lib/ledger-chain.ts) —
 * so the timestamp order and the link order are the same order.
 *
 * `rowid DESC` remains ONLY as the legacy tie-break for rows written before
 * that clock existed: within one millisecond the later-inserted row is the
 * later link, so it names the same tip. A row written by the current writer
 * can never tie, so the tie-break is unreachable for new rows.
 */
export function stmtChainTip(tenantId: string, studentId: string): BuiltStatement {
  return {
    sql: `SELECT this_hash, balance_after_paise, created_at FROM ledger_entries
      WHERE tenant_id = ? AND student_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1`,
    args: [auditedTenant(tenantId), IdSchema.parse(studentId)],
  };
}

/**
 * One student's whole chain, for the LINK-WALK (BR-LED-06).
 *
 * The walk needs every row: the genesis row (the one with no predecessor),
 * each row's `prev_hash` (the link it claims) and its `this_hash` (the link
 * it offers). The columns are named explicitly — the walk is a structure
 * check, not a row read, and a column it does not use is a column it cannot
 * accidentally depend on.
 */
export function stmtChainRows(tenantId: string, studentId: string): BuiltStatement {
  return {
    sql: `SELECT id, prev_hash, this_hash, created_at, balance_after_paise
      FROM ledger_entries
      WHERE tenant_id = ? AND student_id = ?`,
    args: [auditedTenant(tenantId), IdSchema.parse(studentId)],
  };
}

export function stmtIdempotencyFind(tenantId: string, route: string, key: string): BuiltStatement {
  return {
    sql: `SELECT response_code, response_body, created_at FROM idempotency_keys
      WHERE tenant_id = ? AND route = ? AND "key" = ?`,
    args: [auditedTenant(tenantId), z.string().min(1).max(256).parse(route), z.string().uuid().parse(key)],
  };
}

export function stmtIdempotencyDeleteOne(tenantId: string, route: string, key: string): BuiltStatement {
  return {
    sql: `DELETE FROM idempotency_keys WHERE tenant_id = ? AND route = ? AND "key" = ?`,
    args: [auditedTenant(tenantId), z.string().min(1).max(256).parse(route), z.string().uuid().parse(key)],
  };
}

export function stmtIdempotencyPurge(tenantId: string, cutoffIso: string): BuiltStatement {
  return {
    sql: "DELETE FROM idempotency_keys WHERE tenant_id = ? AND created_at < ?",
    args: [auditedTenant(tenantId), z.string().min(1).parse(cutoffIso)],
  };
}

const SeqKindSchema = z.enum(["receipt", "invoice"]);

export function stmtTakeSequence(
  tenantId: string,
  kind: "receipt" | "invoice",
  nowIso: string
): BuiltStatement {
  const parsedKind = SeqKindSchema.parse(kind);
  const tenant = auditedTenant(tenantId);
  const [seqCol, prefixCol] = parsedKind === "receipt"
    ? ["next_receipt_seq", "receipt_prefix"]
    : ["next_invoice_seq", "invoice_prefix"];
  ColumnRefSchema.parse(seqCol);
  ColumnRefSchema.parse(prefixCol);
  return {
    sql: `UPDATE settings SET ${seqCol} = COALESCE(${seqCol}, 1) + 1, updated_at = ?
      WHERE tenant_id = ?
      RETURNING ${seqCol}, ${prefixCol}`,
    args: [z.string().min(1).parse(nowIso), tenant],
  };
}

export function stmtSyncStudentBalance(
  tenantId: string,
  studentId: string,
  balancePaise: number,
  nowIso: string
): BuiltStatement {
  if (!Number.isSafeInteger(balancePaise)) {
    throw new Error("balance_paise must be integer paise (BR-M-01)");
  }
  return {
    sql: "UPDATE students SET balance_paise = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
    args: [balancePaise, z.string().min(1).parse(nowIso), auditedTenant(tenantId), IdSchema.parse(studentId)],
  };
}

export function stmtFindLiveReceipt(tenantId: string, receiptNo: string): BuiltStatement {
  return {
    sql: "SELECT id FROM receipts WHERE tenant_id = ? AND number = ? AND voided_at IS NULL",
    args: [auditedTenant(tenantId), z.string().min(1).max(64).parse(receiptNo)],
  };
}

/**
 * F-08: find the receipt linked to one ledger entry. The canonical link since
 * payment convergence (receipts.ledger_entry_id, written by the flow for the
 * first entry of every payment); `stmtFindLiveReceipt` (by number) remains
 * for rows written before convergence, which carry receipt_no denormalized on
 * the entry. Live-only in both cases: re-stamping an already-voided receipt
 * would move its voided_at under a second void.
 */
export function stmtFindLiveReceiptByEntry(tenantId: string, entryId: string): BuiltStatement {
  return {
    sql: "SELECT id FROM receipts WHERE tenant_id = ? AND ledger_entry_id = ? AND voided_at IS NULL",
    args: [auditedTenant(tenantId), IdSchema.parse(entryId)],
  };
}

export function stmtVoidReceipt(tenantId: string, receiptId: string, nowIso: string): BuiltStatement {
  return {
    sql: "UPDATE receipts SET voided_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
    args: [
      z.string().min(1).parse(nowIso),
      z.string().min(1).parse(nowIso),
      auditedTenant(tenantId),
      IdSchema.parse(receiptId),
    ],
  };
}

/** The secure-erase cascade (10_Security.md §18.1 step 4, the single audited
 *  LEDGER-4 exception to "no physical deletes"). ORDER IS LOAD-BEARING: it is
 *  child-before-parent with foreign keys enabled.
 *
 *  Two corrections on 2026-10-04, both found by running the real route against
 *  real SQLite (the endpoint was broken in production, not merely untested):
 *
 *  1. `tutors` was listed here but NOT admitted by `TableNameSchema`, so
 *     `stmtEraseTable("tutors")` threw `invalid table identifier: tutors` and
 *     the whole erase failed on its seventh statement — nothing was deleted and
 *     the caller got a 500. The most destructive endpoint in the product could
 *     not complete. `tutors` is now in the table allowlist.
 *  2. `fee_schedule_items` and `fee_plans` were missing entirely, and both
 *     declare `REFERENCES students(id)` / `REFERENCES fee_plans(id)`
 *     (lib/schema.ts:153-182). With foreign keys on, `DELETE FROM students` would
 *     abort on a dangling plan — so even with (1) fixed the wipe could not
 *     commit. They now sit between `invoices` and `students`, which is the only
 *     order that satisfies every FK: invoices → fee_schedule_items → fee_plans
 *     → students → batches. */
const ERASE_TABLES = [
  "ledger_entries",
  "receipts",
  "invoices",
  "fee_schedule_items",
  "fee_plans",
  "attendance_records",
  "attendance_sessions",
  "student_enrollments",
  "students",
  "batches",
  "tutors",
  "notifications",
  "sync_outbox",
  "audit_log",
  "settings",
] as const;

export function stmtEraseTable(table: (typeof ERASE_TABLES)[number], tenantId: string): BuiltStatement {
  const t = auditedTable(table);
  if (!(ERASE_TABLES as readonly string[]).includes(t)) {
    throw new Error(`invalid erase table: ${table}`);
  }
  return { sql: `DELETE FROM ${t} WHERE tenant_id = ?`, args: [auditedTenant(tenantId)] };
}

export function eraseTables(): readonly string[] {
  return ERASE_TABLES;
}

export function stmtSecurityAuditInsert(
  tenantId: string,
  action: "security.erase_initiated" | "security.erase_complete",
  metadataJson: string,
  nowIso: string
): BuiltStatement {
  const tenant = auditedTenant(tenantId);
  return {
    sql: `INSERT INTO audit_log (id, tenant_id, actor, ref_type, ref_id, action, metadata, created_at)
            VALUES (?, ?, ?, 'tenant', ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      tenant,
      tenant,
      tenant,
      action,
      z.string().min(1).parse(metadataJson),
      z.string().min(1).parse(nowIso),
    ],
  };
}

// ── The dashboard's period aggregate (BR-CALC-10) ───────────────────────────

/** A calendar day, `YYYY-MM-DD`. The period window's two bounds, and the same
 *  shape the route's `PERIOD_DAY_PATTERN` enforces before it reads anything. */
const DaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * The SQL form of "the first ten characters of this value are a `YYYY-MM-DD`
 * day" — the shape check the route's `readDay` performs in JavaScript.
 *
 * SQLite's GLOB matches the WHOLE string (unlike LIKE) and supports `[a-z]`
 * character classes, so this pattern is ten characters long and accepts only
 * four digits, a dash, two digits, a dash, two digits. A value shorter than
 * ten characters cannot match a ten-character pattern, which is what the
 * JavaScript's `slice(0, 10)` + pattern test does with it.
 *
 * WHY IT IS NEEDED AT ALL: a lexicographic range on the RAW column cannot
 * express the shape. "2026-1" sorts between "2026-01-01" and "2026-12-31" and
 * would be INCLUDED by a plain range, while the JavaScript window EXCLUDES it
 * because it is not a day. Without this test the two ways of computing the
 * same figure would disagree — and the figure is money.
 */
const DAY_SHAPE_GLOB = "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]";

/**
 * BR-CALC-10 — "Collected for a period = Σ(credit_paise where
 * type='PAYMENT_RECEIVED') − Σ(debit_paise where type='REFUND_ISSUED') over the
 * period's date range. **Voided entries excluded.**"
 *
 * Implements: 12_Business_Rules.md BR-CALC-10 + 14_Edge_Cases.md EC-F-05
 * (a reversed credit does not count) + 04_Dashboard.md §3 (the KPI strip must
 * stay affordable as the institute grows) + AGENTS.md §3.4 (this module is the
 * only place runtime SQL text may live).
 *
 * WHY IT EXISTS. The route used to READ every qualifying row and reduce it in
 * JavaScript. On the spec's own scale (a 200-student institute, 24 months of
 * history) that was 3,600 rows and 1,895 KB per request, and the "All time"
 * window read the tenant's ENTIRE payment history off an append-only table
 * (Rule 1: a void is a new row, so `ledger_entries` only ever grows). The
 * figure the route needs is a SCALAR, so the sum happens here, in the
 * database, and ONE row comes back.
 *
 * THE JAVASCRIPT WINDOW HAD THREE PARTS, and all three are reproduced here —
 * a SQL range alone is NOT the same rule:
 *
 *  1. THE DAY-SHAPE CHECK. `readDay` returned null unless the leading ten
 *     characters matched `YYYY-MM-DD`, so a malformed `occurred_on` was
 *     EXCLUDED. `DAY_SHAPE_GLOB` is the same test in SQL.
 *  2. THE TRIMMED DAY, with INCLUSIVE bounds. The range is on
 *     `substr(occurred_on, 1, 10)`, so a payment at `2026-10-31T10:00:00Z` is
 *     INSIDE a window ending `2026-10-31`. A raw `occurred_on <= periodEnd`
 *     would exclude it — the exact bug this builder must not have.
 *  3. THE REVERSAL GRAPH. "Voided entries excluded" is NOT the row's own
 *     `void_of_id`: a voided ORIGINAL carries null there, and the reversal is
 *     the LATER row pointing back at it. So the predicate is "this row's id is
 *     not some OTHER row's `void_of_id`" — a `NOT IN` over a SUBQUERY of the
 *     tenant's own VOID rows. A subquery, never an `IN` list of ids: the
 *     candidate set grows with the tenant's history and SQLite's variable
 *     ceiling is 32,766, so an id list would 500 on a long-lived institute.
 *
 * ONE STATEMENT, TWO LEGS. The credit sum and the refund sum are two CASE
 * expressions over ONE scan, so they share ONE snapshot: a payment and its
 * refund cannot land on opposite sides of a concurrent write. They were two
 * statements before, and two statements are two snapshots.
 *
 * The reversal exclusion applies to the CREDIT leg only, which is the rule the
 * route has always implemented. A voided REFUND still subtracts — unchanged
 * here on purpose: widening or narrowing that is a money-semantics change
 * under BR-CALC-10, not a performance fix, and it needs its own decision.
 */
/**
 * The period leg of BR-CALC-10, as ONE statement.
 *
 * THE EXCLUSION IS TYPE-AGNOSTIC, and that matters. It was written as
 * `type <> creditType OR id NOT IN (reversed)`, which looks like it excludes
 * the reversed rows and actually excludes only the reversed rows OF THE CREDIT
 * TYPE: for a reversed refund the first disjunct is true, the row is kept, and
 * a VOIDED REFUND still came out of the collected figure. The shared layer
 * (`packages/shared/src/feeCalc.ts` `collectedForPeriod`) excludes a voided row
 * from BOTH legs, so the two copies of BR-CALC-10 disagreed - and the
 * gateway's dashboard and the web's fees screen would not have shown the same
 * number for the same tutor.
 *
 * The VOID rows themselves need no exclusion: the `type IN (credit, debit)`
 * clause already keeps them out of both sums.
 */
export function stmtSumPeriodLedgerAmounts(
  tenantId: string,
  opts: {
    creditType: string;
    debitType: string;
    startDay: string;
    endDay: string;
  },
): BuiltStatement {
  const tenant = auditedTenant(tenantId);
  const creditType = z.string().min(1).max(64).parse(opts.creditType);
  const debitType = z.string().min(1).max(64).parse(opts.debitType);
  const startDay = DaySchema.parse(opts.startDay);
  const endDay = DaySchema.parse(opts.endDay);
  if (startDay > endDay) {
    throw new Error("period window is empty: startDay is after endDay");
  }
  return {
    sql: `SELECT COALESCE(SUM(CASE WHEN type = ? THEN credit_paise ELSE 0 END), 0) AS credits_paise,
                 COALESCE(SUM(CASE WHEN type = ? THEN debit_paise ELSE 0 END), 0) AS refunds_paise
            FROM ledger_entries
           WHERE tenant_id = ?
             AND type IN (?, ?)
             AND substr(occurred_on, 1, 10) GLOB ?
             AND substr(occurred_on, 1, 10) BETWEEN ? AND ?
             AND id NOT IN (SELECT void_of_id FROM ledger_entries
                        WHERE tenant_id = ? AND type = ? AND void_of_id IS NOT NULL)`,
    args: [
      creditType,
      debitType,
      tenant,
      creditType,
      debitType,
      DAY_SHAPE_GLOB,
      startDay,
      endDay,
      tenant,
      "VOID",
    ],
  };
}

// ── The invoice's credited total (BR-RPT-04 [CRITICAL]) ────────────────────

/**
 * Σ the credits still attributed to each invoice, in ONE statement.
 *
 * Implements: 12_Business_Rules.md BR-RPT-04 [CRITICAL] (a credit counts
 * only while it has NOT been reversed) + 14_Edge_Cases.md EC-F-05 (a voided
 * receipt does not count) + 07_Fees_and_Payments.md §9.6 step 5 (the invoice's
 * credited total) + AGENTS.md §3.4 (this module is the only place runtime
 * SQL text may live).
 *
 * WHY IT EXISTS. The invoice read used to take a PAGE of the tenant's
 * `PAYMENT_RECEIVED` rows — `take: 200`, no ORDER BY — and reduce it in
 * JavaScript. That is a money figure taken from a SAMPLE of the rows, with
 * no defined order: on a tenant with more than 200 payments the invoices
 * beyond the sample read as unpaid, and WHICH invoices read as unpaid changed
 * with the table's physical order. The same treatment the Dashboard's period
 * leg got (`stmtSumPeriodLedgerAmounts`, row d52a635) is the model: the
 * figure is a SCALAR, so the sum happens in the database and ONE row per
 * invoice comes back.
 *
 * THE REVERSAL GRAPH, and why the exclusion is TYPE-AGNOSTIC. "Credited"
 * means NOT REVERSED, and a reversal is the LATER row: a VOID entry
 * carrying `void_of_id` pointing back at the row it reverses. The original
 * row carries no marker of its own, so "has this credit been reversed?" is
 * answered by looking the OTHER way — this row's id is not some OTHER row's
 * `void_of_id`. Two kinds of voided row are therefore excluded, whatever
 * their type:
 *
 *   · the REVERSAL itself (`type = 'VOID'`) — it is not money received;
 *   · the VOIDED ORIGINAL (some VOID row names it) — the money never
 *     arrived, or it was taken back.
 *
 * The exclusion does NOT look at the row's type, so a voided DISCOUNT (or any
 * other credit type) is excluded exactly like a voided payment. The old read
 * filtered the candidates to `type = 'PAYMENT_RECEIVED'` and therefore
 * counted a DISCOUNT credit as nothing at all — so the invoice read and the
 * money flow's own `creditedForInvoice` (which counts every live credit)
 * disagreed about the same invoice (AGENTS.md §3.5).
 *
 * A SUBQUERY, never an id list: the candidate set grows with the tenant's
 * history and SQLite's variable ceiling is 32,766, so an `IN (…)` list of
 * ids would 500 on a long-lived institute.
 *
 * ONE STATEMENT, ONE SNAPSHOT. Every invoice's figure comes from the same
 * scan, so a payment and the void that reverses it cannot land on opposite
 * sides of a concurrent write.
 */
export function stmtSumInvoiceCredits(tenantId: string): BuiltStatement {
  const tenant = auditedTenant(tenantId);
  return {
    sql: `SELECT invoice_id, COALESCE(SUM(credit_paise), 0) AS credited_paise
            FROM ledger_entries
           WHERE tenant_id = ?
             AND invoice_id IS NOT NULL
             AND type <> 'VOID'
             AND id NOT IN (SELECT void_of_id FROM ledger_entries
                            WHERE tenant_id = ? AND type = 'VOID' AND void_of_id IS NOT NULL)
           GROUP BY invoice_id`,
    args: [tenant, tenant],
  };
}

/**
 * A money value read back from SQLite, as integer paise.
 *
 * BR-M-01 + Rule 9: a corrupt money value THROWS here rather than being
 * rounded into a figure a tutor would read as a balance. Two shapes reach it:
 * a REAL (a 10¹⁹-paise amount SQLite stored as a float) and a bigint past
 * the safe-integer range (a sum that outgrew a double).
 *
 * The same guard as `lib/orm.ts`'s private `readPaise` — the two modules
 * cannot share one function without an edit to `lib/orm.ts`, which this
 * change does not touch. The RULE is the same in both: a corrupt money column
 * aborts fail-closed.
 */
export function readPaise(value: unknown, column: string): number {
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error(`${column} is outside the safe integer range (BR-M-01)`);
    }
    return Number(value);
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${column} is not integer paise (BR-M-01)`);
  }
  return value;
}

// ── GraphQL read builders (parameterized LIKE values; identifiers fixed) ──

export function stmtGraphqlSettings(tenantId: string): BuiltStatement {
  return { sql: "SELECT * FROM settings WHERE tenant_id = ?", args: [auditedTenant(tenantId)] };
}

export function stmtGraphqlStudents(
  tenantId: string,
  search: string | null,
  limit: number,
  offset: number
): BuiltStatement {
  const tenant = auditedTenant(tenantId);
  const lim = LimitSchema.parse(limit);
  const off = OffsetSchema.parse(offset);
  const where = ["tenant_id = ?", "archived_at IS NULL"];
  const args: unknown[] = [tenant];
  const clean = typeof search === "string" ? search.toLowerCase().slice(0, 200) : "";
  if (clean.length > 0) {
    where.push("(LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ? OR code LIKE ?)");
    args.push(`%${clean}%`, `%${clean}%`, `%${clean}%`);
  }
  return {
    sql: `SELECT * FROM students WHERE ${where.join(" AND ")} ORDER BY first_name, id ASC LIMIT ? OFFSET ?`,
    args: [...args, lim, off],
  };
}

export function stmtGraphqlStudentsCount(tenantId: string, search: string | null): BuiltStatement {
  const tenant = auditedTenant(tenantId);
  const where = ["tenant_id = ?", "archived_at IS NULL"];
  const args: unknown[] = [tenant];
  const clean = typeof search === "string" ? search.toLowerCase().slice(0, 200) : "";
  if (clean.length > 0) {
    where.push("(LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ? OR code LIKE ?)");
    args.push(`%${clean}%`, `%${clean}%`, `%${clean}%`);
  }
  return { sql: `SELECT COUNT(*) AS c FROM students WHERE ${where.join(" AND ")}`, args };
}

export function stmtGraphqlLedgerEntries(tenantId: string, limit: number, offset: number): BuiltStatement {
  const tenant = auditedTenant(tenantId);
  return {
    sql: "SELECT * FROM ledger_entries WHERE tenant_id = ? ORDER BY occurred_on DESC, id ASC LIMIT ? OFFSET ?",
    args: [tenant, LimitSchema.parse(limit), OffsetSchema.parse(offset)],
  };
}

export function stmtGraphqlLedgerCount(tenantId: string): BuiltStatement {
  return {
    sql: "SELECT COUNT(*) AS c FROM ledger_entries WHERE tenant_id = ?",
    args: [auditedTenant(tenantId)],
  };
}

export function stmtAuditLogFindMany(
  tenantId: string,
  where: Record<string, unknown> = {},
  take?: number
): BuiltStatement {
  const { sql: clause, args: whereArgs } = buildTenantWhere(tenantId, where);
  let sql = `SELECT * FROM audit_log WHERE ${clause} ORDER BY created_at DESC`;
  const args: unknown[] = [...whereArgs];
  if (take !== undefined) {
    sql += " LIMIT ?";
    args.push(LimitSchema.parse(take));
  }
  return { sql, args };
}

export function stmtSyncOutboxFindMany(
  tenantId: string,
  where: Record<string, unknown> = {},
  take?: number
): BuiltStatement {
  const { sql: clause, args: whereArgs } = buildTenantWhere(tenantId, where);
  let sql = `SELECT * FROM sync_outbox WHERE ${clause} ORDER BY created_at ASC`;
  const args: unknown[] = [...whereArgs];
  if (take !== undefined) {
    sql += " LIMIT ?";
    args.push(LimitSchema.parse(take));
  }
  return { sql, args };
}

export { STUDENT_SORT, ATTENDANCE_SESSION_SORT, LEDGER_SORT, NOTIFICATION_SORT };
