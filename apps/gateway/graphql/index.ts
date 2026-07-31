// supabase/functions/gateway-graphql/index.ts
//
// BuddySaradhi GraphQL gateway — Supabase Edge Function (Deno).
//
// Data-heavy read gateway. Authenticates the caller's Supabase JWT, scopes
// every query to tenant_id, and reads the tenant's TURSO (libSQL) DB — like the
// REST gateway. Uses a small dependency-free GraphQL executor (execLocal)
// because the external `graphql` package and graphql-yoga both crash the
// function at boot on Supabase Edge (graphql-yoga pulls @whatwg-node/node-fetch;
// graphql's module init fails when bundled).
//
// Invoked at: https://<project>.supabase.co/functions/v1/gateway-graphql

import { createClient as createLibsql } from "https://esm.sh/@libsql/client@0.14.0";
import { createClient as createSb } from "https://esm.sh/@supabase/supabase-js@2";

type DB = ReturnType<typeof createLibsql>;

const tursoCache = new Map<string, DB>();
function getTurso(dbUrl: string, dbToken: string): DB {
  const key = `${dbUrl}::${dbToken}`;
  let c = tursoCache.get(key);
  if (!c) {
    c = createLibsql({ url: dbUrl, authToken: dbToken });
    tursoCache.set(key, c);
  }
  return c;
}

async function allRows(db: DB, sql: string, args: unknown[] = []): Promise<Record<string, unknown>[]> {
  const res = await db.execute({ sql, args: args as never });
  return (res.rows as Record<string, unknown>[]) ?? [];
}
async function oneRow(db: DB, sql: string, args: unknown[] = []): Promise<Record<string, unknown> | null> {
  const rows = await allRows(db, sql, args);
  return rows[0] ?? null;
}
function clampPage(page: unknown, pageSize: unknown) {
  const p = Math.max(1, Math.trunc(Number(page) || 1));
  const ps = Math.min(200, Math.max(1, Math.trunc(Number(pageSize) || 50)));
  return { p, ps, from: (p - 1) * ps };
}

// ---- dependency-free GraphQL executor ----------------------------------------
interface Field {
  name: string;
  args: Record<string, unknown>;
  selection: Field[];
}

function parseArgs(argStr: string, variables: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let i = 0;
  while (i < argStr.length) {
    while (i < argStr.length && /[\s,]/.test(argStr[i])) i++;
    if (i >= argStr.length) break;
    let key = "";
    while (i < argStr.length && argStr[i] !== ":") {
      key += argStr[i];
      i++;
    }
    i++;
    while (i < argStr.length && /\s/.test(argStr[i])) i++;
    let val = "";
    while (i < argStr.length && argStr[i] !== "," && argStr[i] !== ")") {
      val += argStr[i];
      i++;
    }
    val = val.trim();
    if (val.startsWith("$")) out[key] = variables[val.slice(1)];
    else if (val.startsWith('"') || val.startsWith("'")) out[key] = val.slice(1, -1);
    else if (val === "true") out[key] = true;
    else if (val === "false") out[key] = false;
    else if (val !== "") out[key] = Number(val);
  }
  return out;
}

function tokenizeSelection(s: string): Field[] {
  const fields: Field[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    let name = "";
    while (i < s.length && !/[\s({]/.test(s[i])) {
      name += s[i];
      i++;
    }
    let args: Record<string, unknown> = {};
    if (s[i] === "(") {
      let depth = 0;
      let j = i;
      for (; j < s.length; j++) {
        if (s[j] === "(") depth++;
        else if (s[j] === ")") {
          depth--;
          if (depth === 0) break;
        }
      }
      args = parseArgs(s.slice(i + 1, j), {});
      i = j + 1;
    }
    let selection: Field[] = [];
    if (s[i] === "{") {
      let depth = 0;
      let j = i;
      for (; j < s.length; j++) {
        if (s[j] === "{") depth++;
        else if (s[j] === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      selection = tokenizeSelection(s.slice(i + 1, j));
      i = j + 1;
    }
    fields.push({ name, args, selection });
  }
  return fields;
}

function queryBody(query: string): string {
  const first = query.indexOf("{");
  if (first === -1) return query;
  let depth = 0;
  let end = -1;
  for (let k = first; k < query.length; k++) {
    if (query[k] === "{") depth++;
    else if (query[k] === "}") {
      depth--;
      if (depth === 0) {
        end = k;
        break;
      }
    }
  }
  return query.slice(first + 1, end);
}

function project(field: Field, value: unknown): unknown {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map((v) => project(field, v));
  if (typeof value !== "object") return value;
  if (!field.selection.length) return value;
  const out: Record<string, unknown> = {};
  for (const sub of field.selection) {
    out[sub.name] = project(sub, (value as Record<string, unknown>)[sub.name]);
  }
  return out;
}

// ---- resolvers ----------------------------------------------------------------
const resolvers: Record<string, (args: any, ctx: any) => Promise<unknown>> = {
  health: async () => "ok",
  settings: async (args: any, ctx: any) => {
    if (args.tenantId !== ctx.tenantId) throw new Error("forbidden: tenant mismatch");
    const row = await oneRow(ctx.db, "SELECT * FROM settings WHERE tenant_id = ?", [ctx.tenantId]);
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      instituteName: row.institute_name ?? "",
      instituteAddress: row.institute_address ?? null,
      institutePhone: row.institute_phone ?? null,
      instituteEmail: row.institute_email ?? null,
      currencyCode: row.currency_code ?? "INR",
      locale: row.locale ?? "en-IN",
      timezone: row.timezone ?? "Asia/Kolkata",
      defaultFeeModel: row.default_fee_model ?? "monthly",
      invoicePrefix: row.invoice_prefix ?? "INV",
      receiptPrefix: row.receipt_prefix ?? "RCPT",
      graceDays: Number(row.grace_days ?? 0),
      autoInvoice: Number(row.auto_invoice ?? 0),
      nextInvoiceSeq: Number(row.next_invoice_seq ?? 1),
      nextReceiptSeq: Number(row.next_receipt_seq ?? 1),
      nextStudentSeq: Number(row.next_student_seq ?? 1),
      attendanceLockHours: Number(row.attendance_lock_hours ?? 48),
      defaultAttendanceStatus: row.default_attendance_status ?? "present",
      holidayListJson: row.holiday_list_json ?? "[]",
      notifyDueFee: Number(row.notify_due_fee ?? 1),
      notifyUpcomingDue: Number(row.notify_upcoming_due ?? 1),
      notifyMissingAttendance: Number(row.notify_missing_attendance ?? 1),
      notifyInactiveStudent: Number(row.notify_inactive_student ?? 1),
      sessionTimeoutMin: Number(row.session_timeout_min ?? 15),
      biometricEnabled: Number(row.biometric_enabled ?? 0),
      autoArchiveInactiveDays: Number(row.auto_archive_inactive_days ?? 365),
      theme: row.theme ?? "aurora-cosmic",
      palette: row.palette ?? "aurora-cosmic",
      density: row.density ?? "comfortable",
      reducedMotion: Number(row.reduced_motion ?? 0),
    };
  },
  students: async (args: any, ctx: any) => {
    if (args.tenantId !== ctx.tenantId) throw new Error("forbidden: tenant mismatch");
    const { p, ps, from } = clampPage(args.page, args.pageSize);
    const where = ["tenant_id = ?", "archived_at IS NULL"];
    const a: unknown[] = [ctx.tenantId];
    if (args.search) {
      where.push("(LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ? OR code LIKE ?)");
      a.push(`%${args.search.toLowerCase()}%`, `%${args.search.toLowerCase()}%`, `%${args.search.toLowerCase()}%`);
    }
    const rows = await allRows(
      ctx.db,
      `SELECT * FROM students WHERE ${where.join(" AND ")} ORDER BY first_name LIMIT ? OFFSET ?`,
      [...a, ps, from],
    );
    const cnt = await oneRow(ctx.db, `SELECT COUNT(*) AS c FROM students WHERE ${where.join(" AND ")}`, a);
    return {
      items: rows.map((s) => ({
        id: s.id,
        name: `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim(),
        rollNo: s.code ?? null,
        gender: s.gender ?? null,
        phone: s.phone ?? null,
        email: s.email ?? null,
        school: s.school ?? null,
        grade: s.grade ?? null,
        board: s.board ?? null,
        admissionDate: s.admission_date ?? null,
        status: s.status ?? "active",
        feeModel: s.fee_model ?? "monthly",
        baseFeePaise: Number(s.base_fee_paise ?? 0),
        balancePaise: Number(s.balance_paise ?? 0),
        dupKey: s.dup_key ?? null,
        createdAt: s.created_at ?? null,
      })),
      total: Number(cnt?.c ?? 0),
      page: p,
      pageSize: ps,
    };
  },
  ledgerEntries: async (args: any, ctx: any) => {
    if (args.tenantId !== ctx.tenantId) throw new Error("forbidden: tenant mismatch");
    const { p, ps, from } = clampPage(args.page, args.pageSize);
    const rows = await allRows(
      ctx.db,
      "SELECT * FROM ledger_entries WHERE tenant_id = ? ORDER BY occurred_on DESC LIMIT ? OFFSET ?",
      [ctx.tenantId, ps, from],
    );
    const cnt = await oneRow(ctx.db, "SELECT COUNT(*) AS c FROM ledger_entries WHERE tenant_id = ?", [ctx.tenantId]);
    return {
      items: rows.map((e) => ({
        id: e.id,
        tenantId: e.tenant_id,
        studentId: e.student_id,
        type: e.type,
        debitPaise: Number(e.debit_paise ?? 0),
        creditPaise: Number(e.credit_paise ?? 0),
        balanceAfterPaise: Number(e.balance_after_paise ?? 0),
        description: e.description ?? null,
        receiptNo: e.receipt_no ?? null,
        paymentMethod: e.payment_method ?? null,
        occurredOn: e.occurred_on ?? null,
        createdAt: e.created_at ?? null,
      })),
      total: Number(cnt?.c ?? 0),
      page: p,
      pageSize: ps,
    };
  },
};

async function execLocal(
  query: string,
  variables: Record<string, unknown>,
  ctx: { db: DB; tenantId: string | null },
): Promise<{ data?: Record<string, unknown>; errors?: { message: string }[] }> {
  const top = tokenizeSelection(queryBody(query));
  const data: Record<string, unknown> = {};
  for (const f of top) {
    const resolver = resolvers[f.name];
    if (!resolver) {
      data[f.name] = null;
      continue;
    }
    const value = await resolver({ ...f.args, ...variables }, ctx);
    data[f.name] = project(f, value);
  }
  return { data };
}

// ---- server -------------------------------------------------------------------
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type, x-db-url, x-db-token, x-tutor-id",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      },
    });
  }
  try {
    const payload = await req.json().catch(() => ({}));
    const queryText = String(payload.query ?? "");
    const isHealthOnly = /^\s*\{?\s*health\s*\}?\s*$/s.test(queryText);
    let tenantId: string | null = null;
    let user: { id: string } | null = null;
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (token) {
      const sb = createSb(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data, error } = await sb.auth.getUser(token);
      if (!error && data.user) user = data.user;
    }
    if (!isHealthOnly && !user) {
      return new Response(JSON.stringify({ errors: [{ message: "unauthenticated" }] }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    tenantId = req.headers.get("x-tutor-id") || req.headers.get("X-Tutor-Id") || user?.id || null;
    const dbUrl = req.headers.get("x-db-url") || req.headers.get("X-Db-Url") || Deno.env.get("DATABASE_URL") || "";
    const dbToken = req.headers.get("x-db-token") || req.headers.get("X-Db-Token") || Deno.env.get("TURSO_TOKEN") || "";
    if (!dbUrl && !isHealthOnly) {
      return new Response(JSON.stringify({ errors: [{ message: "no_database" }] }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const db = dbUrl ? getTurso(dbUrl, dbToken) : (null as unknown as DB);
    const result = await execLocal(payload.query, payload.variables ?? {}, { db, tenantId });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ errors: [{ message: err instanceof Error ? err.message : "internal_error" }] }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
