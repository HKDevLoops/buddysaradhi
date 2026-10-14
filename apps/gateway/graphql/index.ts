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

import { createClient as createLibsql } from "@libsql/client";
import { createClient as createSb } from "@supabase/supabase-js";
import { corsHeadersForOrigin } from "../lib/errors.ts";
import { logError } from "../lib/log.ts";

type DB = ReturnType<typeof createLibsql>;

// This function is bundled separately from the REST gateway, so it keeps its own
// client cache rather than importing lib/db.ts (which would drag the whole
// lib/sql.ts statement graph into this bundle). It had the same defect as the
// REST one — unbounded, and keyed on the FULL db_token — plus the worse detail
// that the raw credential was retained as a Map key for the isolate's lifetime.
// Now bounded, keyed on URL, with the token reduced to a change-detector.
const MAX_TURSO_CLIENTS = 64;

interface TursoEntry {
  tokenFingerprint: string;
  client: DB;
}

const tursoCache = new Map<string, TursoEntry>();

/** Change-detector for rotation only. Not a MAC, not a secret derivation. */
function tokenFingerprint(token: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16)}:${token.length}`;
}

function getTurso(dbUrl: string, dbToken: string): DB {
  const existing = tursoCache.get(dbUrl);
  if (existing && existing.tokenFingerprint === tokenFingerprint(dbToken)) {
    tursoCache.delete(dbUrl);
    tursoCache.set(dbUrl, existing);
    return existing.client;
  }
  const client = createLibsql({ url: dbUrl, authToken: dbToken });
  tursoCache.delete(dbUrl);
  tursoCache.set(dbUrl, { tokenFingerprint: tokenFingerprint(dbToken), client });
  while (tursoCache.size > MAX_TURSO_CLIENTS) {
    const coldest = tursoCache.keys().next();
    if (coldest.done) break;
    tursoCache.delete(coldest.value);
  }
  return client;
}

async function allRows(
  db: DB,
  sql: string,
  args: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  const res = await db.execute({ sql, args: args as never });
  return (res.rows as Record<string, unknown>[]) ?? [];
}
async function oneRow(
  db: DB,
  sql: string,
  args: unknown[] = [],
): Promise<Record<string, unknown> | null> {
  const rows = await allRows(db, sql, args);
  return rows[0] ?? null;
}
function clampPage(page: unknown, pageSize: unknown) {
  const p = Math.max(1, Math.trunc(Number(page) || 1));
  const ps = Math.min(200, Math.max(1, Math.trunc(Number(pageSize) || 50)));
  return { p, ps, from: (p - 1) * ps };
}

// ---- dependency-free GraphQL executor ----------------------------------------
//
// VENDORED DUPLICATE of `graphql/executor.ts`. This function is bundled on its
// own, so it keeps its own copy of the executor and the resolvers; the two have
// already drifted once (the `search` bound below, which `lib/sql.ts:1287` applies
// and this copy did not), which is exactly why the LIMITS are asserted equal to
// the canonical executor's by `__tests__/graphql-guard-limits.test.ts`.
//
// The limits themselves: 10_Security.md §7 + 17_API_Gateway_System.md §4 + AGENTS
// §2 Rule 9. This copy previously had none of them — no depth ceiling, no
// top-level field cap, no de-duplication, and a sequential `for … await` loop —
// so `{students{…}}` repeated ~30 000 times drove ~60 000 serialised SQLite round
// trips through one authenticated request, behind a rate limiter consulted once
// before any of it started. See `graphql/executor.ts` for the full rationale.

/** Must equal `MAX_SELECTION_DEPTH` in `graphql/executor.ts`. The declared
 *  schema is 3 deep from `Query`; 8 refuses nothing it can express. */
const MAX_SELECTION_DEPTH = 8;

/** Must equal `MAX_TOP_LEVEL_FIELDS` in `graphql/executor.ts`. `type Query`
 *  declares 4 fields, so 16 is four times the widest thing the schema can say. */
const MAX_TOP_LEVEL_FIELDS = 16;

/** A query refused before it reaches the database, reported in the GraphQL
 *  `errors` envelope with no `data` key. See `graphql/executor.ts` for why a
 *  limit is returned and a resolver failure is thrown. */
class GraphQLLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphQLLimitError";
  }
}

/** The search term bound `lib/sql.ts:1287` applies inside `stmtGraphqlStudents`.
 *  This copy built its LIKE terms by hand and omitted it, so the two entrypoints
 *  answered the same query differently for a term over 200 characters. */
const MAX_SEARCH_CHARS = 200;

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

/** `depth` is the depth of the fields produced here, so the first call is 1 and
 *  both caps are enforced on the way IN, not on the finished tree. `variables`
 *  is the caller's real variables — see `graphql/executor.ts` for why. */
function tokenizeSelection(
  s: string,
  variables: Record<string, unknown>,
  depth: number,
): Field[] {
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
      let parenDepth = 0;
      let j = i;
      for (; j < s.length; j++) {
        if (s[j] === "(") parenDepth++;
        else if (s[j] === ")") {
          parenDepth--;
          if (parenDepth === 0) break;
        }
      }
      args = parseArgs(s.slice(i + 1, j), variables);
      i = j + 1;
    }
    let selection: Field[] = [];
    if (s[i] === "{") {
      let braceDepth = 0;
      let j = i;
      for (; j < s.length; j++) {
        if (s[j] === "{") braceDepth++;
        else if (s[j] === "}") {
          braceDepth--;
          if (braceDepth === 0) break;
        }
      }
      // Refuse BEFORE recursing: each level re-slices the rest of the string, so
      // an unbounded body is quadratic to tokenise even before a row is read.
      if (depth + 1 > MAX_SELECTION_DEPTH) {
        throw new GraphQLLimitError(
          `QUERY_TOO_DEEP: selection nesting exceeds the depth limit of ` +
            `${MAX_SELECTION_DEPTH}. The declared schema is 3 deep from Query.`,
        );
      }
      selection = tokenizeSelection(s.slice(i + 1, j), variables, depth + 1);
      i = j + 1;
    }
    // Top level only; a nested set is bounded by the schema's own field names.
    // Enforced on the 17th field so a 30 000-field body never gets to build
    // 30 000 objects before it is refused.
    if (depth === 1 && fields.length >= MAX_TOP_LEVEL_FIELDS) {
      throw new GraphQLLimitError(
        `QUERY_TOO_COMPLEX: more than ${MAX_TOP_LEVEL_FIELDS} top-level fields. ` +
          `The declared schema has 4.`,
      );
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

/** Canonical form of one field's EFFECTIVE arguments, so two occurrences with
 *  the same arguments share one resolver call. Keys are sorted because
 *  `JSON.stringify` preserves insertion order. The value came from parsed JSON,
 *  so it is acyclic by construction. */
function canonicalArgs(value: Record<string, unknown>): string {
  return JSON.stringify(value, (_key: string, val: unknown): unknown =>
    val !== null && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(
        Object.entries(val as Record<string, unknown>).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0
        ),
      )
      : val,
  );
}

// ---- resolvers ----------------------------------------------------------------
const resolvers: Record<string, (args: any, ctx: any) => Promise<unknown>> = {
  health: () => Promise.resolve("ok"),
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
    // The same 200-character bound `lib/sql.ts:1287` applies inside
    // `stmtGraphqlStudents`. This copy built its LIKE terms by hand and omitted
    // it, so a long term was answered differently here than on the REST
    // entrypoint — one field name, two different results.
    const search = typeof args.search === "string"
      ? args.search.toLowerCase().slice(0, MAX_SEARCH_CHARS)
      : "";
    if (search.length > 0) {
      where.push("(LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ? OR code LIKE ?)");
      a.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const rows = await allRows(
      ctx.db,
      `SELECT * FROM students WHERE ${where.join(" AND ")} ORDER BY first_name, id ASC LIMIT ? OFFSET ?`,
      [...a, ps, from],
    );
    const cnt = await oneRow(
      ctx.db,
      `SELECT COUNT(*) AS c FROM students WHERE ${where.join(" AND ")}`,
      a,
    );
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
      "SELECT * FROM ledger_entries WHERE tenant_id = ? ORDER BY occurred_on DESC, id ASC LIMIT ? OFFSET ?",
      [ctx.tenantId, ps, from],
    );
    const cnt = await oneRow(
      ctx.db,
      "SELECT COUNT(*) AS c FROM ledger_entries WHERE tenant_id = ?",
      [ctx.tenantId],
    );
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
  // Both caps are enforced inside the tokenizer, so an over-budget query is
  // refused before a single statement is built.
  let top: Field[];
  try {
    top = tokenizeSelection(queryBody(query), variables, 1);
  } catch (err) {
    if (err instanceof GraphQLLimitError) return { errors: [{ message: err.message }] };
    throw err;
  }

  // De-duplication keyed on the EFFECTIVE arguments, and concurrency. Every
  // resolver below is a read, so the distinct calls are independent and the
  // libSQL client takes concurrent `execute` calls on one handle. `$var` in an
  // argument position now resolves from the caller's variables, which it did
  // not before — see `graphql/executor.ts` for the full note.
  const slots: Array<{ field: Field; promise: Promise<unknown> | null }> = [];
  const inFlight = new Map<string, Promise<unknown>>();
  for (const f of top) {
    const resolver = resolvers[f.name];
    if (!resolver) {
      slots.push({ field: f, promise: null });
      continue;
    }
    const effective: Record<string, unknown> = { ...f.args, ...variables };
    const key = `${f.name}|${canonicalArgs(effective)}`;
    let promise = inFlight.get(key);
    if (!promise) {
      promise = resolver(effective, ctx);
      inFlight.set(key, promise);
    }
    slots.push({ field: f, promise });
  }

  // Settle each individually so one rejection cannot go unhandled while its
  // siblings are still in flight.
  const settled = await Promise.all(
    slots.map(async (slot): Promise<{ ok: true; value: unknown } | { ok: false; err: unknown }> => {
      if (slot.promise === null) return { ok: true, value: null };
      try {
        return { ok: true, value: await slot.promise };
      } catch (err) {
        return { ok: false, err };
      }
    }),
  );

  // Re-throw the FIRST failure IN FIELD ORDER — what the old sequential loop
  // did — so concurrency does not change which error a failing query reports.
  const data: Record<string, unknown> = {};
  for (let i = 0; i < slots.length; i += 1) {
    const outcome = settled[i];
    const slot = slots[i];
    // SAFETY: `Promise.all` resolves to exactly one entry per input, in order.
    if (!outcome || !slot) break;
    if (!outcome.ok) throw outcome.err;
    data[slot.field.name] = project(slot.field, outcome.value);
  }
  return { data };
}

// ---- server -------------------------------------------------------------------
// CORS. This used to send `Access-Control-Allow-Origin: *` on the preflight and
// **echo the caller's own Origin back** on the response. Echoing the request
// origin IS the textbook CORS bypass: it tells the browser "this origin is
// allowed", so any page on the internet could issue a credentialed cross-origin
// request here and read the response — which for a per-tenant database means
// another tutor's roster. Both now resolve through the one allowlist seam in
// `lib/errors.ts` (`corsHeadersForOrigin`), which is an exact `Set` lookup, adds
// `Vary: Origin`, sends no ACAO at all for an unknown or absent origin, and
// never emits `*`.
Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");
  const cors = corsHeadersForOrigin(origin);
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        "Access-Control-Allow-Headers":
          "authorization, content-type, x-db-url, x-db-token, x-tutor-id",
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
      const sb = createSb(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data, error } = await sb.auth.getUser(token);
      if (!error && data.user) user = data.user;
    }
    if (!isHealthOnly && !user) {
      return new Response(JSON.stringify({ errors: [{ message: "unauthenticated" }] }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Tenant identity comes from the VERIFIED JWT only. This used to prefer a
    // caller-supplied `x-tutor-id` header and fall back to `user?.id`, so a caller
    // could name any tenant while presenting their own valid Supabase token —
// and because the resolver guards compare `args.tenantId` against `ctx.tenantId`,
    // and `variables` overwrite field args, the caller satisfied BOTH sides. The
    // REST path has always enforced `ud.user.id !== tenantId -> 401`
    // (apps/gateway/lib/auth.ts:103); this entrypoint did not. A mismatching
    // header is now rejected outright rather than honoured.
    const headerTenantId = req.headers.get("x-tutor-id") || req.headers.get("X-Tutor-Id");
    tenantId = user?.id ?? null;
    if (headerTenantId && tenantId && headerTenantId !== tenantId) {
      logError("graphql.tenant_mismatch", { headerTenantId });
      return new Response(JSON.stringify({ errors: [{ message: "unauthenticated" }] }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!tenantId && !isHealthOnly) {
      return new Response(JSON.stringify({ errors: [{ message: "unauthenticated" }] }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    // No hardcoded host fallback: this branch silently pointed every request at
    // one shared database, which is an isolation decision made by a fallback
    // rather than by an authenticated principal. Fail closed like lib/sql.ts.
    const dbUrl =
      req.headers.get("x-db-url") ||
      req.headers.get("X-Db-Url") ||
      Deno.env.get("TURSO_DATABASE_URL") ||
      "";
    const dbToken =
      req.headers.get("x-db-token") ||
      req.headers.get("X-Db-Token") ||
      Deno.env.get("TURSO_TOKEN") ||
      "";
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
        ...cors,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    // Rule 9 + 10_Security.md §8: the raw `err.message` reaches the client here,
    // and a libsql/tenant error carries SQL text, column names and file paths.
    // The detail is logged server-side; the client gets a stable code.
    logError("graphql_exec_failed", { message: err instanceof Error ? err.message : String(err) });
    return new Response(
      JSON.stringify({
        errors: [{ message: "VALIDATION: the query could not be completed" }],
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...cors },
      },
    );
  }
});
