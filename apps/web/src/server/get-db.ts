"use server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getDb, getDbCredentials, getPrismaClient } from "@/lib/db";
import { log } from "@/lib/logger";
import type { Client } from "@libsql/client";
import { headers } from "next/headers";
import { createHmac } from "crypto";

const LOCAL_TENANT = "local-dev";

// Resolve the current Supabase user without throwing. In local/dev there is
// no session, so we return null and callers fall back to a local-dev identity.
async function getUser() {
  try {
    const supabase = await createSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user ?? null;
  } catch {
    return null;
  }
}

export async function getAuthenticatedDb(): Promise<{
  client: Client;
  userId: string;
  tenantId: string;
}> {
  const user = await getUser();
  if (user) {
    try {
      const { dbUrl, dbToken } = getDbCredentials(
        user.user_metadata as Record<string, unknown>
      );
      return { client: getDb(dbUrl, dbToken), userId: user.id, tenantId: user.id };
    } catch {
      // User metadata not provisioned yet — fall back to environment or local DB
    }
  }
  const url = process.env.TURSO_DATABASE_URL || "file:./dev.db";
  const token = process.env.TURSO_AUTH_TOKEN || "";
  return { client: getDb(url, token), userId: user?.id || LOCAL_TENANT, tenantId: user?.id || LOCAL_TENANT };
}

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
}async function execSafe(client: Client, sql: string, args: any[] = []): Promise<any> {
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
      return modelProxy(prop);
    }
  });
}

export async function getAuthenticatedPrisma(): Promise<{
  db: any;
  userId: string;
  tenantId: string;
}> {
  const { client, userId, tenantId } = await getAuthenticatedDb();
  return { db: createLibsqlProxy(client), userId, tenantId };
}

// Keep this alias for files that use getAuthenticatedRawClient
export { getAuthenticatedDb as getAuthenticatedRawClient };


// R-CRYPTO-2: refuse module load if the secret is missing. The previous
// `|| "buddysaradhi-dev-secret-key-128bits"` fallback was a hard-coded public
// default shipped in source: any deployment that forgot to set the env var
// silently signed + verified HMACs with a value anyone could grep. That is a
// P0 (BFF → gateway impersonation). Throw at module load so the failure is
// loud, at boot, not on the first request.
function resolveSharedSecret(): string {
  const s = process.env.GATEWAY_SHARED_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "GATEWAY_SHARED_SECRET is missing or shorter than 32 chars; refusing to start the BFF (set it in .env.local)."
    );
  }
  return s;
}
const SHARED_SECRET = resolveSharedSecret();

export async function getGatewayHeaders(): Promise<{
  tenantId: string;
  headers: {
    "X-Tutor-Id": string;
    Authorization: string;
    "X-Db-Url": string;
    "X-Db-Token": string;
    "X-Timestamp": string;
    "X-Signature": string;
    "X-Client-IP": string;
    "X-Client-UA": string;
  };
}> {
  const user = await getUser();
  const timestamp = String(Date.now());
  
  let clientIp = "127.0.0.1";
  let userAgent = "unknown";
  try {
    const h = await headers();
    clientIp = h.get("x-forwarded-for") || h.get("x-real-ip") || "127.0.0.1";
    userAgent = h.get("user-agent") || "unknown";
  } catch {
    // not in a request scope
  }

  if (user) {
    const { dbUrl, dbToken } = getDbCredentials(
      user.user_metadata as Record<string, unknown>
    );
    const dataToSign = `${user.id}:${dbUrl}:${dbToken}:${timestamp}`;
    const signature = createHmac("sha256", SHARED_SECRET).update(dataToSign).digest("hex");

    return {
      tenantId: user.id,
      headers: {
        "X-Tutor-Id": user.id,
        Authorization: `Bearer mock-token-${user.id}`,
        "X-Db-Url": dbUrl,
        "X-Db-Token": dbToken,
        "X-Timestamp": timestamp,
        "X-Signature": signature,
        "X-Client-IP": clientIp,
        "X-Client-UA": userAgent,
      },
    };
  }
  
  const dbUrl = process.env.TURSO_DATABASE_URL || "";
  const dbToken = process.env.TURSO_AUTH_TOKEN || "";
  const dataToSign = `${LOCAL_TENANT}:${dbUrl}:${dbToken}:${timestamp}`;
  const signature = createHmac("sha256", SHARED_SECRET).update(dataToSign).digest("hex");

  return {
    tenantId: LOCAL_TENANT,
    headers: {
      "X-Tutor-Id": LOCAL_TENANT,
      Authorization: `Bearer mock-token-${LOCAL_TENANT}`,
      "X-Db-Url": dbUrl,
      "X-Db-Token": dbToken,
      "X-Timestamp": timestamp,
      "X-Signature": signature,
      "X-Client-IP": clientIp,
      "X-Client-UA": userAgent,
    },
  };
}

// Build the gateway base URL. Prefer an explicit env override, else derive the
// same-origin host from the incoming request so server-side calls work on any
// port without hardcoding localhost:3000.
async function gatewayBase(): Promise<string> {
  const env = process.env.GATEWAY_URL || process.env.NEXT_PUBLIC_GATEWAY_URL;
  if (env) return env.replace(/\/$/, "");
  // In local development, default to port 3001 where apps/gateway runs.
  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:3001";
  }
  return "https://buddysaradhi.vercel.app";
}

export async function gatewayGet<T = unknown>(
  path: string,
  params?: Record<string, string>
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const { headers: h } = await getGatewayHeaders();
    const base = await gatewayBase();
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    const res = await fetch(`${base}${path}${qs}`, {
      method: "GET",
      headers: { ...h },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Gateway ${res.status}: ${await res.text()}`);
    }

    return (await res.json()) as { success: true; data: T };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown gateway error";
    log.error('gateway_get_failed', `Gateway GET ${path} failed: ${message}`, { path, method: 'GET' });
    return { success: false, error: message };
  }
}

export async function gatewayPatch<T = unknown>(
  path: string,
  body: unknown
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const { headers: h } = await getGatewayHeaders();
    const base = await gatewayBase();
    const res = await fetch(`${base}${path}`, {
      method: "PATCH",
      headers: { ...h, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Gateway ${res.status}: ${await res.text()}`);
    }

    return (await res.json()) as { success: true; data: T };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown gateway error";
    log.error('gateway_patch_failed', `Gateway PATCH ${path} failed: ${message}`, { path, method: 'PATCH' });
    return { success: false, error: message };
  }
}

export async function gatewayPost<T = unknown>(
  path: string,
  body: unknown,
  extraHeaders?: Record<string, string>
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const { headers: h } = await getGatewayHeaders();
    const base = await gatewayBase();
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { ...h, "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Gateway ${res.status}: ${await res.text()}`);
    }

    return (await res.json()) as { success: true; data: T };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown gateway error";
    log.error('gateway_post_failed', `Gateway POST ${path} failed: ${message}`, { path, method: 'POST' });
    return { success: false, error: message };
  }
}

export async function gatewayDelete<T = unknown>(
  path: string
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const { headers: h } = await getGatewayHeaders();
    const base = await gatewayBase();
    const res = await fetch(`${base}${path}`, {
      method: "DELETE",
      headers: { ...h },
    });

    if (!res.ok) {
      throw new Error(`Gateway ${res.status}: ${await res.text()}`);
    }

    return (await res.json()) as { success: true; data: T };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown gateway error";
    log.error('gateway_delete_failed', `Gateway DELETE ${path} failed: ${message}`, { path, method: 'DELETE' });
    return { success: false, error: message };
  }
}
