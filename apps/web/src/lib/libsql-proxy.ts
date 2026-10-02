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
  findUnique(args: { where: ProxyWhere; select?: ProxyWhere }): Promise<Record<string, any> | null>;
  findFirst(args?: {
    where?: ProxyWhere;
    orderBy?: ProxyWhere;
    select?: ProxyWhere;
  }): Promise<Record<string, any> | null>;
  findMany(args?: {
    where?: ProxyWhere;
    orderBy?: ProxyWhere;
    skip?: number;
    take?: number;
    select?: ProxyWhere;
  }): Promise<Record<string, any>[]>;
  count(args?: { where?: ProxyWhere }): Promise<number>;
  aggregate(args?: Record<string, unknown>): Promise<Record<string, any>>;
  groupBy(args?: Record<string, unknown>): Promise<Record<string, any>[]>;
  create(args: { data: ProxyWhere }): Promise<Record<string, any>>;
  update(args: { where: ProxyWhere; data: ProxyWhere }): Promise<Record<string, any>>;
  updateMany(args: { where?: ProxyWhere; data: ProxyWhere }): Promise<{ count: number }>;
  upsert(args: { where: ProxyWhere; create: ProxyWhere; update: ProxyWhere }): Promise<Record<string, any>>;
  deleteMany(args?: { where?: ProxyWhere }): Promise<{ count: number }>;
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
  ledgerEntry: ProxyModel;
  syncOutbox: ProxyModel;
  auditLog: ProxyModel;
}

export type LibsqlProxy = ProxyModels &
  Record<string, ProxyModel> & {
    $transaction: ProxyTransaction;
  };

export function createLibsqlProxy(client: SqlHandle): LibsqlProxy {
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
      findUnique: async ({ where, select }: any) => {
        const { whereClause, vals } = buildWhereClause(where);
        const res = await execSafe(client, `SELECT * FROM "${tableName}" ${whereClause} LIMIT 1`, vals);
        return res.rows[0] ? projectRow(toJsRow(res.rows[0]), select) : null;
      },
      // `orderBy` + `select` are honoured here (they were silently ignored):
      // "the latest ledger row for this student" is read with
      // `orderBy: { createdAt: "desc" }`, and without it SQLite returns an
      // arbitrary row — which produced a wrong chain tip and a wrong running
      // balance on the ORM payment path (caught by
      // packages/core/src/feesDialectParity.test.ts).
      findFirst: async ({ where, orderBy, select }: any = {}) => {
        const { whereClause, vals } = buildWhereClause(where);
        const orderClause = buildOrderClause(orderBy);
        const res = await execSafe(
          client,
          `SELECT * FROM "${tableName}" ${whereClause} ${orderClause} LIMIT 1`.trim(),
          vals,
        );
        return res.rows[0] ? projectRow(toJsRow(res.rows[0]), select) : null;
      },
      findMany: async ({ where, orderBy, skip, take, select }: any = {}) => {
        const { whereClause, vals } = buildWhereClause(where);
        const orderClause = buildOrderClause(orderBy);
        let limitClause = "";
        if (take !== undefined) {
          limitClause = `LIMIT ${Number(take)} OFFSET ${Number(skip || 0)}`;
        }
        const sql = `SELECT * FROM "${tableName}" ${whereClause} ${orderClause} ${limitClause}`.trim();
        const res = await execSafe(client, sql, vals);
        return res.rows.map((row) => projectRow(toJsRow(row), select));
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
        const rawCols = Object.keys(data).filter((k) => {
          const v = data[k];
          if (v === undefined) return false;
          if (isAtomicNumberOp(v)) {
            throw new Error(
              `ORM_CREATE_ATOMIC_OP: \`${k}\` uses an atomic operator, which only applies to update (Prisma parity)`,
            );
          }
          return true;
        });
        const dbCols = rawCols.map(toDbCol);
        const vals = rawCols.map((k) => toSqlValue(data[k]));
        const sql = `INSERT INTO "${tableName}" (${dbCols.map((c) => `"${c}"`).join(",")}) VALUES (${dbCols.map(() => "?").join(",")})`;
        await execSafe(client, sql, vals);
        return data;
      },
      update: async ({ where, data }: any) => {
        const { whereClause, vals: whereVals } = buildWhereClause(where);
        const { setStr, setVals } = buildSetClause(data);
        const sql = `UPDATE "${tableName}" SET ${setStr} ${whereClause}`;
        await execSafe(client, sql, [...setVals, ...whereVals]);
        return data;
      },
      // `update` cannot report a row count on this surface (it returns the
      // payload). `updateMany` can — callers that must prove the row existed
      // (`STUDENT_NOT_FOUND`, F5) use it to read `{ count }` instead of
      // silently writing nothing.
      updateMany: async ({ where, data }: any) => {
        const { whereClause, vals: whereVals } = buildWhereClause(where);
        const { setStr, setVals } = buildSetClause(data);
        const res = await execSafe(
          client,
          `UPDATE "${tableName}" SET ${setStr} ${whereClause}`.trim(),
          [...setVals, ...whereVals],
        );
        return { count: Number(res.rowsAffected || 0) };
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
          const txProxy = createLibsqlProxy(txHandle);
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
