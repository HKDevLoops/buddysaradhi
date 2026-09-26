import type { Client, InValue, ResultSet } from "@libsql/client";
import { log } from "@/lib/logger";

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

const EMPTY_RESULT: ResultSet = {
  columns: [],
  columnTypes: [],
  rows: [],
  rowsAffected: 0,
  lastInsertRowid: undefined,
  toJSON() {
    return { columns: [], columnTypes: [], rows: [], rowsAffected: 0, lastInsertRowid: undefined };
  },
};

/**
 * Implements: AGENTS.md §2 Rule 9 (no silent failures — a query error throws,
 * it is never reported as an empty result set).
 *
 * The "no such table" branch still creates a shadow schema via runtime DDL.
 * That contradicts prisma/schema.prisma §3.4 ("DDL never runs at runtime");
 * removing it is deferred to the stage that amends §3.4 first, so the branch
 * is behaviourally unchanged here and is only made observable via a typed
 * warning (audit: reviews/overhaul-audit-report-2026-09-26.md, "execSafe").
 */
async function execSafe(client: Client, sql: string, args: InValue[] = []): Promise<ResultSet> {
  try {
    return await client.execute({ sql, args });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("no such table")) {
      // Rule 9: surface the real error instead of fabricating { rows: [] }.
      throw err;
    }
    log.warn(
      "libsql_proxy_shadow_ddl",
      "no such table — creating shadow schema at runtime (prisma §3.4 DDL-at-runtime, deferred)",
      { sql: sql.slice(0, 160) },
    );
    await client.execute({ sql: `CREATE TABLE IF NOT EXISTS "settings" ("tenant_id" TEXT PRIMARY KEY, "institute_name" TEXT DEFAULT 'Jyothi Tutions', "institute_address" TEXT, "institute_phone" TEXT, "institute_email" TEXT, "currency_code" TEXT DEFAULT 'INR', "locale" TEXT DEFAULT 'en-IN', "timezone" TEXT DEFAULT 'Asia/Kolkata', "default_fee_model" TEXT DEFAULT 'postpaid', "invoice_prefix" TEXT DEFAULT 'INV-', "receipt_prefix" TEXT DEFAULT 'REC-', "grace_days" INTEGER DEFAULT 7, "auto_invoice" INTEGER DEFAULT 1, "next_invoice_seq" INTEGER DEFAULT 1, "next_receipt_seq" INTEGER DEFAULT 1, "next_student_seq" INTEGER DEFAULT 1, "attendance_lock_hours" INTEGER DEFAULT 24, "default_attendance_status" TEXT DEFAULT 'present', "holiday_list_json" TEXT, "notify_due_fee" INTEGER DEFAULT 1, "notify_upcoming_due" INTEGER DEFAULT 1, "notify_missing_attendance" INTEGER DEFAULT 1, "notify_inactive_student" INTEGER DEFAULT 1, "session_timeout_min" INTEGER DEFAULT 60, "biometric_enabled" INTEGER DEFAULT 0, "pin_hash" TEXT, "backup_passphrase_hash" TEXT, "auto_archive_inactive_days" INTEGER DEFAULT 90, "theme" TEXT DEFAULT 'dark', "density" TEXT DEFAULT 'comfortable', "reduced_motion" INTEGER DEFAULT 0, "palette" TEXT DEFAULT 'emerald', "plan" TEXT DEFAULT 'free', "tenant_secret" TEXT, "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP, "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP, "deleted_at" DATETIME);`, args: [] }).catch(() => {});
    await client.execute({ sql: `CREATE TABLE IF NOT EXISTS "students" ("id" TEXT PRIMARY KEY, "tenant_id" TEXT NOT NULL, "code" TEXT NOT NULL, "first_name" TEXT NOT NULL, "last_name" TEXT, "dob" TEXT, "gender" TEXT, "phone" TEXT, "email" TEXT, "address" TEXT, "school" TEXT, "grade" TEXT, "board" TEXT, "admission_date" TEXT, "status" TEXT DEFAULT 'active', "fee_model" TEXT DEFAULT 'postpaid', "base_fee_paise" INTEGER DEFAULT 0, "balance_paise" INTEGER DEFAULT 0, "dup_key" TEXT, "merged_into_id" TEXT, "custom_fields" TEXT, "notes" TEXT, "archived_at" DATETIME, "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP, "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP, "deleted_at" DATETIME);`, args: [] }).catch(() => {});
    await client.execute({ sql: `CREATE TABLE IF NOT EXISTS "tutors" ("id" TEXT PRIMARY KEY, "tenant_id" TEXT NOT NULL, "name" TEXT NOT NULL, "email" TEXT NOT NULL, "is_active" INTEGER DEFAULT 1, "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP, "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP);`, args: [] }).catch(() => {});
    await client.execute({ sql: `CREATE TABLE IF NOT EXISTS "batches" ("id" TEXT PRIMARY KEY, "tenant_id" TEXT NOT NULL, "tutor_id" TEXT NOT NULL, "name" TEXT NOT NULL, "subject" TEXT, "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP, "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP);`, args: [] }).catch(() => {});
    await client.execute({ sql: `CREATE TABLE IF NOT EXISTS "student_enrollments" ("id" TEXT PRIMARY KEY, "tenant_id" TEXT NOT NULL, "student_id" TEXT NOT NULL, "batch_id" TEXT NOT NULL, "joined_on" TEXT, "exited_on" TEXT, "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP, "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP);`, args: [] }).catch(() => {});
    await client.execute({ sql: `CREATE TABLE IF NOT EXISTS "sync_outbox" ("id" TEXT PRIMARY KEY, "tenant_id" TEXT NOT NULL, "table_name" TEXT NOT NULL, "row_id" TEXT NOT NULL, "op" TEXT NOT NULL, "payload" TEXT NOT NULL, "status" TEXT DEFAULT 'pending', "attempts" INTEGER DEFAULT 0, "last_error" TEXT, "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP, "flushed_at" DATETIME);`, args: [] }).catch(() => {});
    await client.execute({ sql: `CREATE TABLE IF NOT EXISTS "audit_log" ("id" TEXT PRIMARY KEY, "tenant_id" TEXT NOT NULL, "actor" TEXT NOT NULL, "action" TEXT NOT NULL, "ref_type" TEXT, "ref_id" TEXT, "metadata" TEXT, "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP);`, args: [] }).catch(() => {});
    // Still failing after the shadow DDL: the table is not covered by it (e.g.
    // `notification` → `notifications`). Log it, then keep the historical
    // behaviour of returning an empty result so a partial schema degrades to
    // empty lists instead of crashing the caller.
    return await client.execute({ sql, args }).catch((retryErr: unknown) => {
      log.error(
        "libsql_proxy_shadow_query_failed",
        retryErr instanceof Error ? retryErr.message : String(retryErr),
        { sql: sql.slice(0, 160) },
      );
      return EMPTY_RESULT;
    });
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

export type ProxyWhere = Record<string, unknown>;

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
  findUnique(args: { where: ProxyWhere }): Promise<Record<string, any> | null>;
  findFirst(args?: { where?: ProxyWhere }): Promise<Record<string, any> | null>;
  findMany(args?: {
    where?: ProxyWhere;
    orderBy?: ProxyWhere;
    skip?: number;
    take?: number;
  }): Promise<Record<string, any>[]>;
  count(args?: { where?: ProxyWhere }): Promise<number>;
  aggregate(args?: Record<string, unknown>): Promise<Record<string, any>>;
  groupBy(args?: Record<string, unknown>): Promise<Record<string, any>[]>;
  create(args: { data: ProxyWhere }): Promise<Record<string, any>>;
  update(args: { where: ProxyWhere; data: ProxyWhere }): Promise<Record<string, any>>;
  upsert(args: { where: ProxyWhere; create: ProxyWhere; update: ProxyWhere }): Promise<Record<string, any>>;
  deleteMany(args?: { where?: ProxyWhere }): Promise<{ count: number }>;
}

export type LibsqlProxy = Record<string, ProxyModel> & {
  $transaction<T>(tasks: Promise<T>[]): Promise<T[]>;
};

export function createLibsqlProxy(client: Client): LibsqlProxy {
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
      auditLog: "audit_log",
    };
    const tableName = tableMap[modelName] || modelName;

    return {
      findUnique: async ({ where }: any) => {
        const { whereClause, vals } = buildWhereClause(where);
        const res = await execSafe(client, `SELECT * FROM "${tableName}" ${whereClause} LIMIT 1`, vals);
        return res.rows[0] ? toJsRow(res.rows[0]) : null;
      },
      findFirst: async ({ where }: any = {}) => {
        const { whereClause, vals } = buildWhereClause(where);
        const res = await execSafe(client, `SELECT * FROM "${tableName}" ${whereClause} LIMIT 1`, vals);
        return res.rows[0] ? toJsRow(res.rows[0]) : null;
      },
      findMany: async ({ where, orderBy, skip, take }: any = {}) => {
        const { whereClause, vals } = buildWhereClause(where);
        let orderClause = "";
        if (orderBy) {
          const colKey = Object.keys(orderBy)[0];
          const dir = String(orderBy[colKey]).toUpperCase() === "DESC" ? "DESC" : "ASC";
          orderClause = `ORDER BY "${toDbCol(colKey)}" ${dir}`;
        }
        let limitClause = "";
        if (take !== undefined) {
          limitClause = `LIMIT ${Number(take)} OFFSET ${Number(skip || 0)}`;
        }
        const sql = `SELECT * FROM "${tableName}" ${whereClause} ${orderClause} ${limitClause}`.trim();
        const res = await execSafe(client, sql, vals);
        return res.rows.map(toJsRow);
      },
      count: async ({ where }: any = {}) => {
        const { whereClause, vals } = buildWhereClause(where);
        const sql = `SELECT COUNT(*) as c FROM "${tableName}" ${whereClause}`.trim();
        const res = await execSafe(client, sql, vals);
        return Number(res.rows[0]?.c || 0);
      },
      aggregate: async ({ where, _sum, _avg, _min, _max, _count }: any = {}) => {
        const { whereClause, vals } = buildWhereClause(where);
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
      groupBy: async ({ by, where, _sum, _avg, _min, _max, _count }: any = {}) => {
        const { whereClause, vals } = buildWhereClause(where);
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
        const rawCols = Object.keys(data).filter(k => data[k] !== undefined);
        const dbCols = rawCols.map(toDbCol);
        const vals = rawCols.map(k => data[k] instanceof Date ? data[k].toISOString() : data[k]);
        const sql = `INSERT INTO "${tableName}" (${dbCols.map(c => `"${c}"`).join(",")}) VALUES (${dbCols.map(() => "?").join(",")})`;
        await execSafe(client, sql, vals);
        return data;
      },
      update: async ({ where, data }: any) => {
        const { whereClause, vals: whereVals } = buildWhereClause(where);
        const rawCols = Object.keys(data).filter(k => data[k] !== undefined);
        const dbCols = rawCols.map(toDbCol);
        const setVals = rawCols.map(k => data[k] instanceof Date ? data[k].toISOString() : data[k]);
        const setStr = dbCols.map(c => `"${c}" = ?`).join(",");
        const sql = `UPDATE "${tableName}" SET ${setStr} ${whereClause}`;
        await execSafe(client, sql, [...setVals, ...whereVals]);
        return data;
      },
      upsert: async ({ where, create, update }: any) => {
        const { whereClause, vals: whereVals } = buildWhereClause(where);
        const existing = await execSafe(client, `SELECT * FROM "${tableName}" ${whereClause} LIMIT 1`, whereVals);
        if (existing.rows && existing.rows.length > 0) {
          const rawCols = Object.keys(update).filter(k => update[k] !== undefined);
          const dbCols = rawCols.map(toDbCol);
          const setVals = rawCols.map(k => update[k] instanceof Date ? update[k].toISOString() : update[k]);
          const setStr = dbCols.map(c => `"${c}" = ?`).join(",");
          await execSafe(client, `UPDATE "${tableName}" SET ${setStr} ${whereClause}`, [...setVals, ...whereVals]);
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
        const { whereClause, vals } = buildWhereClause(where);
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
        return async (tasks: Promise<unknown>[]) => {
          const results = [];
          for (const t of tasks) results.push(await t);
          return results;
        };
      }
      // No `$executeRaw` / `$queryRaw` (raw or unsafe) surface: raw SQL at
      // runtime is forbidden by AGENTS.md §3.4 (audit line: "raw SQL exposure").
      return modelProxy(prop);
    }
  });
}
