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
          orderBy: args.orderBy as Record<string, string> | undefined,
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
        const stmt = stmtSelectWhere("batches", tenantId, args.where ?? {});
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
          orderBy: args.orderBy as Record<string, string> | undefined,
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
          take: args.take,
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
          orderBy: args.orderBy as Record<string, string> | undefined,
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
        const stmt = stmtSelectWhere("receipts", tenantId, args.where ?? {});
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
          orderBy: args.orderBy as Record<string, string> | undefined,
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
