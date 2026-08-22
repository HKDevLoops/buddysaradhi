// Implements: 11_Data_Model.md §1 & AGENTS.md §3.4
// Mandatory Prisma ORM method adapter for libSQL
import { type DB, allRows, oneRow, run } from "./db.ts";

export interface PrismaOrm {
  student: {
    findMany(args?: { where?: Record<string, any>; orderBy?: Record<string, 'asc' | 'desc'>; take?: number; skip?: number }): Promise<Record<string, any>[]>;
    findFirst(args: { where: Record<string, any> }): Promise<Record<string, any> | null>;
    create(args: { data: Record<string, any> }): Promise<Record<string, any>>;
    update(args: { where: Record<string, any>; data: Record<string, any> }): Promise<Record<string, any>>;
    delete(args: { where: Record<string, any> }): Promise<void>;
    count(args?: { where?: Record<string, any> }): Promise<number>;
  };
  batch: {
    findMany(args?: { where?: Record<string, any>; orderBy?: Record<string, 'asc' | 'desc'> }): Promise<Record<string, any>[]>;
    findFirst(args: { where: Record<string, any> }): Promise<Record<string, any> | null>;
    create(args: { data: Record<string, any> }): Promise<Record<string, any>>;
    update(args: { where: Record<string, any>; data: Record<string, any> }): Promise<Record<string, any>>;
  };
  studentEnrollment: {
    findMany(args?: { where?: Record<string, any> }): Promise<Record<string, any>[]>;
    create(args: { data: Record<string, any> }): Promise<Record<string, any>>;
    deleteMany(args: { where: Record<string, any> }): Promise<number>;
  };
  attendanceSession: {
    findMany(args?: { where?: Record<string, any>; orderBy?: Record<string, 'asc' | 'desc'>; take?: number }): Promise<Record<string, any>[]>;
    findFirst(args: { where: Record<string, any> }): Promise<Record<string, any> | null>;
    create(args: { data: Record<string, any> }): Promise<Record<string, any>>;
    update(args: { where: Record<string, any>; data: Record<string, any> }): Promise<Record<string, any>>;
  };
  attendanceRecord: {
    findMany(args?: { where?: Record<string, any> }): Promise<Record<string, any>[]>;
    createMany(args: { data: Record<string, any>[] }): Promise<number>;
  };
  invoice: {
    findMany(args?: { where?: Record<string, any>; orderBy?: Record<string, 'asc' | 'desc'>; take?: number }): Promise<Record<string, any>[]>;
    findFirst(args: { where: Record<string, any> }): Promise<Record<string, any> | null>;
    create(args: { data: Record<string, any> }): Promise<Record<string, any>>;
    update(args: { where: Record<string, any>; data: Record<string, any> }): Promise<Record<string, any>>;
  };
  ledgerEntry: {
    findMany(args?: { where?: Record<string, any>; orderBy?: Record<string, 'asc' | 'desc'>; take?: number }): Promise<Record<string, any>[]>;
    create(args: { data: Record<string, any> }): Promise<Record<string, any>>;
  };
  receipt: {
    findMany(args?: { where?: Record<string, any>; orderBy?: Record<string, 'asc' | 'desc'>; take?: number }): Promise<Record<string, any>[]>;
    findFirst(args: { where: Record<string, any> }): Promise<Record<string, any> | null>;
    create(args: { data: Record<string, any> }): Promise<Record<string, any>>;
  };
  setting: {
    findFirst(args: { where: Record<string, any> }): Promise<Record<string, any> | null>;
    upsert(args: { where: Record<string, any>; create: Record<string, any>; update: Record<string, any> }): Promise<Record<string, any>>;
    update(args: { where: Record<string, any>; data: Record<string, any> }): Promise<Record<string, any>>;
  };
  notification: {
    findMany(args?: { where?: Record<string, any>; orderBy?: Record<string, 'asc' | 'desc'>; take?: number }): Promise<Record<string, any>[]>;
    create(args: { data: Record<string, any> }): Promise<Record<string, any>>;
  };
  auditLog: {
    create(args: { data: Record<string, any> }): Promise<Record<string, any>>;
    findMany(args?: { where?: Record<string, any>; take?: number }): Promise<Record<string, any>[]>;
  };
  syncOutbox: {
    create(args: { data: Record<string, any> }): Promise<Record<string, any>>;
    findMany(args?: { where?: Record<string, any>; take?: number }): Promise<Record<string, any>[]>;
  };
}

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function mapRowToCamel(row: Record<string, any> | null): Record<string, any> | null {
  if (!row) return null;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    out[snakeToCamel(k)] = v;
  }
  return out;
}

export function createPrismaOrm(db: DB, tenantId: string): PrismaOrm {
  const buildWhere = (where: Record<string, any> = {}) => {
    const clauses: string[] = ["tenant_id = ?"];
    const params: any[] = [tenantId];
    for (const [key, val] of Object.entries(where)) {
      if (key === "tenantId" || key === "tenant_id") continue;
      const col = camelToSnake(key);
      if (val === null) {
        clauses.push(`${col} IS NULL`);
      } else if (typeof val === "object" && val !== null && "not" in val) {
        if (val.not === null) {
          clauses.push(`${col} IS NOT NULL`);
        } else {
          clauses.push(`${col} != ?`);
          params.push(val.not);
        }
      } else if (typeof val === "object" && val !== null && "in" in val && Array.isArray(val.in)) {
        if (val.in.length === 0) {
          clauses.push("1=0");
        } else {
          clauses.push(`${col} IN (${val.in.map(() => "?").join(",")})`);
          params.push(...val.in);
        }
      } else {
        clauses.push(`${col} = ?`);
        params.push(val);
      }
    }
    return { clause: clauses.join(" AND "), params };
  };

  return {
    student: {
      findMany: async (args = {}) => {
        const { clause, params } = buildWhere(args.where);
        let sql = `SELECT * FROM students WHERE ${clause}`;
        if (args.orderBy) {
          const [col, dir] = Object.entries(args.orderBy)[0] || ["firstName", "asc"];
          const ALLOWED_SORT_COLUMNS = new Set(['first_name', 'last_name', 'created_at', 'updated_at', 'admission_date', 'code', 'status', 'grade', 'balance_paise']);
          const ALLOWED_DIRECTIONS = new Set(['ASC', 'DESC']);
          const snakeCol = camelToSnake(col);
          const upperDir = dir.toUpperCase();
          if (ALLOWED_SORT_COLUMNS.has(snakeCol) && ALLOWED_DIRECTIONS.has(upperDir)) {
            sql += ` ORDER BY ${snakeCol} ${upperDir}`;
          }
        }
        if (args.take) sql += ` LIMIT ${args.take}`;
        if (args.skip) sql += ` OFFSET ${args.skip}`;
        const rows = await allRows(db, sql, params);
        return rows.map(mapRowToCamel) as Record<string, any>[];
      },
      findFirst: async (args) => {
        const { clause, params } = buildWhere(args.where);
        const row = await oneRow(db, `SELECT * FROM students WHERE ${clause} LIMIT 1`, params);
        return mapRowToCamel(row);
      },
      create: async (args) => {
        const d = args.data;
        const now = new Date().toISOString();
        const studentId = d.id ?? crypto.randomUUID();
        const dupKeyVal = d.dupKey ?? d.dup_key ?? d.code ?? studentId;
        const cols = ["id", "tenant_id", "code", "first_name", "last_name", "dob", "gender", "phone", "email", "address", "school", "grade", "board", "admission_date", "status", "fee_model", "base_fee_paise", "balance_paise", "dup_key", "notes", "created_at", "updated_at"];
        const vals = [
          studentId,
          tenantId,
          d.code ?? null,
          d.firstName ?? d.first_name ?? "Unknown",
          d.lastName ?? d.last_name ?? null,
          d.dob ?? null,
          d.gender ?? null,
          d.phone ?? null,
          d.email ?? null,
          d.address ?? null,
          d.school ?? null,
          d.grade ?? null,
          d.board ?? null,
          d.admissionDate ?? d.admission_date ?? now.slice(0, 10),
          d.status ?? "active",
          d.feeModel ?? d.fee_model ?? "postpaid",
          d.baseFeePaise ?? d.base_fee_paise ?? 0,
          d.balancePaise ?? d.balance_paise ?? 0,
          dupKeyVal,
          d.notes ?? null,
          now,
          now,
        ];
        await run(db, `INSERT INTO students (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, vals);
        return mapRowToCamel(await oneRow(db, "SELECT * FROM students WHERE tenant_id = ? AND id = ?", [tenantId, studentId]))!;
      },
      update: async (args) => {
        const { clause, params } = buildWhere(args.where);
        const updates: string[] = [];
        const uParams: any[] = [];
        for (const [k, v] of Object.entries(args.data)) {
          updates.push(`${camelToSnake(k)} = ?`);
          uParams.push(v);
        }
        updates.push("updated_at = ?");
        uParams.push(new Date().toISOString());
        await run(db, `UPDATE students SET ${updates.join(",")} WHERE ${clause}`, [...uParams, ...params]);
        if (args.where.id) {
          return mapRowToCamel(await oneRow(db, "SELECT * FROM students WHERE tenant_id = ? AND id = ?", [tenantId, args.where.id]))!;
        }
        return mapRowToCamel(await oneRow(db, `SELECT * FROM students WHERE ${clause}`, params))!;
      },
      delete: async (args) => {
        const { clause, params } = buildWhere(args.where);
        await run(db, `DELETE FROM students WHERE ${clause}`, params);
      },
      count: async (args = {}) => {
        const { clause, params } = buildWhere(args.where);
        const r = await oneRow(db, `SELECT COUNT(*) AS c FROM students WHERE ${clause}`, params);
        return Number(r?.c ?? 0);
      },
    },

    batch: {
      findMany: async (args = {}) => {
        const { clause, params } = buildWhere(args.where);
        const rows = await allRows(db, `SELECT * FROM batches WHERE ${clause}`, params);
        return rows.map(mapRowToCamel) as Record<string, any>[];
      },
      findFirst: async (args) => {
        const { clause, params } = buildWhere(args.where);
        const row = await oneRow(db, `SELECT * FROM batches WHERE ${clause} LIMIT 1`, params);
        return mapRowToCamel(row);
      },
      create: async (args) => {
        const d = args.data;
        const now = new Date().toISOString();
        const id = d.id ?? crypto.randomUUID();
        await run(db, "INSERT INTO batches (id, tenant_id, name, subject, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [
          id, tenantId, d.name, d.subject ?? null, now, now
        ]);
        return mapRowToCamel(await oneRow(db, "SELECT * FROM batches WHERE tenant_id = ? AND id = ?", [tenantId, id]))!;
      },
      update: async (args) => {
        const { clause, params } = buildWhere(args.where);
        const updates: string[] = [];
        const uParams: any[] = [];
        for (const [k, v] of Object.entries(args.data)) {
          updates.push(`${camelToSnake(k)} = ?`);
          uParams.push(v);
        }
        await run(db, `UPDATE batches SET ${updates.join(",")} WHERE ${clause}`, [...uParams, ...params]);
        return mapRowToCamel(await oneRow(db, `SELECT * FROM batches WHERE ${clause}`, params))!;
      },
    },

    studentEnrollment: {
      findMany: async (args = {}) => {
        const { clause, params } = buildWhere(args.where);
        const rows = await allRows(db, `SELECT * FROM student_enrollments WHERE ${clause}`, params);
        return rows.map(mapRowToCamel) as Record<string, any>[];
      },
      create: async (args) => {
        const d = args.data;
        const now = new Date().toISOString();
        const id = d.id ?? crypto.randomUUID();
        await run(db, "INSERT INTO student_enrollments (id, tenant_id, student_id, batch_id, joined_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
          id, tenantId, d.studentId, d.batchId, d.joinedOn ?? now.slice(0, 10), now, now
        ]);
        return mapRowToCamel(await oneRow(db, "SELECT * FROM student_enrollments WHERE tenant_id = ? AND id = ?", [tenantId, id]))!;
      },
      deleteMany: async (args) => {
        const { clause, params } = buildWhere(args.where);
        const res = await run(db, `DELETE FROM student_enrollments WHERE ${clause}`, params);
        return res.rowsAffected ?? 0;
      },
    },

    attendanceSession: {
      findMany: async (args = {}) => {
        const { clause, params } = buildWhere(args.where);
        let sql = `SELECT * FROM attendance_sessions WHERE ${clause}`;
        if (args.orderBy) {
          const [col, dir] = Object.entries(args.orderBy)[0] || ["sessionDate", "desc"];
          const ALLOWED_SORT_COLUMNS = new Set(["session_date", "batch_name", "created_at"]);
          const ALLOWED_DIRECTIONS = new Set(["ASC", "DESC"]);
          const snakeCol = camelToSnake(col);
          const upperDir = dir.toUpperCase();
          if (ALLOWED_SORT_COLUMNS.has(snakeCol) && ALLOWED_DIRECTIONS.has(upperDir)) {
            sql += ` ORDER BY ${snakeCol} ${upperDir}`;
          }
        }
        if (args.take) sql += ` LIMIT ${args.take}`;
        const rows = await allRows(db, sql, params);
        return rows.map(mapRowToCamel) as Record<string, any>[];
      },
      findFirst: async (args) => {
        const { clause, params } = buildWhere(args.where);
        const row = await oneRow(db, `SELECT * FROM attendance_sessions WHERE ${clause} LIMIT 1`, params);
        return mapRowToCamel(row);
      },
      create: async (args) => {
        const d = args.data;
        const now = new Date().toISOString();
        const id = d.id ?? crypto.randomUUID();
        await run(db, "INSERT INTO attendance_sessions (id, tenant_id, batch_id, session_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [
          id, tenantId, d.batchId ?? null, d.sessionDate, now, now
        ]);
        return mapRowToCamel(await oneRow(db, "SELECT * FROM attendance_sessions WHERE tenant_id = ? AND id = ?", [tenantId, id]))!;
      },
      update: async (args) => {
        const { clause, params } = buildWhere(args.where);
        const updates: string[] = [];
        const uParams: any[] = [];
        for (const [k, v] of Object.entries(args.data)) {
          updates.push(`${camelToSnake(k)} = ?`);
          uParams.push(v);
        }
        await run(db, `UPDATE attendance_sessions SET ${updates.join(",")} WHERE ${clause}`, [...uParams, ...params]);
        return mapRowToCamel(await oneRow(db, `SELECT * FROM attendance_sessions WHERE ${clause}`, params))!;
      },
    },

    attendanceRecord: {
      findMany: async (args = {}) => {
        const { clause, params } = buildWhere(args.where);
        const rows = await allRows(db, `SELECT * FROM attendance_records WHERE ${clause}`, params);
        return rows.map(mapRowToCamel) as Record<string, any>[];
      },
      createMany: async (args) => {
        const now = new Date().toISOString();
        let count = 0;
        for (const d of args.data) {
          const id = d.id ?? crypto.randomUUID();
          await run(db, `INSERT INTO attendance_records (id, tenant_id, session_id, student_id, status, marked_at, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                         ON CONFLICT(session_id, student_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`, [
            id, tenantId, d.sessionId, d.studentId, d.status, d.markedAt ?? now, now, now
          ]);
          count++;
        }
        return count;
      },
    },

    invoice: {
      findMany: async (args = {}) => {
        const { clause, params } = buildWhere(args.where);
        let sql = `SELECT * FROM invoices WHERE ${clause}`;
        if (args.take) sql += ` LIMIT ${args.take}`;
        const rows = await allRows(db, sql, params);
        return rows.map(mapRowToCamel) as Record<string, any>[];
      },
      findFirst: async (args) => {
        const { clause, params } = buildWhere(args.where);
        const row = await oneRow(db, `SELECT * FROM invoices WHERE ${clause} LIMIT 1`, params);
        return mapRowToCamel(row);
      },
      create: async (args) => {
        const d = args.data;
        const now = new Date().toISOString();
        const id = d.id ?? crypto.randomUUID();
        await run(db, `INSERT INTO invoices (id, tenant_id, invoice_number, student_id, period_start, period_end, due_date, subtotal_paise, discount_paise, tax_paise, total_paise, paid_paise, status, notes, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
          id, tenantId, d.invoiceNumber ?? d.number, d.studentId, d.periodStart ?? now.slice(0, 10), d.periodEnd ?? now.slice(0, 10), d.dueDate ?? null, d.subtotalPaise ?? d.subtotal ?? 0, d.discountPaise ?? d.discount ?? 0, d.taxPaise ?? d.extraCharges ?? 0, d.totalPaise ?? d.total ?? 0, d.paidPaise ?? 0, d.status ?? "issued", d.notes ?? null, now, now
        ]);
        return mapRowToCamel(await oneRow(db, "SELECT * FROM invoices WHERE tenant_id = ? AND id = ?", [tenantId, id]))!;
      },
      update: async (args) => {
        const { clause, params } = buildWhere(args.where);
        const updates: string[] = [];
        const uParams: any[] = [];
        for (const [k, v] of Object.entries(args.data)) {
          updates.push(`${camelToSnake(k)} = ?`);
          uParams.push(v);
        }
        await run(db, `UPDATE invoices SET ${updates.join(",")} WHERE ${clause}`, [...uParams, ...params]);
        return mapRowToCamel(await oneRow(db, `SELECT * FROM invoices WHERE ${clause}`, params))!;
      },
    },

    ledgerEntry: {
      findMany: async (args = {}) => {
        const { clause, params } = buildWhere(args.where);
        let sql = `SELECT * FROM ledger_entries WHERE ${clause}`;
        if (args.orderBy) {
          const [col, dir] = Object.entries(args.orderBy)[0] || ["occurredOn", "desc"];
          const ALLOWED_SORT_COLUMNS = new Set(["occurred_on", "type", "created_at"]);
          const ALLOWED_DIRECTIONS = new Set(["ASC", "DESC"]);
          const snakeCol = camelToSnake(col);
          const upperDir = dir.toUpperCase();
          if (ALLOWED_SORT_COLUMNS.has(snakeCol) && ALLOWED_DIRECTIONS.has(upperDir)) {
            sql += ` ORDER BY ${snakeCol} ${upperDir}`;
          }
        }
        if (args.take) sql += ` LIMIT ${args.take}`;
        const rows = await allRows(db, sql, params);
        return rows.map(mapRowToCamel) as Record<string, any>[];
      },
      create: async (args) => {
        // Enforces Rule 1 (Append-only immutable ledger)
        const d = args.data;
        const now = new Date().toISOString();
        const id = d.id ?? crypto.randomUUID();
        await run(db, `INSERT INTO ledger_entries (id, tenant_id, student_id, batch_id, invoice_id, type, debit_paise, credit_paise, balance_after_paise, description, receipt_no, payment_method, payment_ref, this_hash, void_of_id, occurred_on, source, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
          id, tenantId, d.studentId, d.batchId ?? null, d.invoiceId ?? null, d.type, d.debitPaise ?? 0, d.creditPaise ?? 0, d.balanceAfterPaise ?? 0, d.description ?? null, d.receiptNo ?? null, d.paymentMethod ?? null, d.paymentRef ?? null, d.thisHash ?? "hash", d.voidOfId ?? null, d.occurredOn ?? now.slice(0, 10), d.source ?? "manual", now, now
        ]);
        return mapRowToCamel(await oneRow(db, "SELECT * FROM ledger_entries WHERE tenant_id = ? AND id = ?", [tenantId, id]))!;
      },
    },

    receipt: {
      findMany: async (args = {}) => {
        const { clause, params } = buildWhere(args.where);
        const rows = await allRows(db, `SELECT * FROM receipts WHERE ${clause}`, params);
        return rows.map(mapRowToCamel) as Record<string, any>[];
      },
      findFirst: async (args) => {
        const { clause, params } = buildWhere(args.where);
        const row = await oneRow(db, `SELECT * FROM receipts WHERE ${clause} LIMIT 1`, params);
        return mapRowToCamel(row);
      },
      create: async (args) => {
        const d = args.data;
        const now = new Date().toISOString();
        const id = d.id ?? crypto.randomUUID();
        await run(db, `INSERT INTO receipts (id, tenant_id, receipt_no, student_id, invoice_id, amount, payment_method, payment_ref, received_on, tamper_hash, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
          id, tenantId, d.receiptNo ?? d.number, d.studentId, d.invoiceId ?? null, d.amount, d.paymentMethod ?? "cash", d.paymentRef ?? null, d.receivedOn ?? now.slice(0, 10), d.tamperHash ?? "hash", now, now
        ]);
        return mapRowToCamel(await oneRow(db, "SELECT * FROM receipts WHERE tenant_id = ? AND id = ?", [tenantId, id]))!;
      },
    },

    setting: {
      findFirst: async (args) => {
        const { clause, params } = buildWhere(args.where);
        const row = await oneRow(db, `SELECT * FROM settings WHERE ${clause} LIMIT 1`, params);
        return mapRowToCamel(row);
      },
      upsert: async (args) => {
        const existing = await oneRow(db, "SELECT * FROM settings WHERE tenant_id = ?", [tenantId]);
        const now = new Date().toISOString();
        if (!existing) {
          const d = args.create;
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
          const vals: any[] = [
            tenantId,
            d.instituteName ?? d.institute_name ?? "My Tuition",
            d.currencyCode ?? d.currency_code ?? "INR",
            d.defaultFeeModel ?? d.default_fee_model ?? "postpaid",
            d.palette ?? "aurora-cosmic",
            d.theme ?? "system",
            d.density ?? "comfortable",
            d.tenantSecret ?? d.tenant_secret ?? crypto.randomUUID(),
            now,
            now,
          ];
          for (const [k, v] of Object.entries(d)) {
            const col = camelToSnake(k);
            if (!cols.includes(col)) {
              cols.push(col);
              vals.push(v);
            }
          }
          const placeholders = cols.map(() => "?").join(", ");
          await run(db, `INSERT INTO settings (${cols.join(", ")}) VALUES (${placeholders})`, vals);
        } else {
          const u = args.update;
          const sets: string[] = [];
          const params: any[] = [];
          for (const [k, v] of Object.entries(u)) {
            sets.push(`${camelToSnake(k)} = ?`);
            params.push(v);
          }
          sets.push("updated_at = ?");
          params.push(now);
          await run(db, `UPDATE settings SET ${sets.join(",")} WHERE tenant_id = ?`, [...params, tenantId]);
        }
        return mapRowToCamel(await oneRow(db, "SELECT * FROM settings WHERE tenant_id = ?", [tenantId]))!;
      },
      update: async (args) => {
        const u = args.data;
        const now = new Date().toISOString();
        const sets: string[] = [];
        const params: any[] = [];
        for (const [k, v] of Object.entries(u)) {
          sets.push(`${camelToSnake(k)} = ?`);
          params.push(v);
        }
        sets.push("updated_at = ?");
        params.push(now);
        await run(db, `UPDATE settings SET ${sets.join(",")} WHERE tenant_id = ?`, [...params, tenantId]);
        return mapRowToCamel(await oneRow(db, "SELECT * FROM settings WHERE tenant_id = ?", [tenantId]))!;
      },
    },

    notification: {
      findMany: async (args = {}) => {
        const { clause, params } = buildWhere(args.where);
        let sql = `SELECT * FROM notifications WHERE ${clause}`;
        if (args.orderBy) {
          const [col, dir] = Object.entries(args.orderBy)[0] || ["createdAt", "desc"];
          const ALLOWED_SORT_COLUMNS = new Set(["category", "created_at", "read"]);
          const ALLOWED_DIRECTIONS = new Set(["ASC", "DESC"]);
          const snakeCol = camelToSnake(col);
          const upperDir = dir.toUpperCase();
          if (ALLOWED_SORT_COLUMNS.has(snakeCol) && ALLOWED_DIRECTIONS.has(upperDir)) {
            sql += ` ORDER BY ${snakeCol} ${upperDir}`;
          }
        }
        if (args.take) sql += ` LIMIT ${args.take}`;
        const rows = await allRows(db, sql, params);
        return rows.map(mapRowToCamel) as Record<string, any>[];
      },
      create: async (args) => {
        const d = args.data;
        const now = new Date().toISOString();
        const id = d.id ?? crypto.randomUUID();
        await run(db, `INSERT INTO notifications (id, tenant_id, category, title, body, ref_type, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
          id, tenantId, d.category ?? "general", d.title, d.body ?? null, d.refType ?? null, d.refId ?? null, now
        ]);
        return mapRowToCamel(await oneRow(db, "SELECT * FROM notifications WHERE tenant_id = ? AND id = ?", [tenantId, id]))!;
      },
    },

    auditLog: {
      create: async (args) => {
        const d = args.data;
        const now = new Date().toISOString();
        const id = d.id ?? crypto.randomUUID();
        const meta = typeof d.metadata === "object" ? JSON.stringify(d.metadata) : d.metadata;
        await run(db, `INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
          id, tenantId, d.actor ?? tenantId, d.action, d.refType ?? null, d.refId ?? null, meta ?? null, now
        ]);
        return mapRowToCamel(await oneRow(db, "SELECT * FROM audit_log WHERE tenant_id = ? AND id = ?", [tenantId, id]))!;
      },
      findMany: async (args = {}) => {
        const { clause, params } = buildWhere(args.where);
        let sql = `SELECT * FROM audit_log WHERE ${clause} ORDER BY created_at DESC`;
        if (args.take) sql += ` LIMIT ${args.take}`;
        const rows = await allRows(db, sql, params);
        return rows.map(mapRowToCamel) as Record<string, any>[];
      },
    },

    syncOutbox: {
      create: async (args) => {
        const d = args.data;
        const now = new Date().toISOString();
        const id = d.id ?? crypto.randomUUID();
        const payload = typeof d.payload === "object" ? JSON.stringify(d.payload) : d.payload;
        await run(db, `INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
          id, tenantId, d.tableName ?? d.table_name, d.rowId ?? d.row_id, d.op, payload ?? "{}", d.status ?? "pending", now
        ]);
        return mapRowToCamel(await oneRow(db, "SELECT * FROM sync_outbox WHERE tenant_id = ? AND id = ?", [tenantId, id]))!;
      },
      findMany: async (args = {}) => {
        const { clause, params } = buildWhere(args.where);
        let sql = `SELECT * FROM sync_outbox WHERE ${clause} ORDER BY created_at ASC`;
        if (args.take) sql += ` LIMIT ${args.take}`;
        const rows = await allRows(db, sql, params);
        return rows.map(mapRowToCamel) as Record<string, any>[];
      },
    },
  };
}
