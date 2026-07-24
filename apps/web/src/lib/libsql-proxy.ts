import type { Client } from "@libsql/client";

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

async function execSafe(client: Client, sql: string, args: any[] = []): Promise<any> {
  try {
    return await client.execute({ sql, args });
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes("no such table")) {
      await client.execute({ sql: `CREATE TABLE IF NOT EXISTS "settings" ("tenant_id" TEXT PRIMARY KEY, "institute_name" TEXT DEFAULT 'Jyothi Tutions', "institute_address" TEXT, "institute_phone" TEXT, "institute_email" TEXT, "currency_code" TEXT DEFAULT 'INR', "locale" TEXT DEFAULT 'en-IN', "timezone" TEXT DEFAULT 'Asia/Kolkata', "default_fee_model" TEXT DEFAULT 'postpaid', "invoice_prefix" TEXT DEFAULT 'INV-', "receipt_prefix" TEXT DEFAULT 'REC-', "grace_days" INTEGER DEFAULT 7, "auto_invoice" INTEGER DEFAULT 1, "next_invoice_seq" INTEGER DEFAULT 1, "next_receipt_seq" INTEGER DEFAULT 1, "next_student_seq" INTEGER DEFAULT 1, "attendance_lock_hours" INTEGER DEFAULT 24, "default_attendance_status" TEXT DEFAULT 'present', "holiday_list_json" TEXT, "notify_due_fee" INTEGER DEFAULT 1, "notify_upcoming_due" INTEGER DEFAULT 1, "notify_missing_attendance" INTEGER DEFAULT 1, "notify_inactive_student" INTEGER DEFAULT 1, "session_timeout_min" INTEGER DEFAULT 60, "biometric_enabled" INTEGER DEFAULT 0, "pin_hash" TEXT, "backup_passphrase_hash" TEXT, "auto_archive_inactive_days" INTEGER DEFAULT 90, "theme" TEXT DEFAULT 'dark', "density" TEXT DEFAULT 'comfortable', "reduced_motion" INTEGER DEFAULT 0, "palette" TEXT DEFAULT 'emerald', "plan" TEXT DEFAULT 'free', "tenant_secret" TEXT, "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP, "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP, "deleted_at" DATETIME);`, args: [] }).catch(() => {});
      await client.execute({ sql: `CREATE TABLE IF NOT EXISTS "students" ("id" TEXT PRIMARY KEY, "tenant_id" TEXT NOT NULL, "code" TEXT NOT NULL, "first_name" TEXT NOT NULL, "last_name" TEXT, "dob" TEXT, "gender" TEXT, "phone" TEXT, "email" TEXT, "address" TEXT, "school" TEXT, "grade" TEXT, "board" TEXT, "admission_date" TEXT, "status" TEXT DEFAULT 'active', "fee_model" TEXT DEFAULT 'postpaid', "base_fee_paise" INTEGER DEFAULT 0, "balance_paise" INTEGER DEFAULT 0, "dup_key" TEXT, "merged_into_id" TEXT, "custom_fields" TEXT, "archived_at" DATETIME, "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP, "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP, "deleted_at" DATETIME);`, args: [] }).catch(() => {});
      await client.execute({ sql: `CREATE TABLE IF NOT EXISTS "tutors" ("id" TEXT PRIMARY KEY, "tenant_id" TEXT NOT NULL, "name" TEXT NOT NULL, "email" TEXT NOT NULL, "is_active" INTEGER DEFAULT 1, "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP, "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP);`, args: [] }).catch(() => {});
      await client.execute({ sql: `CREATE TABLE IF NOT EXISTS "batches" ("id" TEXT PRIMARY KEY, "tenant_id" TEXT NOT NULL, "tutor_id" TEXT NOT NULL, "name" TEXT NOT NULL, "subject" TEXT, "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP, "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP);`, args: [] }).catch(() => {});
      await client.execute({ sql: `CREATE TABLE IF NOT EXISTS "student_enrollments" ("id" TEXT PRIMARY KEY, "tenant_id" TEXT NOT NULL, "student_id" TEXT NOT NULL, "batch_id" TEXT NOT NULL, "joined_on" TEXT, "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP, "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP);`, args: [] }).catch(() => {});
      await client.execute({ sql: `CREATE TABLE IF NOT EXISTS "sync_outbox" ("id" TEXT PRIMARY KEY, "tenant_id" TEXT NOT NULL, "entity_type" TEXT NOT NULL, "entity_id" TEXT NOT NULL, "operation" TEXT NOT NULL, "payload_json" TEXT NOT NULL, "status" TEXT DEFAULT 'pending', "retry_count" INTEGER DEFAULT 0, "last_error" TEXT, "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP, "processed_at" DATETIME);`, args: [] }).catch(() => {});
      await client.execute({ sql: `CREATE TABLE IF NOT EXISTS "audit_logs" ("id" TEXT PRIMARY KEY, "tenant_id" TEXT NOT NULL, "actor_id" TEXT NOT NULL, "action" TEXT NOT NULL, "target_entity" TEXT, "target_id" TEXT, "payload_json" TEXT, "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP);`, args: [] }).catch(() => {});
      return await client.execute({ sql, args }).catch(() => ({ rows: [], rowsAffected: 0 }));
    }
    return { rows: [], rowsAffected: 0 };
  }
}

export function createLibsqlProxy(client: Client): any {
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
      syncOutbox: "sync_outbox",
      auditLog: "audit_logs",
    };
    const tableName = tableMap[modelName] || modelName;

    return {
      findUnique: async ({ where }: any) => {
        const rawKey = Object.keys(where)[0];
        const dbKey = toDbCol(rawKey);
        const val = where[rawKey];
        const res = await execSafe(client, `SELECT * FROM "${tableName}" WHERE "${dbKey}" = ? LIMIT 1`, [val]);
        return res.rows[0] ? toJsRow(res.rows[0]) : null;
      },
      findFirst: async ({ where }: any) => {
        if (!where) {
          const res = await execSafe(client, `SELECT * FROM "${tableName}" LIMIT 1`, []);
          return res.rows[0] ? toJsRow(res.rows[0]) : null;
        }
        const rawKeys = Object.keys(where);
        const whereClause = rawKeys.map(k => `"${toDbCol(k)}" = ?`).join(" AND ");
        const vals = rawKeys.map(k => where[k]);
        const res = await execSafe(client, `SELECT * FROM "${tableName}" WHERE ${whereClause} LIMIT 1`, vals);
        return res.rows[0] ? toJsRow(res.rows[0]) : null;
      },
      findMany: async ({ where }: any = {}) => {
        if (!where || Object.keys(where).length === 0) {
          const res = await execSafe(client, `SELECT * FROM "${tableName}"`, []);
          return res.rows.map(toJsRow);
        }
        const rawKeys = Object.keys(where).filter(k => where[k] !== undefined && k !== "archivedAt");
        const whereClause = rawKeys.map(k => `"${toDbCol(k)}" = ?`).join(" AND ");
        const vals = rawKeys.map(k => where[k]);
        const sql = rawKeys.length > 0 ? `SELECT * FROM "${tableName}" WHERE ${whereClause}` : `SELECT * FROM "${tableName}"`;
        const res = await execSafe(client, sql, vals);
        return res.rows.map(toJsRow);
      },
      count: async ({ where }: any = {}) => {
        if (!where || Object.keys(where).length === 0) {
          const res = await execSafe(client, `SELECT COUNT(*) as c FROM "${tableName}"`, []);
          return Number(res.rows[0]?.c || 0);
        }
        const rawKeys = Object.keys(where).filter(k => where[k] !== undefined);
        const whereClause = rawKeys.map(k => `"${toDbCol(k)}" = ?`).join(" AND ");
        const vals = rawKeys.map(k => where[k]);
        const sql = rawKeys.length > 0 ? `SELECT COUNT(*) as c FROM "${tableName}" WHERE ${whereClause}` : `SELECT COUNT(*) as c FROM "${tableName}"`;
        const res = await execSafe(client, sql, vals);
        return Number(res.rows[0]?.c || 0);
      },
      create: async ({ data }: any) => {
        const rawCols = Object.keys(data).filter(k => data[k] !== undefined);
        const dbCols = rawCols.map(toDbCol);
        const vals = rawCols.map(k => data[k] instanceof Date ? data[k].toISOString() : data[k]);
        const sql = `INSERT INTO "${tableName}" (${dbCols.map(c => `"${c}"`).join(",")}) VALUES (${dbCols.map(() => "?").join(",")})`;
        await execSafe(client, sql, vals);
        return data;
      },
      update: async ({ where, data }: any) => {
        const rawKey = Object.keys(where)[0];
        const dbKey = toDbCol(rawKey);
        const val = where[rawKey];
        const rawCols = Object.keys(data).filter(k => data[k] !== undefined);
        const dbCols = rawCols.map(toDbCol);
        const vals = rawCols.map(k => data[k] instanceof Date ? data[k].toISOString() : data[k]);
        const setStr = dbCols.map(c => `"${c}" = ?`).join(",");
        const sql = `UPDATE "${tableName}" SET ${setStr} WHERE "${dbKey}" = ?`;
        await execSafe(client, sql, [...vals, val]);
        return data;
      },
      upsert: async ({ where, create, update }: any) => {
        const rawKey = Object.keys(where)[0];
        const dbKey = toDbCol(rawKey);
        const val = where[rawKey];
        const existing = await execSafe(client, `SELECT * FROM "${tableName}" WHERE "${dbKey}" = ? LIMIT 1`, [val]);
        if (existing.rows && existing.rows.length > 0) {
          const rawCols = Object.keys(update).filter(k => update[k] !== undefined);
          const dbCols = rawCols.map(toDbCol);
          const vals = rawCols.map(k => update[k] instanceof Date ? update[k].toISOString() : update[k]);
          const setStr = dbCols.map(c => `"${c}" = ?`).join(",");
          await execSafe(client, `UPDATE "${tableName}" SET ${setStr} WHERE "${dbKey}" = ?`, [...vals, val]);
          return { ...toJsRow(existing.rows[0]), ...update };
        } else {
          const rawCols = Object.keys(create).filter(k => create[k] !== undefined);
          const dbCols = rawCols.map(toDbCol);
          const vals = rawCols.map(k => create[k] instanceof Date ? create[k].toISOString() : create[k]);
          await execSafe(client, `INSERT INTO "${tableName}" (${dbCols.map(c => `"${c}"`).join(",")}) VALUES (${dbCols.map(() => "?").join(",")})`, vals);
          return create;
        }
      },
      deleteMany: async ({ where }: any = {}) => {
        if (!where || Object.keys(where).length === 0) {
          const res = await execSafe(client, `DELETE FROM "${tableName}"`, []);
          return { count: Number(res.rowsAffected || 0) };
        }
        const rawKeys = Object.keys(where).filter(k => where[k] !== undefined);
        const whereClause = rawKeys.map(k => `"${toDbCol(k)}" = ?`).join(" AND ");
        const vals = rawKeys.map(k => where[k]);
        const res = await execSafe(client, `DELETE FROM "${tableName}" WHERE ${whereClause}`, vals);
        return { count: Number(res.rowsAffected || 0) };
      }
    };
  };

  return new Proxy({}, {
    get: (_, prop: string) => {
      if (prop === "$transaction") {
        return async (tasks: any[]) => {
          const results = [];
          for (const t of tasks) results.push(await t);
          return results;
        };
      }
      if (prop === "$executeRawUnsafe" || prop === "$executeRaw") {
        return async (sql: string, ...args: any[]) => {
          return await execSafe(client, sql, args);
        };
      }
      if (prop === "$queryRaw" || prop === "$queryRawUnsafe") {
        return async (sql: string, ...args: any[]) => {
          const res = await execSafe(client, sql, args);
          return res.rows.map(toJsRow);
        };
      }
      return modelProxy(prop);
    }
  });
}
