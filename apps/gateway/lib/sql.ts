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

async function directPipelineExecute(
  sql: string,
  args: unknown[] = [],
  dbUrl?: string,
  dbToken?: string
): Promise<{ rows: Record<string, unknown>[]; rowsAffected?: number }> {
  const formattedArgs = args.map((a) => {
    if (a === null || a === undefined) return { type: "null" };
    if (typeof a === "number")
      return Number.isInteger(a)
        ? { type: "integer", value: String(a) }
        : { type: "float", value: a };
    return { type: "text", value: String(a) };
  });

  let host = resolveTursoUrl(dbUrl);
  const token = resolveToken(dbToken);
  if (host.startsWith("libsql://")) host = host.replace("libsql://", "https://");

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
      body: JSON.stringify({
        requests: [
          {
            type: "execute",
            stmt: {
              sql,
              args: formattedArgs,
            },
          },
          { type: "close" },
        ],
      }),
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Turso pipeline HTTP ${res.status}: ${errText}`);
  }

  const json = await res.json();
  const execResult = json.results?.[0]?.response?.result;
  if (!execResult) return { rows: [] };

  const cols: string[] = execResult.cols.map((c: { name: string }) => c.name);
  const rows: Record<string, unknown>[] = (execResult.rows || []).map(
    (row: Array<{ value?: unknown }>) => {
      const obj: Record<string, unknown> = {};
      cols.forEach((col, idx) => {
        const cell = row[idx];
        obj[col] = cell?.value !== undefined ? cell.value : null;
      });
      return obj;
    }
  );

  return { rows, rowsAffected: execResult?.affected_row_count ?? 0 };
}

export async function run(
  db: SqlHandle,
  sql: string,
  args: unknown[] = []
): Promise<{ rows: Record<string, unknown>[]; rowsAffected?: number }> {
  try {
    const res = await db.execute({ sql, args });
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
    try {
      return await directPipelineExecute(sql, args);
    } catch (pipelineErr) {
      // P3-10, Rule 9: the fallback must never be able to hide WHY the primary
      // handle failed. A real statement error (a column renamed under a stale
      // INSERT, a constraint violation) would otherwise be reported as a Turso
      // HTTP failure and point the operator at the network instead of at the
      // SQL. Chain both — message for logs, `cause` for the primary root cause.
      const primary = err instanceof Error ? err.message : String(err);
      const fallback =
        pipelineErr instanceof Error ? pipelineErr.message : String(pipelineErr);
      throw new Error(`statement failed: ${primary} (pipeline fallback: ${fallback})`, {
        cause: err,
      });
    }
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
  "student_enrollments",
  "attendance_sessions",
  "attendance_records",
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

/** Audited `tenant_id = ? AND ...` builder (preserves `orm.ts buildWhere`
 * semantics byte-for-byte: `IS NULL` / `IS NOT NULL` / `!= ?` / `IN (?,..)` /
 * empty-IN `1=0` / `= ?`; `tenantId`/`tenant_id` keys skipped). Values via
 * `?`; only audited column refs are interpolated. */
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
    } else {
      clauses.push(`${col} = ?`);
      params.push(val);
    }
  }
  return { sql: clauses.join(" AND "), args: params };
}

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
const ATTENDANCE_SESSION_SORT = new Set(["session_date", "batch_name", "created_at"]);
const LEDGER_SORT = new Set(["occurred_on", "type", "created_at"]);
const NOTIFICATION_SORT = new Set(["category", "created_at", "read"]);

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
    sql: `INSERT INTO receipts (id, tenant_id, receipt_no, student_id, invoice_id, amount, payment_method, payment_ref, received_on, tamper_hash, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      tenant,
      ((d.receiptNo as string | undefined) ?? (d.number as string | undefined)) as unknown,
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
  for (const [k, v] of Object.entries(d ?? {})) {
    const col = auditedCamelToSnake(k);
    if (!cols.includes(col)) {
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

export function stmtChainTip(tenantId: string, studentId: string): BuiltStatement {
  return {
    sql: `SELECT this_hash, balance_after_paise FROM ledger_entries
      WHERE tenant_id = ? AND student_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1`,
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
    sql: "SELECT id FROM receipts WHERE tenant_id = ? AND receipt_no = ? AND voided_at IS NULL",
    args: [auditedTenant(tenantId), z.string().min(1).max(64).parse(receiptNo)],
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

const ERASE_TABLES = [
  "ledger_entries",
  "receipts",
  "invoices",
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
    sql: `SELECT * FROM students WHERE ${where.join(" AND ")} ORDER BY first_name LIMIT ? OFFSET ?`,
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
    sql: "SELECT * FROM ledger_entries WHERE tenant_id = ? ORDER BY occurred_on DESC LIMIT ? OFFSET ?",
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
