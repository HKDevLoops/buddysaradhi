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
async function execSafe(client: Client, sql: string, args: InValue[] = []): Promise<ResultSet> {
  try {
    return await client.execute({ sql, args });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const missing = /no such table:\s*(\S+)/.exec(msg);
    if (missing) {
      const table = missing[1] ?? "(unknown)";
      throw new Error(
        `Schema missing at runtime: table "${table}" does not exist — ` +
          `schema authority is the gateway self-heal (apps/gateway/lib/schema.ts) ` +
          `or \`bun run db:push\`, not apps/web runtime (AGENTS.md §3.4). ` +
          `Original error: ${msg}`,
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
      reminder: "reminders",
      notification: "notifications",
      syncOutbox: "sync_outbox",
      auditLog: "audit_log",
      backupManifest: "backup_manifest",
      appState: "app_state",
      adminUser: "admin_users",
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
