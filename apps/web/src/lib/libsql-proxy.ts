import type { Client, InValue, ResultSet } from "@libsql/client";

function toDbCol(col: string): string {
  return col.replace(/([A-Z])/g, "_$1").toLowerCase();
}

function toJsRow(row: any): any {
  if (!row || typeof row !== "object") return row;
  const out: any = {};
  for (const k of Object.keys(row)) {
    const camel = k.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    out[camel] = row[k];
  }
  return out;
}

/**
 * The minimum handle this proxy needs. Structural on purpose: a libSQL
 * `Client` (autocommit) and an interactive `Transaction` (from
 * `client.transaction("write")`) both satisfy it, which is how the same model
 * surface is reused inside a transaction.
 */
type SqlHandle = Pick<Client, "execute"> & Partial<Pick<Client, "transaction">>;

/**
 * Implements: AGENTS.md §3.4 (runtime schema authority is `bun run db:push` or
 * the gateway self-heal `ensureSelfRepairingSchema` — `apps/web` runtime code
 * never executes DDL) and §2 Rule 9 (a query error throws a typed error, it is
 * never reported as an empty result set).
 *
 * A missing table used to be papered over with shadow `CREATE TABLE` DDL plus an
 * empty-result fallback: a second, unaudited schema authority contradicting
 * §3.4 and a silent-wrong-UI path. Both are removed (audit:
 * reviews/overhaul-audit-report-2026-09-26.md "execSafe" / STOP-AND-ASK #7).
 */
async function execSafe(
  client: SqlHandle,
  sql: string,
  args: InValue[] = [],
): Promise<ResultSet> {
  try {
    return await client.execute({ sql, args });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const missing = /no such table:\s*(\S+)/.exec(msg);
    if (missing) {
      const table = missing[1] ?? "(unknown)";
      // The TABLE NAME is the intended operator signal and stays (AGENTS.md
      // §3.4: a table missing at runtime is a loud error naming the table, never
      // a silently self-created one). The driver text does NOT stay: a libSQL
      // error string embeds the failing statement and its column list, and this
      // message reaches the screen — `attendance-bulk-summary.test.ts` and the
      // client surface it as a toast. The original is preserved on `cause`, so
      // `log.error` still records the full statement for the operator who has to
      // reconcile the DB.
      throw new Error(
        `Schema missing at runtime: table "${table}" does not exist — ` +
          `schema authority is the gateway self-heal (apps/gateway/lib/schema.ts) ` +
          `or \`bun run db:push\`, not apps/web runtime (AGENTS.md §3.4).`,
        { cause: err },
      );
    }
    // Rule 9: surface the real error instead of fabricating { rows: [] }.
    throw err;
  }
}

function buildWhereClause(where: Record<string, any> | undefined): { whereClause: string; vals: any[] } {
  if (!where || Object.keys(where).length === 0) return { whereClause: "", vals: [] };
  const clauses: string[] = [];
  const vals: any[] = [];

  for (const k of Object.keys(where)) {
    const v = where[k];
    if (v === undefined) continue;
    const col = toDbCol(k);
    if (v === null) {
      clauses.push(`"${col}" IS NULL`);
    } else if (typeof v === "object" && v !== null && "not" in v) {
      if (v.not === null) {
        clauses.push(`"${col}" IS NOT NULL`);
      } else {
        clauses.push(`"${col}" != ?`);
        vals.push(v.not);
      }
    } else if (typeof v === "object" && v !== null && "in" in v && Array.isArray(v.in)) {
      if (v.in.length === 0) {
        clauses.push("1 = 0");
      } else {
        clauses.push(`"${col}" IN (${v.in.map(() => "?").join(",")})`);
        vals.push(...v.in);
      }
    } else {
      clauses.push(`"${col}" = ?`);
      vals.push(v instanceof Date ? v.toISOString() : v);
    }
  }

  return {
    whereClause: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    vals,
  };
}

/** Column value normalisation: `Date` → ISO string, everything else verbatim. */
function toSqlValue(value: unknown): InValue {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "bigint") return value;
  if (typeof value === "string" || value === null) return value;
  // Objects/arrays are serialised rather than silently bound as "[object Object]"
  // — a caller that meant a scalar gets a legible, deterministic failure.
  return JSON.stringify(value);
}

/**
 * Build `col = ?` (or `col = col + ?` for an atomic operator) assignments from
 * a `data` object. `undefined` keys are dropped (Prisma's "leave unchanged");
 * `null` is an explicit NULL.
 */
function buildSetClause(
  data: Record<string, unknown> | undefined,
): { setStr: string; setVals: InValue[] } {
  const assignments: string[] = [];
  const setVals: InValue[] = [];
  for (const key of Object.keys(data ?? {})) {
    const raw = (data as Record<string, unknown>)[key];
    if (raw === undefined) continue;
    const col = toDbCol(key);
    if (isAtomicNumberOp(raw)) {
      if (raw.set !== undefined) {
        assignments.push(`"${col}" = ?`);
        setVals.push(raw.set);
        continue;
      }
      const delta = raw.increment !== undefined ? raw.increment : -(raw.decrement ?? 0);
      // Atomic in the database: the read-modify-write never happens in JS, so
      // two concurrent sequence consumers cannot both read N and both write
      // N+1 (BR-LED-03 / EC-05).
      assignments.push(`"${col}" = "${col}" + ?`);
      setVals.push(delta);
      continue;
    }
    assignments.push(`"${col}" = ?`);
    setVals.push(toSqlValue(raw));
  }
  if (assignments.length === 0) {
    throw new Error("ORM_UPDATE_EMPTY: update called with no assignable fields");
  }
  return { setStr: assignments.join(","), setVals };
}


export type ProxyWhere = Record<string, unknown>;

/**
 * An atomic numeric operator, matching the generated Prisma client:
 * `{ nextInvoiceSeq: { increment: 1 } }` → `next_invoice_seq = next_invoice_seq + 1`.
 * Counting a sequence through the ORM needs the operator, not a read-modify-write
 * in JS (BR-LED-03: the increment is atomic or two writers collide).
 */
export interface AtomicNumberOp {
  increment?: number;
  decrement?: number;
  set?: number;
}

/** A value in `data` is either a plain column value or an atomic operator. */
export type ProxyValue = unknown | AtomicNumberOp;

function isAtomicNumberOp(value: unknown): value is AtomicNumberOp {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  return keys.every((k) => k === "increment" || k === "decrement" || k === "set");
}

/**
 * Implements: docs/rfc/rfc-009-010-ratification.md §3A Option 1 (PHASE 4 —
 * tenant auto-scope at the proxy boundary) + prisma/schema.prisma (the
 * tenant-table inventory below is derived from which models declare a
 * `tenantId` field; tables without the column must never receive the
 * injection or the emitted SQL references a missing column).
 *
 * A proxy is either BOUND (`createLibsqlProxy(client, tenantId)`) or UNBOUND
 * (legacy single-arg form). A bound proxy enforces three rules on every
 * tenant-table statement:
 *
 *   1. INJECT — a non-empty `where` without a tenant claim gets
 *      `tenantId: <bound>` merged in, so the ~142 existing call sites keep
 *      working unchanged and a forgotten filter becomes impossible.
 *   2. STRICT — an ABSENT or EMPTY `where` on a tenant table throws
 *      `TENANT_SCOPE_UNSCOPED` instead of running a full-table operation
 *      that would touch every tenant. Every legitimate full-scope write in
 *      the tree (e.g. the erase cascade) already passes `{ tenantId }`.
 *   3. FAIL-CLOSED — a caller-supplied tenant claim that differs from the
 *      bound tenant throws `TENANT_SCOPE_MISMATCH`; the proxy never
 *      overwrites it. `create`/`upsert` payloads inject when absent and
 *      throw when conflicting; `update` payloads are validated but never
 *      injected (rewriting a `tenant_id` column — the PK of `settings` and
 *      `app_state` — would move or corrupt the row).
 *
 * An unbound proxy behaves exactly as before (legacy passthrough). That path
 * exists for the test suite and for `lib/db.ts`, which has no production
 * callers and no tenant in scope; making the parameter required is the
 * recorded follow-up (docs/adr/0007) once test constructions are swept.
 */
export type TenantScopeViolationCode =
  | "TENANT_SCOPE_UNSCOPED"
  | "TENANT_SCOPE_MISMATCH"
  | "TENANT_SCOPE_ON_GLOBAL"
  | "TENANT_SCOPE_EMPTY_BINDING";

export class TenantScopeError extends Error {
  readonly code: TenantScopeViolationCode;
  constructor(code: TenantScopeViolationCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "TenantScopeError";
    this.code = code;
  }
}

/**
 * The ONE explicit escape hatch for a deliberately unscoped read.
 * Passed as a sibling of `where` (e.g.
 * `db.batch.findFirst({ where: { id }, allowUnscopedTenantAccess: true })`)
 * and consumed before SQL is built, so it never reaches the statement.
 * Its only production use is the cross-tenant existence probe in
 * `ensureBatch` (apps/web/src/server/actions/attendance.ts) — a probe whose
 * whole purpose is to see another tenant's row. Grep for this name to audit
 * every bypass; a second use needs its own review.
 */
export const ALLOW_UNSCOPED_TENANT_ACCESS = "allowUnscopedTenantAccess" as const;

/**
 * FROZEN global-table allowlist (RFC 009 §3.3). These tables have NO
 * `tenant_id` column, so the tenant predicate must NEVER be injected into
 * their statements — it would emit SQL against a missing column. A new table
 * without `tenant_id` is added here deliberately, with its reason, or the
 * proxy treats it as tenant-scoped by default (strict). Every other model in
 * `tableMap` (and any unknown model name) is tenant-scoped.
 */
const GLOBAL_TABLES: Readonly<Record<string, string>> = {
  // Pure join table (student_id, tag_id) — prisma/schema.prisma `StudentTag`
  // declares no `tenantId`. Scoped by the tenant's own student ids at the
  // call site (erase cascade in server/actions/settings.ts), never by a
  // tenant predicate.
  student_tags:
    "pure join table (student_id, tag_id) with no tenant_id column; scoped by the tenant's own student ids at the call site",
  // Operator authentication table, not tenant data — prisma/schema.prisma
  // `AdminUser` declares no `tenantId`. A username lookup must work before
  // any tenant is known.
  admin_users:
    "operator authentication table, not tenant data; lookups precede any tenant context",
  // Process-level migration bookkeeping with no tenant_id column — written
  // by the migration runner, never per tenant.
  schema_migrations:
    "process-level migration bookkeeping; never per-tenant data",
};

/** Model names (Prisma and table spellings) that resolve to GLOBAL_TABLES. */
const GLOBAL_MODELS: ReadonlySet<string> = new Set([
  "studentTag",
  "adminUser",
  "schemaMigrations",
  "student_tags",
  "admin_users",
  "schema_migrations",
]);

function isGlobalTable(modelName: string, tableName: string): boolean {
  return GLOBAL_MODELS.has(modelName) || GLOBAL_MODELS.has(tableName) || tableName in GLOBAL_TABLES;
}

/** Reads the caller's tenant claim in either spelling (`tenantId` / `tenant_id`). */
function tenantClaimOf(
  candidate: { tenantId?: unknown; tenant_id?: unknown } | null | undefined,
): string | undefined {
  const raw = candidate?.tenantId ?? candidate?.tenant_id;
  if (raw === undefined || raw === null) return undefined;
  return String(raw);
}

/** Empty means "no predicate at all" — `undefined`, `{}`, or only-`undefined` values. */
function whereIsEmpty(where: Record<string, unknown> | null | undefined): boolean {
  if (where === null || where === undefined) return true;
  for (const key of Object.keys(where)) {
    if (where[key] !== undefined) return false;
  }
  return true;
}

interface ScopeWhereInput {
  modelName: string;
  tableName: string;
  boundTenantId: string | undefined;
  where: Record<string, unknown> | undefined;
  allowUnscoped: boolean;
}

/**
 * Returns the `where` a tenant-table statement must run with: the caller's
 * predicate plus the bound tenant (injected when absent, verified when
 * present), or throws `TenantScopeError` fail-closed. Global tables pass
 * through untouched — except a tenant claim on one, which throws instead of
 * emitting SQL against a column that does not exist.
 */
function scopeWhere(input: ScopeWhereInput): Record<string, unknown> | undefined {
  const { modelName, tableName, boundTenantId, where, allowUnscoped } = input;
  if (isGlobalTable(modelName, tableName)) {
    const stray = tenantClaimOf(where);
    if (stray !== undefined) {
      throw new TenantScopeError(
        "TENANT_SCOPE_ON_GLOBAL",
        `model "${modelName}" maps to global table "${tableName}", which has no tenant_id column — refusing a tenant-scoped predicate instead of emitting SQL against a missing column (docs/adr/0007).`,
      );
    }
    return where;
  }
  if (boundTenantId === undefined) return where;
  const claim = tenantClaimOf(where);
  if (claim !== undefined) {
    if (claim !== boundTenantId) {
      throw new TenantScopeError(
        "TENANT_SCOPE_MISMATCH",
        `model "${modelName}" proxy is bound to one tenant and the caller's predicate names another — refusing instead of reading or writing another tenant's rows (docs/adr/0007).`,
      );
    }
    return where;
  }
  if (allowUnscoped) return where;
  if (whereIsEmpty(where)) {
    throw new TenantScopeError(
      "TENANT_SCOPE_UNSCOPED",
      `model "${modelName}" (table "${tableName}") was queried with no predicate on a tenant-bound proxy — refusing a full-table operation that would touch every tenant (docs/adr/0007). Pass where: { tenantId } or the explicit ${ALLOW_UNSCOPED_TENANT_ACCESS} escape hatch.`,
    );
  }
  return { ...where, tenantId: boundTenantId };
}

interface ScopeDataInput {
  modelName: string;
  tableName: string;
  boundTenantId: string | undefined;
  data: Record<string, unknown>;
  verb: "create" | "upsert-create";
}

/**
 * `create`/`upsert`-create payload rule: inject the bound tenant when the
 * caller supplied none, throw `TENANT_SCOPE_MISMATCH` when they supplied
 * another tenant's. The caller's object is never mutated — injection returns
 * a copy.
 */
function scopeCreateData(input: ScopeDataInput): Record<string, unknown> {
  const { modelName, tableName, boundTenantId, data, verb } = input;
  if (isGlobalTable(modelName, tableName)) {
    const stray = tenantClaimOf(data);
    if (stray !== undefined) {
      throw new TenantScopeError(
        "TENANT_SCOPE_ON_GLOBAL",
        `model "${modelName}" maps to global table "${tableName}", which has no tenant_id column — refusing a ${verb} payload that carries a tenant id (docs/adr/0007).`,
      );
    }
    return data;
  }
  if (boundTenantId === undefined) return data;
  const claim = tenantClaimOf(data);
  if (claim !== undefined) {
    if (claim !== boundTenantId) {
      throw new TenantScopeError(
        "TENANT_SCOPE_MISMATCH",
        `model "${modelName}" ${verb} payload carries another tenant's id — refusing instead of writing a row the caller could never read back (docs/adr/0007).`,
      );
    }
    return data;
  }
  return { ...data, tenantId: boundTenantId };
}

/**
 * `update`/`upsert`-update payload rule: validate only, never inject.
 * Rewriting a `tenant_id` column would move the row across tenants (and
 * `tenant_id` is the PRIMARY KEY of `settings`/`app_state`, so an injected
 * SET would corrupt the key). A conflicting claim throws; an equal or
 * absent one passes through untouched.
 */
function rejectTenantReassignment(
  modelName: string,
  tableName: string,
  boundTenantId: string | undefined,
  data: Record<string, unknown> | undefined,
): void {
  if (isGlobalTable(modelName, tableName)) return;
  if (boundTenantId === undefined) return;
  if (data === undefined) return;
  const claim = tenantClaimOf(data);
  if (claim !== undefined && claim !== boundTenantId) {
    throw new TenantScopeError(
      "TENANT_SCOPE_MISMATCH",
      `model "${modelName}" update payload would move a row to another tenant — refusing (docs/adr/0007).`,
    );
  }
}

/**
 * `ORDER BY` for the first key of an `orderBy` argument (Prisma parity: the
 * shim supports the single-key form every caller in this repo uses).
 */
function buildOrderClause(orderBy: Record<string, unknown> | undefined): string {
  if (!orderBy) return "";
  const keys = Object.keys(orderBy);
  if (keys.length === 0) return "";
  const colKey = keys[0];
  if (!colKey) return "";
  const dir = String(orderBy[colKey]).toUpperCase() === "DESC" ? "DESC" : "ASC";
  return `ORDER BY "${toDbCol(colKey)}" ${dir}`;
}

/**
 * Apply a `select` projection to a camelCased row. Prisma returns only the
 * requested columns; projecting here keeps callers that read a projected row
 * (e.g. the ledger chain tip) behaving the same on either model surface.
 */
function projectRow(
  row: Record<string, any>,
  select: Record<string, unknown> | undefined,
): Record<string, any> {
  if (!select || Object.keys(select).length === 0) return row;
  const out: Record<string, any> = {};
  for (const key of Object.keys(select)) {
    if (select[key] === false) continue;
    if (key in row) out[key] = row[key];
  }
  return out;
}

/**
 * Implements: AGENTS.md §3.4 (all runtime DB access goes through the Prisma
 * model surface; no `$queryRaw` / `$executeRaw` / raw SQL at runtime).
 *
 * Row values are `Record<string, any>` rather than `unknown`: SQLite rows have
 * no static shape here, and narrowing every consumer to `unknown` would
 * require edits in `queries/students.ts`, `queries/attendance.ts` and
 * `actions/dashboard.ts`, which are outside this remediation slice
 * (audit: reviews/overhaul-audit-report-2026-09-26.md, "libsql-proxy").
 */
export interface ProxyModel {
  findUnique(args: {
    where: ProxyWhere;
    select?: ProxyWhere;
    allowUnscopedTenantAccess?: boolean;
  }): Promise<Record<string, any> | null>;
  findFirst(args?: {
    where?: ProxyWhere;
    orderBy?: ProxyWhere;
    select?: ProxyWhere;
    allowUnscopedTenantAccess?: boolean;
  }): Promise<Record<string, any> | null>;
  findMany(args?: {
    where?: ProxyWhere;
    orderBy?: ProxyWhere;
    skip?: number;
    take?: number;
    select?: ProxyWhere;
    allowUnscopedTenantAccess?: boolean;
  }): Promise<Record<string, any>[]>;
  count(args?: { where?: ProxyWhere; allowUnscopedTenantAccess?: boolean }): Promise<number>;
  aggregate(args?: Record<string, unknown>): Promise<Record<string, any>>;
  groupBy(args?: Record<string, unknown>): Promise<Record<string, any>[]>;
  create(args: { data: ProxyWhere }): Promise<Record<string, any>>;
  update(args: {
    where: ProxyWhere;
    data: ProxyWhere;
    allowUnscopedTenantAccess?: boolean;
  }): Promise<Record<string, any>>;
  updateMany(args: {
    where?: ProxyWhere;
    data: ProxyWhere;
    allowUnscopedTenantAccess?: boolean;
  }): Promise<{ count: number }>;
  upsert(args: {
    where: ProxyWhere;
    create: ProxyWhere;
    update: ProxyWhere;
    allowUnscopedTenantAccess?: boolean;
  }): Promise<Record<string, any>>;
  deleteMany(args?: { where?: ProxyWhere; allowUnscopedTenantAccess?: boolean }): Promise<{ count: number }>;
}

/**
 * `$transaction` — ONE libSQL write transaction (BEGIN IMMEDIATE) around the
 * callback, committed on return and rolled back on any throw.
 *
 * Rule 7 / BR-SYN-01: a mutation, its `sync_outbox` row and its `audit_log` row
 * must land together or not at all. The callback receives a proxy bound to the
 * open transaction, so every `tx.<model>.*` call inside it joins that
 * transaction.
 *
 * The array form is REMOVED on purpose. Prisma's `db.$transaction([p1, p2])`
 * takes *thunks*; here the array held already-started promises, so each
 * statement had already auto-committed on the outer client before
 * `$transaction` was even called — the "transaction" was a sequential await
 * with no atomicity, silently. Passing an array now throws
 * (Rule 9: never report an operation as atomic when it was not).
 */
export interface ProxyTransaction {
  <T>(fn: (tx: LibsqlProxy) => Promise<T>): Promise<T>;
  /** @deprecated Throws — use the callback form so the writes are atomic. */
  (tasks: Promise<unknown>[]): Promise<never>;
}

/**
 * The models this surface names explicitly. Declaring them (rather than
 * relying only on the catch-all index signature) is what lets a caller pass
 * the proxy to a package that types the model surface structurally — e.g.
 * `packages/core/src/feesPrisma.ts` (the invoice/payment ORM dialect), whose
 * `$transaction` callback must accept a transaction handle typed as its own
 * `OrmTx`. Everything else resolves through the index signature below.
 */
export interface ProxyModels {
  setting: ProxyModel;
  student: ProxyModel;
  invoice: ProxyModel;
  receipt: ProxyModel;
  ledgerEntry: ProxyModel;
  syncOutbox: ProxyModel;
  auditLog: ProxyModel;
}

export type LibsqlProxy = ProxyModels &
  Record<string, ProxyModel> & {
    $transaction: ProxyTransaction;
  };

/**
 * Binds a tenant into the proxy when `tenantId` is supplied (production
 * path — `getAuthenticatedPrisma` passes the session-derived tenant, never a
 * request value). Every tenant-table statement is then auto-scoped
 * (`scopeWhere` / `scopeCreateData`); an empty-string binding throws
 * `TENANT_SCOPE_EMPTY_BINDING` rather than scoping every statement to
 * nothing. Omit it only for the legacy unbound form (tests, `lib/db.ts`).
 */
export function createLibsqlProxy(client: SqlHandle, tenantId?: string): LibsqlProxy {
  if (tenantId !== undefined && tenantId.length === 0) {
    throw new TenantScopeError(
      "TENANT_SCOPE_EMPTY_BINDING",
      "createLibsqlProxy was bound to an empty tenant id — refusing, because every tenant-table statement would scope to nothing (docs/adr/0007).",
    );
  }
  const boundTenantId = tenantId;
  const modelProxy = (modelName: string) => {
    const tableMap: Record<string, string> = {
      setting: "settings",
      tutor: "tutors",
      batch: "batches",
      student: "students",
      guardian: "guardians",
      studentEnrollment: "student_enrollments",
      tag: "tags",
      studentTag: "student_tags",
      studentNote: "student_notes",
      studentDocument: "student_documents",
      attendanceSession: "attendance_sessions",
      attendanceRecord: "attendance_records",
      feePlan: "fee_plans",
      feeScheduleItem: "fee_schedule_items",
      invoice: "invoices",
      receipt: "receipts",
      ledgerEntry: "ledger_entries",
      reminder: "reminders",
      notification: "notifications",
      syncOutbox: "sync_outbox",
      auditLog: "audit_log",
      backupManifest: "backup_manifest",
      appState: "app_state",
      adminUser: "admin_users",
      // No Prisma model (migration-runner bookkeeping) — present so the
      // GLOBAL_TABLES allowlist entry is reachable by model name instead of
      // falling back to a wrong table name.
      schemaMigrations: "schema_migrations",
    };
    const tableName = tableMap[modelName] || modelName;

    return {
      findUnique: async ({ where, select, allowUnscopedTenantAccess }: any) => {
        const scoped = scopeWhere({
          modelName,
          tableName,
          boundTenantId,
          where,
          allowUnscoped: allowUnscopedTenantAccess === true,
        });
        const { whereClause, vals } = buildWhereClause(scoped);
        const res = await execSafe(client, `SELECT * FROM "${tableName}" ${whereClause} LIMIT 1`, vals);
        return res.rows[0] ? projectRow(toJsRow(res.rows[0]), select) : null;
      },
      // `orderBy` + `select` are honoured here (they were silently ignored):
      // "the latest ledger row for this student" is read with
      // `orderBy: { createdAt: "desc" }`, and without it SQLite returns an
      // arbitrary row — which produced a wrong chain tip and a wrong running
      // balance on the ORM payment path (caught by
      // packages/core/src/feesDialectParity.test.ts).
      findFirst: async ({ where, orderBy, select, allowUnscopedTenantAccess }: any = {}) => {
        const scoped = scopeWhere({
          modelName,
          tableName,
          boundTenantId,
          where,
          allowUnscoped: allowUnscopedTenantAccess === true,
        });
        const { whereClause, vals } = buildWhereClause(scoped);
        const orderClause = buildOrderClause(orderBy);
        const res = await execSafe(
          client,
          `SELECT * FROM "${tableName}" ${whereClause} ${orderClause} LIMIT 1`.trim(),
          vals,
        );
        return res.rows[0] ? projectRow(toJsRow(res.rows[0]), select) : null;
      },
      findMany: async ({ where, orderBy, skip, take, select, allowUnscopedTenantAccess }: any = {}) => {
        const scoped = scopeWhere({
          modelName,
          tableName,
          boundTenantId,
          where,
          allowUnscoped: allowUnscopedTenantAccess === true,
        });
        const { whereClause, vals } = buildWhereClause(scoped);
        const orderClause = buildOrderClause(orderBy);
        let limitClause = "";
        if (take !== undefined) {
          limitClause = `LIMIT ${Number(take)} OFFSET ${Number(skip || 0)}`;
        }
        const sql = `SELECT * FROM "${tableName}" ${whereClause} ${orderClause} ${limitClause}`.trim();
        const res = await execSafe(client, sql, vals);
        return res.rows.map((row) => projectRow(toJsRow(row), select));
      },
      count: async ({ where, allowUnscopedTenantAccess }: any = {}) => {
        const scoped = scopeWhere({
          modelName,
          tableName,
          boundTenantId,
          where,
          allowUnscoped: allowUnscopedTenantAccess === true,
        });
        const { whereClause, vals } = buildWhereClause(scoped);
        const sql = `SELECT COUNT(*) as c FROM "${tableName}" ${whereClause}`.trim();
        const res = await execSafe(client, sql, vals);
        return Number(res.rows[0]?.c || 0);
      },
      aggregate: async ({ where, _sum, _avg, _min, _max, _count, allowUnscopedTenantAccess }: any = {}) => {
        const scoped = scopeWhere({
          modelName,
          tableName,
          boundTenantId,
          where,
          allowUnscoped: allowUnscopedTenantAccess === true,
        });
        const { whereClause, vals } = buildWhereClause(scoped);
        const selects: string[] = [];
        if (_sum) {
          for (const k of Object.keys(_sum)) {
            selects.push(`SUM(CAST("${toDbCol(k)}" AS INTEGER)) as "sum_${k}"`);
          }
        }
        if (_avg) {
          for (const k of Object.keys(_avg)) {
            selects.push(`AVG(CAST("${toDbCol(k)}" AS REAL)) as "avg_${k}"`);
          }
        }
        if (_min) {
          for (const k of Object.keys(_min)) {
            selects.push(`MIN("${toDbCol(k)}") as "min_${k}"`);
          }
        }
        if (_max) {
          for (const k of Object.keys(_max)) {
            selects.push(`MAX("${toDbCol(k)}") as "max_${k}"`);
          }
        }
        if (_count) {
          if (typeof _count === "object") {
            for (const k of Object.keys(_count)) {
              selects.push(`COUNT("${toDbCol(k)}") as "count_${k}"`);
            }
          } else {
            selects.push(`COUNT(*) as "count_all"`);
          }
        }
        if (selects.length === 0) selects.push("COUNT(*) as \"count_all\"");
        const sql = `SELECT ${selects.join(", ")} FROM "${tableName}" ${whereClause}`.trim();
        const res = await execSafe(client, sql, vals);
        const row = res.rows[0] || {};
        const getVal = (r: any, key: string) => {
          if (r[key] !== undefined) return r[key];
          const camel = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
          if (r[camel] !== undefined) return r[camel];
          const lower = key.toLowerCase();
          for (const rk of Object.keys(r)) {
            if (rk.toLowerCase() === lower) return r[rk];
          }
          return undefined;
        };
        const out: any = {};
        if (_sum) {
          out._sum = {};
          for (const k of Object.keys(_sum)) {
            const sumVal = getVal(row, `sum_${k}`);
            out._sum[k] = sumVal !== undefined && sumVal !== null && !isNaN(Number(sumVal)) ? Number(sumVal) : null;
          }
        }
        if (_avg) {
          out._avg = {};
          for (const k of Object.keys(_avg)) {
            const avgVal = getVal(row, `avg_${k}`);
            out._avg[k] = avgVal !== undefined && avgVal !== null && !isNaN(Number(avgVal)) ? Number(avgVal) : null;
          }
        }
        if (_min) {
          out._min = {};
          for (const k of Object.keys(_min)) {
            out._min[k] = getVal(row, `min_${k}`) ?? null;
          }
        }
        if (_max) {
          out._max = {};
          for (const k of Object.keys(_max)) {
            out._max[k] = getVal(row, `max_${k}`) ?? null;
          }
        }
        if (_count) {
          out._count = {};
          if (typeof _count === "object") {
            for (const k of Object.keys(_count)) {
              const countVal = getVal(row, `count_${k}`);
              out._count[k] = countVal !== undefined && countVal !== null ? Number(countVal) : 0;
            }
          } else {
            const countAllVal = getVal(row, "count_all");
            out._count = countAllVal !== undefined && countAllVal !== null ? Number(countAllVal) : 0;
          }
        }
        return out;
      },
      groupBy: async ({ by, where, _sum, _avg, _min, _max, _count, allowUnscopedTenantAccess }: any = {}) => {
        const scoped = scopeWhere({
          modelName,
          tableName,
          boundTenantId,
          where,
          allowUnscoped: allowUnscopedTenantAccess === true,
        });
        const { whereClause, vals } = buildWhereClause(scoped);
        const groupCols = Array.isArray(by) ? by : [by];
        const selects: string[] = groupCols.map(k => `"${toDbCol(k)}" as "${k}"`);
        
        if (_sum) {
          for (const k of Object.keys(_sum)) {
            selects.push(`SUM(CAST("${toDbCol(k)}" AS INTEGER)) as "sum_${k}"`);
          }
        }
        if (_avg) {
          for (const k of Object.keys(_avg)) {
            selects.push(`AVG(CAST("${toDbCol(k)}" AS REAL)) as "avg_${k}"`);
          }
        }
        if (_min) {
          for (const k of Object.keys(_min)) {
            selects.push(`MIN("${toDbCol(k)}") as "min_${k}"`);
          }
        }
        if (_max) {
          for (const k of Object.keys(_max)) {
            selects.push(`MAX("${toDbCol(k)}") as "max_${k}"`);
          }
        }
        if (_count) {
          if (typeof _count === "object") {
            for (const k of Object.keys(_count)) {
              if (k === "_all") {
                selects.push(`COUNT(*) as "count_all"`);
              } else {
                selects.push(`COUNT("${toDbCol(k)}") as "count_${k}"`);
              }
            }
          } else {
            selects.push(`COUNT(*) as "count_all"`);
          }
        }

        const groupClause = `GROUP BY ${groupCols.map(k => `"${toDbCol(k)}"`).join(", ")}`;
        const sql = `SELECT ${selects.join(", ")} FROM "${tableName}" ${whereClause} ${groupClause}`.trim();
        const res = await execSafe(client, sql, vals);

        const getVal = (r: any, key: string) => {
          if (r[key] !== undefined) return r[key];
          const camel = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
          if (r[camel] !== undefined) return r[camel];
          const lower = key.toLowerCase();
          for (const rk of Object.keys(r)) {
            if (rk.toLowerCase() === lower) return r[rk];
          }
          return undefined;
        };

        return res.rows.map((row: any) => {
          const out: any = {};
          for (const k of groupCols) {
            out[k] = row[k] !== undefined ? row[k] : getVal(row, toDbCol(k));
          }
          if (_sum) {
            out._sum = {};
            for (const k of Object.keys(_sum)) {
              const sumVal = getVal(row, `sum_${k}`);
              out._sum[k] = sumVal !== undefined && sumVal !== null && !isNaN(Number(sumVal)) ? Number(sumVal) : null;
            }
          }
          if (_avg) {
            out._avg = {};
            for (const k of Object.keys(_avg)) {
              const avgVal = getVal(row, `avg_${k}`);
              out._avg[k] = avgVal !== undefined && avgVal !== null && !isNaN(Number(avgVal)) ? Number(avgVal) : null;
            }
          }
          if (_min) {
            out._min = {};
            for (const k of Object.keys(_min)) {
              out._min[k] = getVal(row, `min_${k}`) ?? null;
            }
          }
          if (_max) {
            out._max = {};
            for (const k of Object.keys(_max)) {
              out._max[k] = getVal(row, `max_${k}`) ?? null;
            }
          }
          if (_count) {
            out._count = {};
            if (typeof _count === "object") {
              for (const k of Object.keys(_count)) {
                if (k === "_all") {
                  const countAllVal = getVal(row, "count_all");
                  out._count[k] = countAllVal !== undefined && countAllVal !== null ? Number(countAllVal) : 0;
                } else {
                  const countVal = getVal(row, `count_${k}`);
                  out._count[k] = countVal !== undefined && countVal !== null ? Number(countVal) : 0;
                }
              }
            } else {
              const countAllVal = getVal(row, "count_all");
              out._count = countAllVal !== undefined && countAllVal !== null ? Number(countAllVal) : 0;
            }
          }
          return out;
        });
      },
      create: async ({ data }: any) => {
        const scopedData = scopeCreateData({ modelName, tableName, boundTenantId, data, verb: "create" });
        const rawCols = Object.keys(scopedData).filter((k) => {
          const v = scopedData[k];
          if (v === undefined) return false;
          if (isAtomicNumberOp(v)) {
            throw new Error(
              `ORM_CREATE_ATOMIC_OP: \`${k}\` uses an atomic operator, which only applies to update (Prisma parity)`,
            );
          }
          return true;
        });
        const dbCols = rawCols.map(toDbCol);
        const vals = rawCols.map((k) => toSqlValue(scopedData[k]));
        const sql = `INSERT INTO "${tableName}" (${dbCols.map((c) => `"${c}"`).join(",")}) VALUES (${dbCols.map(() => "?").join(",")})`;
        await execSafe(client, sql, vals);
        return scopedData;
      },
      update: async ({ where, data, allowUnscopedTenantAccess }: any) => {
        const scoped = scopeWhere({
          modelName,
          tableName,
          boundTenantId,
          where,
          allowUnscoped: allowUnscopedTenantAccess === true,
        });
        rejectTenantReassignment(modelName, tableName, boundTenantId, data);
        const { whereClause, vals: whereVals } = buildWhereClause(scoped);
        const { setStr, setVals } = buildSetClause(data);
        const sql = `UPDATE "${tableName}" SET ${setStr} ${whereClause}`;
        await execSafe(client, sql, [...setVals, ...whereVals]);
        return data;
      },
      // `update` cannot report a row count on this surface (it returns the
      // payload). `updateMany` can — callers that must prove the row existed
      // (`STUDENT_NOT_FOUND`, F5) use it to read `{ count }` instead of
      // silently writing nothing.
      updateMany: async ({ where, data, allowUnscopedTenantAccess }: any) => {
        const scoped = scopeWhere({
          modelName,
          tableName,
          boundTenantId,
          where,
          allowUnscoped: allowUnscopedTenantAccess === true,
        });
        rejectTenantReassignment(modelName, tableName, boundTenantId, data);
        const { whereClause, vals: whereVals } = buildWhereClause(scoped);
        const { setStr, setVals } = buildSetClause(data);
        const res = await execSafe(
          client,
          `UPDATE "${tableName}" SET ${setStr} ${whereClause}`.trim(),
          [...setVals, ...whereVals],
        );
        return { count: Number(res.rowsAffected || 0) };
      },
      upsert: async ({ where, create, update, allowUnscopedTenantAccess }: any) => {
        const allowUnscoped = allowUnscopedTenantAccess === true;
        const scopedWhere = scopeWhere({ modelName, tableName, boundTenantId, where, allowUnscoped });
        const scopedCreate = scopeCreateData({ modelName, tableName, boundTenantId, data: create, verb: "upsert-create" });
        rejectTenantReassignment(modelName, tableName, boundTenantId, update);
        const { whereClause, vals: whereVals } = buildWhereClause(scopedWhere);
        const existing = await execSafe(client, `SELECT * FROM "${tableName}" ${whereClause} LIMIT 1`, whereVals);
        if (existing.rows && existing.rows.length > 0) {
          const rawCols = Object.keys(update).filter(k => update[k] !== undefined);
          const dbCols = rawCols.map(toDbCol);
          const setVals = rawCols.map(k => update[k] instanceof Date ? update[k].toISOString() : update[k]);
          const setStr = dbCols.map(c => `"${c}" = ?`).join(",");
          await execSafe(client, `UPDATE "${tableName}" SET ${setStr} ${whereClause}`, [...setVals, ...whereVals]);
          return { ...toJsRow(existing.rows[0]), ...update };
        } else {
          const rawCols = Object.keys(scopedCreate).filter(k => scopedCreate[k] !== undefined);
          const dbCols = rawCols.map(toDbCol);
          // `toSqlValue` (not the legacy Date-only inline): the scoped copy is
          // typed `Record<string, unknown>`, and this also serialises objects
          // instead of binding "[object Object]" — same rule as `create`.
          const vals = rawCols.map((k) => toSqlValue(scopedCreate[k]));
          await execSafe(client, `INSERT INTO "${tableName}" (${dbCols.map(c => `"${c}"`).join(",")}) VALUES (${dbCols.map(() => "?").join(",")})`, vals);
          return scopedCreate;
        }
      },
      deleteMany: async ({ where, allowUnscopedTenantAccess }: any = {}) => {
        const scoped = scopeWhere({
          modelName,
          tableName,
          boundTenantId,
          where,
          allowUnscoped: allowUnscopedTenantAccess === true,
        });
        const { whereClause, vals } = buildWhereClause(scoped);
        const res = await execSafe(client, `DELETE FROM "${tableName}" ${whereClause}`.trim(), vals);
        return { count: Number(res.rowsAffected || 0) };
      }
    };
  };

  // SAFETY: the proxy target is empty; every property is synthesised by the
  // `get` trap below, so no stored value can be mutated by the caller.
  return new Proxy({} as LibsqlProxy, {
    get: (_, prop: string) => {
      if (prop === "$transaction") {
        return async (arg: unknown) => {
          if (typeof arg !== "function") {
            throw new Error(
              "ORM_TX_ARRAY_FORM_REMOVED: db.$transaction([...]) cannot be atomic — its entries are already-started promises that auto-committed before this call. Use db.$transaction(async (tx) => { ... }) so the write, its sync_outbox row and its audit_log row share one write transaction (AGENTS.md §2 Rule 7, BR-SYN-01).",
            );
          }
          if (typeof client.transaction !== "function") {
            throw new Error(
              "ORM_TX_UNSUPPORTED_HANDLE: this proxy is already bound to an open transaction; nested $transaction is not supported (open the outer transaction once).",
            );
          }
          const txHandle = await client.transaction("write");
          // Rule 7 / tenant binding: the transaction proxy inherits the bound
          // tenant, so a transaction cannot straddle two tenants — a
          // cross-tenant create inside it throws and rolls everything back.
          const txProxy = createLibsqlProxy(txHandle, boundTenantId);
          try {
            const value = await (arg as (tx: LibsqlProxy) => Promise<unknown>)(txProxy);
            await txHandle.commit();
            return value;
          } catch (error) {
            // Rule 9 / BR-SEC-03 fail-closed: a failed transaction leaves NOTHING
            // half-written. A rollback failure is reported, never swallowed.
            try {
              await txHandle.rollback();
            } catch (rollbackError) {
              throw new Error(
                `${error instanceof Error ? error.message : String(error)}; rollback also failed: ${
                  rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
                }`,
              );
            }
            throw error;
          }
        };
      }
      // No `$executeRaw` / `$queryRaw` (raw or unsafe) surface: raw SQL at
      // runtime is forbidden by AGENTS.md §3.4 (audit line: "raw SQL exposure").
      return modelProxy(prop);
    },
  });
}
