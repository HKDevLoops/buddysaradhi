// Implements: 11_Data_Model.md §1 & AGENTS.md §3.4
// Mandatory Prisma ORM method adapter for libSQL.
// The handle type is `SqlHandle` (lib/sql.ts), not `lib/db.ts`'s `Client`:
// ledger mutations pass an interactive transaction here (BR-SYN-01 / audit
// 2026-09-26 G2), and integration tests pass a real SQLite handle.
//
// Security refactor: every statement is built by audited builders in
// `lib/sql.ts` (Zod-validated, `?`-parameterized, allowlisted identifiers).
// This module holds zero SQL string literals — it maps rows and delegates.
import {
  allRows,
  oneRow,
  run,
  type SqlHandle,
  stmtSelectWhere,
  stmtSelectOneWhere,
  stmtCountWhere,
  stmtDeleteWhere,
  stmtUpdateWhere,
  stmtInsertStudent,
  stmtInsertBatch,
  stmtInsertEnrollment,
  stmtInsertAttendanceSession,
  stmtInsertAttendanceRecordUpsert,
  stmtInsertInvoice,
  stmtInsertLedgerEntry,
  stmtInsertReceipt,
  stmtInsertSetting,
  stmtInsertNotification,
  stmtInsertAuditLog,
  stmtInsertSyncOutbox,
  stmtAuditLogFindMany,
  stmtSyncOutboxFindMany,
  STUDENT_SORT,
  ATTENDANCE_SESSION_SORT,
  LEDGER_SORT,
  NOTIFICATION_SORT,
} from "./sql.ts";

// ── The orderBy seam ─────────────────────────────────────────────────────────────
// Implements: AGENTS.md §3.4 (no caller-supplied string reaches SQL text) +
// Rule 9 (no silent failures) + 11_Data_Model.md §1 (columns are the table's own).
//
// Why this seam exists: `stmtSelectWhere` (lib/sql.ts:400-411) DROPS an ORDER BY it
// cannot validate. An unknown column or a direction outside ASC/DESC produces a
// statement with no ORDER BY clause at all — no error, arbitrary row order. For the
// roster that means a sort control in the UI looks wired up while the server pages
// over an unordered result set, which also makes paging non-deterministic (the same
// row can appear on two pages). "Accepted and ignored" is the defect, not the
// injection risk: the allowlists below are already enforced in sql.ts.
//
// `resolveOrderBy` is the ONE place an orderBy crosses into SQL. A model either has
// an allowlist here or it has no orderBy at all — there is no accept-and-ignore path.
// Unknown column, bad direction, or more than one key throws
// `OrderByNotAllowedError`, which routes turn into a typed 400 naming the field.

/** Raised when a caller asks a model to sort by something that model cannot sort
 *  by. Never swallowed: an unsortable column is a contract violation, not a hint. */
export class OrderByNotAllowedError extends Error {
  readonly model: string;
  readonly column: string;
  readonly allowed: readonly string[];

  constructor(model: string, column: string, allowed: readonly string[], why: string) {
    super(
      `${model}.findMany: cannot order by ${column} — ${why}. Allowed: ${allowed.join(", ")}.`,
    );
    this.name = "OrderByNotAllowedError";
    this.model = model;
    this.column = column;
    this.allowed = allowed;
  }
}

/** Columns each model's table ACTUALLY has (11_Data_Model.md §1 + lib/schema.ts
 *  DDL). This is the authority: a column absent here is a column SQLite would
 *  reject at prepare time. */
const MODEL_SORT_COLUMNS = {
  student: new Set([
    "first_name",
    "last_name",
    "code",
    "status",
    "grade",
    "balance_paise",
    "admission_date",
    "created_at",
    "updated_at",
  ]),
  batch: new Set(["name", "created_at", "updated_at"]),
  attendanceSession: new Set(["session_date", "batch_id", "created_at"]),
  invoice: new Set(["number", "issue_date", "due_date", "total", "status", "created_at"]),
  ledgerEntry: new Set(["occurred_on", "type", "created_at"]),
  receipt: new Set(["receipt_no", "received_on", "amount", "created_at"]),
  notification: new Set(["category", "created_at", "read_at"]),
} as const;

type SortModel = keyof typeof MODEL_SORT_COLUMNS;

/** The enforcement sets lib/sql.ts already owns. A model listed here is gated
 *  twice — once here and once in sql.ts — which is the point. */
const SQL_SORT_GATE: Partial<Record<SortModel, Set<string>>> = {
  student: STUDENT_SORT,
  attendanceSession: ATTENDANCE_SESSION_SORT,
  ledgerEntry: LEDGER_SORT,
  notification: NOTIFICATION_SORT,
};

/** Effective allowlist = real columns ∩ the sql.ts gate.
 *
 *  The intersection is load-bearing, not defensive tidiness. It was added to
 *  paper over two entries in the sql.ts gates that named columns which do not
 *  exist — `notifications.read` (the column is `read_at`) and
 *  `attendance_sessions.batch_name` (it is `batch_id`). Both have since been
 *  corrected at the source (lib/sql.ts), so the intersection no longer
 *  rescues anything: for every model it now equals its `gate`.
 *
 *  It is kept anyway, and deliberately. It is the defence that turns a future
 *  schema drift (a renamed column in one authority only) into a typed
 *  `OrderByNotAllowedError` naming the field, rather than a statement that
 *  fails at SQLite prepare time with an opaque error. `EFFECTIVE_SORT_COLUMNS`
 *  never widens the gate — it can only narrow it. */
// Mutable `Set` (not ReadonlySet) because `stmtSelectWhere`'s parameter type is
// `Set<string>` (lib/sql.ts:394); nothing here mutates them after construction.
const EFFECTIVE_SORT_COLUMNS: Record<SortModel, Set<string>> = (() => {
  const out = {} as Record<SortModel, Set<string>>;
  for (const model of Object.keys(MODEL_SORT_COLUMNS) as SortModel[]) {
    const real = MODEL_SORT_COLUMNS[model];
    const gate = SQL_SORT_GATE[model];
    if (!gate) {
      out[model] = real;
      continue;
    }
    const both = new Set<string>();
    for (const col of real) if (gate.has(col)) both.add(col);
    out[model] = both;
  }
  return out;
})();

function sortedColumns(model: SortModel): string[] {
  return [...EFFECTIVE_SORT_COLUMNS[model]].sort();
}

/** Sort keys are a lookup, not SQL: a key that is not in the allowlist is
 *  rejected before anything is built. No regex validation needed here — the
 *  allowlist already contains only `[a-z_][a-z0-9_]*` literals. */
function camelToSnakeKey(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** Validates a caller orderBy and returns the canonical `{ snake_col: "ASC" |
 *  "DESC" }` for the audited builder. Returns undefined when no orderBy was asked
 *  for. Throws `OrderByNotAllowedError` for anything the model cannot honour. */
export function resolveOrderBy(
  model: SortModel,
  orderBy: Record<string, "asc" | "desc"> | undefined,
): Record<string, string> | undefined {
  if (!orderBy) return undefined;
  const entries = Object.entries(orderBy);
  if (entries.length === 0) return undefined;

  const allowed = sortedColumns(model);
  if (entries.length > 1) {
    throw new OrderByNotAllowedError(
      model,
      `${entries.length} sort keys at once`,
      allowed,
      "the audited builder orders by a single column (lib/sql.ts)",
    );
  }

  const [col, dir] = entries[0] as [string, string];
  const snakeCol = camelToSnakeKey(col);
  if (!EFFECTIVE_SORT_COLUMNS[model].has(snakeCol)) {
    throw new OrderByNotAllowedError(model, `"${col}"`, allowed, "no such sortable column");
  }
  if (dir !== "asc" && dir !== "desc") {
    throw new OrderByNotAllowedError(
      model,
      `"${col} ${String(dir)}"`,
      allowed,
      'direction must be "asc" or "desc"',
    );
  }
  return { [snakeCol]: dir === "asc" ? "ASC" : "DESC" };
}

export interface PrismaOrm {
  student: {
    findMany(
      args?: {
        where?: Record<string, any>;
        orderBy?: Record<string, "asc" | "desc">;
        take?: number;
        skip?: number;
      },
    ): Promise<Record<string, any>[]>;
    findFirst(
      args: { where: Record<string, any> },
    ): Promise<Record<string, any> | null>;
    create(args: { data: Record<string, any> }): Promise<Record<string, any>>;
    update(
      args: { where: Record<string, any>; data: Record<string, any> },
    ): Promise<Record<string, any>>;
    delete(args: { where: Record<string, any> }): Promise<void>;
    count(args?: { where?: Record<string, any> }): Promise<number>;
  };
  batch: {
    findMany(
      args?: {
        where?: Record<string, any>;
        orderBy?: Record<string, "asc" | "desc">;
      },
    ): Promise<Record<string, any>[]>;
    findFirst(
      args: { where: Record<string, any> },
    ): Promise<Record<string, any> | null>;
    create(args: { data: Record<string, any> }): Promise<Record<string, any>>;
    update(
      args: { where: Record<string, any>; data: Record<string, any> },
    ): Promise<Record<string, any>>;
  };
  studentEnrollment: {
    findMany(
      args?: { where?: Record<string, any> },
    ): Promise<Record<string, any>[]>;
    create(args: { data: Record<string, any> }): Promise<Record<string, any>>;
    deleteMany(args: { where: Record<string, any> }): Promise<number>;
  };
  attendanceSession: {
    findMany(
      args?: {
        where?: Record<string, any>;
        orderBy?: Record<string, "asc" | "desc">;
        take?: number;
      },
    ): Promise<Record<string, any>[]>;
    findFirst(
      args: { where: Record<string, any> },
    ): Promise<Record<string, any> | null>;
    create(args: { data: Record<string, any> }): Promise<Record<string, any>>;
    update(
      args: { where: Record<string, any>; data: Record<string, any> },
    ): Promise<Record<string, any>>;
  };
  attendanceRecord: {
    findMany(
      args?: { where?: Record<string, any> },
    ): Promise<Record<string, any>[]>;
    createMany(args: { data: Record<string, any>[] }): Promise<number>;
  };
  invoice: {
    findMany(
      args?: {
        where?: Record<string, any>;
        orderBy?: Record<string, "asc" | "desc">;
        take?: number;
      },
    ): Promise<Record<string, any>[]>;
    findFirst(
      args: { where: Record<string, any> },
    ): Promise<Record<string, any> | null>;
    create(args: { data: Record<string, any> }): Promise<Record<string, any>>;
    update(
      args: { where: Record<string, any>; data: Record<string, any> },
    ): Promise<Record<string, any>>;
  };
  ledgerEntry: {
    findMany(
      args?: {
        where?: Record<string, any>;
        orderBy?: Record<string, "asc" | "desc">;
        take?: number;
      },
    ): Promise<Record<string, any>[]>;
    create(args: { data: Record<string, any> }): Promise<Record<string, any>>;
  };
  receipt: {
    findMany(
      args?: {
        where?: Record<string, any>;
        orderBy?: Record<string, "asc" | "desc">;
        take?: number;
      },
    ): Promise<Record<string, any>[]>;
    findFirst(
      args: { where: Record<string, any> },
    ): Promise<Record<string, any> | null>;
    create(args: { data: Record<string, any> }): Promise<Record<string, any>>;
  };
  setting: {
    findFirst(
      args: { where: Record<string, any> },
    ): Promise<Record<string, any> | null>;
    upsert(
      args: {
        where: Record<string, any>;
        create: Record<string, any>;
        update: Record<string, any>;
      },
    ): Promise<Record<string, any>>;
    update(
      args: { where: Record<string, any>; data: Record<string, any> },
    ): Promise<Record<string, any>>;
  };
  notification: {
    findMany(
      args?: {
        where?: Record<string, any>;
        orderBy?: Record<string, "asc" | "desc">;
        take?: number;
      },
    ): Promise<Record<string, any>[]>;
    create(args: { data: Record<string, any> }): Promise<Record<string, any>>;
  };
  auditLog: {
    create(args: { data: Record<string, any> }): Promise<Record<string, any>>;
    findMany(
      args?: { where?: Record<string, any>; take?: number },
    ): Promise<Record<string, any>[]>;
  };
  syncOutbox: {
    create(args: { data: Record<string, any> }): Promise<Record<string, any>>;
    findMany(
      args?: { where?: Record<string, any>; take?: number },
    ): Promise<Record<string, any>[]>;
  };
}

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function mapRowToCamel(
  row: Record<string, any> | null,
): Record<string, any> | null {
  if (!row) return null;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    out[snakeToCamel(k)] = v;
  }
  return out;
}

export function createPrismaOrm(db: SqlHandle, tenantId: string): PrismaOrm {
  return {
    student: {
      findMany: async (args = {}) => {
        const stmt = stmtSelectWhere("students", tenantId, args.where ?? {}, {
          orderBy: resolveOrderBy("student", args.orderBy),
          take: args.take,
          skip: args.skip,
          orderAllowed: STUDENT_SORT,
        });
        const rows = await allRows(db, stmt.sql, stmt.args);
        return rows.map(mapRowToCamel) as Record<string, any>[];
      },
      findFirst: async (args) => {
        const stmt = stmtSelectOneWhere("students", tenantId, args.where);
        const row = await oneRow(db, stmt.sql, stmt.args);
        return mapRowToCamel(row);
      },
      create: async (args) => {
        const d = args.data;
        const studentId = (d.id as string | undefined) ?? crypto.randomUUID();
        const stmt = stmtInsertStudent(tenantId, { ...d, id: studentId });
        await run(db, stmt.sql, stmt.args);
        const back = stmtSelectOneWhere("students", tenantId, { id: studentId });
        return mapRowToCamel(await oneRow(db, back.sql, back.args))!;
      },
      update: async (args) => {
        const now = new Date().toISOString();
        const stmt = stmtUpdateWhere("students", tenantId, args.where, {
          ...args.data,
          updatedAt: now,
        });
        await run(db, stmt.sql, stmt.args);
        if (args.where.id) {
          const back = stmtSelectOneWhere("students", tenantId, { id: args.where.id });
          return mapRowToCamel(await oneRow(db, back.sql, back.args))!;
        }
        const back = stmtSelectWhere("students", tenantId, args.where ?? {});
        const row = await oneRow(db, back.sql, back.args);
        return mapRowToCamel(row)!;
      },
      delete: async (args) => {
        const stmt = stmtDeleteWhere("students", tenantId, args.where);
        await run(db, stmt.sql, stmt.args);
      },
      count: async (args = {}) => {
        const stmt = stmtCountWhere("students", tenantId, args.where ?? {});
        const r = await oneRow(db, stmt.sql, stmt.args);
        return Number(r?.c ?? 0);
      },
    },

    batch: {
      findMany: async (args = {}) => {
        const stmt = stmtSelectWhere("batches", tenantId, args.where ?? {}, {
          orderBy: resolveOrderBy("batch", args.orderBy),
          orderAllowed: EFFECTIVE_SORT_COLUMNS.batch,
        });
        const rows = await allRows(db, stmt.sql, stmt.args);
        return rows.map(mapRowToCamel) as Record<string, any>[];
      },
      findFirst: async (args) => {
        const stmt = stmtSelectOneWhere("batches", tenantId, args.where);
        const row = await oneRow(db, stmt.sql, stmt.args);
        return mapRowToCamel(row);
      },
      create: async (args) => {
        const d = args.data;
        const id = (d.id as string | undefined) ?? crypto.randomUUID();
        const stmt = stmtInsertBatch(tenantId, { ...d, id });
        await run(db, stmt.sql, stmt.args);
        const back = stmtSelectOneWhere("batches", tenantId, { id });
        return mapRowToCamel(await oneRow(db, back.sql, back.args))!;
      },
      update: async (args) => {
        const stmt = stmtUpdateWhere("batches", tenantId, args.where, args.data);
        await run(db, stmt.sql, stmt.args);
        const back = stmtSelectWhere("batches", tenantId, args.where ?? {});
        const row = await oneRow(db, back.sql, back.args);
        return mapRowToCamel(row)!;
      },
    },

    studentEnrollment: {
      findMany: async (args = {}) => {
        const stmt = stmtSelectWhere("student_enrollments", tenantId, args.where ?? {});
        const rows = await allRows(db, stmt.sql, stmt.args);
        return rows.map(mapRowToCamel) as Record<string, any>[];
      },
      create: async (args) => {
        const d = args.data;
        const id = (d.id as string | undefined) ?? crypto.randomUUID();
        const stmt = stmtInsertEnrollment(tenantId, { ...d, id });
        await run(db, stmt.sql, stmt.args);
        const back = stmtSelectOneWhere("student_enrollments", tenantId, { id });
        return mapRowToCamel(await oneRow(db, back.sql, back.args))!;
      },
      deleteMany: async (args) => {
        const stmt = stmtDeleteWhere("student_enrollments", tenantId, args.where);
        const res = await run(db, stmt.sql, stmt.args);
        return res.rowsAffected ?? 0;
      },
    },

    attendanceSession: {
      findMany: async (args = {}) => {
        const stmt = stmtSelectWhere("attendance_sessions", tenantId, args.where ?? {}, {
          orderBy: resolveOrderBy("attendanceSession", args.orderBy),
          take: args.take,
          orderAllowed: ATTENDANCE_SESSION_SORT,
        });
        const rows = await allRows(db, stmt.sql, stmt.args);
        return rows.map(mapRowToCamel) as Record<string, any>[];
      },
      findFirst: async (args) => {
        const stmt = stmtSelectOneWhere("attendance_sessions", tenantId, args.where);
        const row = await oneRow(db, stmt.sql, stmt.args);
        return mapRowToCamel(row);
      },
      create: async (args) => {
        const d = args.data;
        const id = (d.id as string | undefined) ?? crypto.randomUUID();
        const stmt = stmtInsertAttendanceSession(tenantId, { ...d, id });
        await run(db, stmt.sql, stmt.args);
        const back = stmtSelectOneWhere("attendance_sessions", tenantId, { id });
        return mapRowToCamel(await oneRow(db, back.sql, back.args))!;
      },
      update: async (args) => {
        const stmt = stmtUpdateWhere("attendance_sessions", tenantId, args.where, args.data);
        await run(db, stmt.sql, stmt.args);
        const back = stmtSelectWhere("attendance_sessions", tenantId, args.where ?? {});
        const row = await oneRow(db, back.sql, back.args);
        return mapRowToCamel(row)!;
      },
    },

    attendanceRecord: {
      findMany: async (args = {}) => {
        const stmt = stmtSelectWhere("attendance_records", tenantId, args.where ?? {});
        const rows = await allRows(db, stmt.sql, stmt.args);
        return rows.map(mapRowToCamel) as Record<string, any>[];
      },
      createMany: async (args) => {
        let count = 0;
        for (const d of args.data) {
          const id = (d.id as string | undefined) ?? crypto.randomUUID();
          const stmt = stmtInsertAttendanceRecordUpsert(tenantId, { ...d, id });
          await run(db, stmt.sql, stmt.args);
          count++;
        }
        return count;
      },
    },

    invoice: {
      findMany: async (args = {}) => {
        const stmt = stmtSelectWhere("invoices", tenantId, args.where ?? {}, {
          orderBy: resolveOrderBy("invoice", args.orderBy),
          take: args.take,
          orderAllowed: EFFECTIVE_SORT_COLUMNS.invoice,
        });
        const rows = await allRows(db, stmt.sql, stmt.args);
        return rows.map(mapRowToCamel) as Record<string, any>[];
      },
      findFirst: async (args) => {
        const stmt = stmtSelectOneWhere("invoices", tenantId, args.where);
        const row = await oneRow(db, stmt.sql, stmt.args);
        return mapRowToCamel(row);
      },
      create: async (args) => {
        const d = args.data;
        if (typeof d.number !== "string" || d.number.length === 0) {
          throw new Error(
            `invoices.number is required (11_Data_Model.md §4.12) for student ${String(d.studentId)}`
          );
        }
        if (typeof d.tamperHash !== "string" || d.tamperHash.length === 0) {
          throw new Error(
            `invoices.tamper_hash is required (10_Security.md §10) for invoice ${d.number}`
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
            `invoices money columns must be integer paise (12_Business_Rules.md BR-M-01) for invoice ${d.number}`
          );
        }
        const id = (d.id as string | undefined) ?? crypto.randomUUID();
        const stmt = stmtInsertInvoice(tenantId, { ...d, id });
        await run(db, stmt.sql, stmt.args);
        const back = stmtSelectOneWhere("invoices", tenantId, { id });
        return mapRowToCamel(await oneRow(db, back.sql, back.args))!;
      },
      update: async (args) => {
        const stmt = stmtUpdateWhere("invoices", tenantId, args.where, args.data);
        await run(db, stmt.sql, stmt.args);
        const back = stmtSelectWhere("invoices", tenantId, args.where ?? {});
        const row = await oneRow(db, back.sql, back.args);
        return mapRowToCamel(row)!;
      },
    },

    ledgerEntry: {
      findMany: async (args = {}) => {
        const stmt = stmtSelectWhere("ledger_entries", tenantId, args.where ?? {}, {
          orderBy: resolveOrderBy("ledgerEntry", args.orderBy),
          take: args.take,
          orderAllowed: LEDGER_SORT,
        });
        const rows = await allRows(db, stmt.sql, stmt.args);
        return rows.map(mapRowToCamel) as Record<string, any>[];
      },
      create: async (args) => {
        const d = args.data;
        if (typeof d.thisHash !== "string" || d.thisHash.length === 0) {
          throw new Error(
            `ledger_entries.this_hash is required (BR-LED-06) for ${d.type} entry`
          );
        }
        const id = (d.id as string | undefined) ?? crypto.randomUUID();
        const stmt = stmtInsertLedgerEntry(tenantId, { ...d, id });
        await run(db, stmt.sql, stmt.args);
        const back = stmtSelectOneWhere("ledger_entries", tenantId, { id });
        return mapRowToCamel(await oneRow(db, back.sql, back.args))!;
      },
    },

    receipt: {
      findMany: async (args = {}) => {
        const stmt = stmtSelectWhere("receipts", tenantId, args.where ?? {}, {
          orderBy: resolveOrderBy("receipt", args.orderBy),
          take: args.take,
          orderAllowed: EFFECTIVE_SORT_COLUMNS.receipt,
        });
        const rows = await allRows(db, stmt.sql, stmt.args);
        return rows.map(mapRowToCamel) as Record<string, any>[];
      },
      findFirst: async (args) => {
        const stmt = stmtSelectOneWhere("receipts", tenantId, args.where);
        const row = await oneRow(db, stmt.sql, stmt.args);
        return mapRowToCamel(row);
      },
      create: async (args) => {
        const d = args.data;
        const id = (d.id as string | undefined) ?? crypto.randomUUID();
        const stmt = stmtInsertReceipt(tenantId, { ...d, id });
        await run(db, stmt.sql, stmt.args);
        const back = stmtSelectOneWhere("receipts", tenantId, { id });
        return mapRowToCamel(await oneRow(db, back.sql, back.args))!;
      },
    },

    setting: {
      findFirst: async (args) => {
        const stmt = stmtSelectOneWhere("settings", tenantId, args.where);
        const row = await oneRow(db, stmt.sql, stmt.args);
        return mapRowToCamel(row);
      },
      upsert: async (args) => {
        const existingStmt = stmtSelectOneWhere("settings", tenantId, {});
        const existing = await oneRow(db, existingStmt.sql, existingStmt.args);
        const now = new Date().toISOString();
        if (!existing) {
          const stmt = stmtInsertSetting(tenantId, args.create);
          await run(db, stmt.sql, stmt.args);
        } else {
          const stmt = stmtUpdateWhere("settings", tenantId, {}, {
            ...args.update,
            updatedAt: now,
          });
          await run(db, stmt.sql, stmt.args);
        }
        const back = stmtSelectOneWhere("settings", tenantId, {});
        return mapRowToCamel(await oneRow(db, back.sql, back.args))!;
      },
      update: async (args) => {
        const now = new Date().toISOString();
        const stmt = stmtUpdateWhere("settings", tenantId, {}, {
          ...args.data,
          updatedAt: now,
        });
        await run(db, stmt.sql, stmt.args);
        const back = stmtSelectOneWhere("settings", tenantId, {});
        return mapRowToCamel(await oneRow(db, back.sql, back.args))!;
      },
    },

    notification: {
      findMany: async (args = {}) => {
        const stmt = stmtSelectWhere("notifications", tenantId, args.where ?? {}, {
          orderBy: resolveOrderBy("notification", args.orderBy),
          take: args.take,
          orderAllowed: NOTIFICATION_SORT,
        });
        const rows = await allRows(db, stmt.sql, stmt.args);
        return rows.map(mapRowToCamel) as Record<string, any>[];
      },
      create: async (args) => {
        const d = args.data;
        const id = (d.id as string | undefined) ?? crypto.randomUUID();
        const stmt = stmtInsertNotification(tenantId, { ...d, id });
        await run(db, stmt.sql, stmt.args);
        const back = stmtSelectOneWhere("notifications", tenantId, { id });
        return mapRowToCamel(await oneRow(db, back.sql, back.args))!;
      },
    },

    auditLog: {
      create: async (args) => {
        const d = args.data;
        const id = (d.id as string | undefined) ?? crypto.randomUUID();
        const stmt = stmtInsertAuditLog(tenantId, { ...d, id });
        await run(db, stmt.sql, stmt.args);
        const back = stmtSelectOneWhere("audit_log", tenantId, { id });
        return mapRowToCamel(await oneRow(db, back.sql, back.args))!;
      },
      findMany: async (args = {}) => {
        const stmt = stmtAuditLogFindMany(tenantId, args.where ?? {}, args.take);
        const rows = await allRows(db, stmt.sql, stmt.args);
        return rows.map(mapRowToCamel) as Record<string, any>[];
      },
    },

    syncOutbox: {
      create: async (args) => {
        const d = args.data;
        const id = (d.id as string | undefined) ?? crypto.randomUUID();
        const stmt = stmtInsertSyncOutbox(tenantId, { ...d, id });
        await run(db, stmt.sql, stmt.args);
        const back = stmtSelectOneWhere("sync_outbox", tenantId, { id });
        return mapRowToCamel(await oneRow(db, back.sql, back.args))!;
      },
      findMany: async (args = {}) => {
        const stmt = stmtSyncOutboxFindMany(tenantId, args.where ?? {}, args.take);
        const rows = await allRows(db, stmt.sql, stmt.args);
        return rows.map(mapRowToCamel) as Record<string, any>[];
      },
    },
  };
}
