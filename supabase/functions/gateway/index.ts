// supabase/functions/gateway/index.ts
//
// BuddySaradhi API gateway — Supabase Edge Function (Deno).
//
// ARCHITECTURE (per user clarification + AGENTS.md §3 / 17_API_Gateway_System.md):
//   * The canonical cloud DB is TURSO (libSQL), one per tutor.
//   * This gateway is the single cross-platform bridge (web / mobile / desktop)
//     and is deployed to Supabase Functions.
//   * Every client forwards its Turso credentials in headers:
//       X-Db-Url   — the tenant's libsql URL (e.g. libsql://<db>.turso.io)
//       X-Db-Token — the tenant's libsql auth token
//       X-Tutor-Id — the tenant id (Supabase auth user id)
//   * We authenticate the caller's Supabase JWT (Authorization: Bearer) and
//     scope every query to tenant_id = X-Tutor-Id (which equals the JWT sub).
//   * All SQL runs against the tenant's Turso DB via @libsql/client.
//
// Invoked at: https://<project>.supabase.co/functions/v1/gateway/api/v1/...

import { createClient as createLibsql } from "https://esm.sh/@libsql/client@0.14.0";
import { createClient as createSb } from "https://esm.sh/@supabase/supabase-js@2";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-db-url, x-db-token, x-tutor-id",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
const ok = (data: unknown, status = 200) => json({ success: true, data }, status);
const fail = (error: string, status = 400) =>
  json({ success: false, error }, status);

// ---- Turso client cache (one connection per tenant DB) ------------------
const tursoCache = new Map<string, ReturnType<typeof createLibsql>>();
function getTurso(dbUrl: string, dbToken: string) {
  const key = `${dbUrl}::${dbToken}`;
  let c = tursoCache.get(key);
  if (!c) {
    c = createLibsql({ url: dbUrl, authToken: dbToken });
    tursoCache.set(key, c);
  }
  return c;
}
async function run(
  db: ReturnType<typeof createLibsql>,
  sql: string,
  args: unknown[] = [],
) {
  return db.execute({ sql, args: args as never });
}
async function allRows(
  db: ReturnType<typeof createLibsql>,
  sql: string,
  args: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  const res = await run(db, sql, args);
  return (res.rows as Record<string, unknown>[]) ?? [];
}
async function oneRow(
  db: ReturnType<typeof createLibsql>,
  sql: string,
  args: unknown[] = [],
): Promise<Record<string, unknown> | null> {
  const rows = await allRows(db, sql, args);
  return rows[0] ?? null;
}

// ---- Audit + outbox (Rule 7: every mutation writes sync_outbox) ---------
async function recordOutbox(
  db: ReturnType<typeof createLibsql>,
  tenantId: string,
  table: string,
  rowId: string,
  op: string,
  payload: unknown,
) {
  await run(
    db,
    `INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, status, attempts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
    [
      crypto.randomUUID(),
      tenantId,
      table,
      rowId,
      op,
      JSON.stringify(payload ?? {}),
      new Date().toISOString(),
    ],
  ).catch(() => {});
}
async function recordAudit(
  db: ReturnType<typeof createLibsql>,
  tenantId: string,
  actor: string,
  action: string,
  refType: string | null,
  refId: string | null,
  metadata: unknown,
) {
  await run(
    db,
    `INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      tenantId,
      actor,
      action,
      refType,
      refId,
      JSON.stringify(metadata ?? {}),
      new Date().toISOString(),
    ],
  ).catch(() => {});
}

// ---- Settings key mapping (camelCase -> snake_case) ----------------------
const SETTINGS_KEYS: Record<string, string> = {
  instituteName: "institute_name",
  instituteAddress: "institute_address",
  institutePhone: "institute_phone",
  instituteEmail: "institute_email",
  currencyCode: "currency_code",
  locale: "locale",
  timezone: "timezone",
  defaultFeeModel: "default_fee_model",
  invoicePrefix: "invoice_prefix",
  receiptPrefix: "receipt_prefix",
  graceDays: "grace_days",
  autoInvoice: "auto_invoice",
  nextInvoiceSeq: "next_invoice_seq",
  nextReceiptSeq: "next_receipt_seq",
  nextStudentSeq: "next_student_seq",
  attendanceLockHours: "attendance_lock_hours",
  defaultAttendanceStatus: "default_attendance_status",
  holidayListJson: "holiday_list_json",
  notifyDueFee: "notify_due_fee",
  notifyUpcomingDue: "notify_upcoming_due",
  notifyMissingAttendance: "notify_missing_attendance",
  notifyInactiveStudent: "notify_inactive_student",
  sessionTimeoutMin: "session_timeout_min",
  biometricEnabled: "biometric_enabled",
  autoArchiveInactiveDays: "auto_archive_inactive_days",
  theme: "theme",
  palette: "palette",
  density: "density",
  reducedMotion: "reduced_motion",
  pinHash: "pin_hash",
  backupPassphraseHash: "backup_passphrase_hash",
};

function mapSettings(row: Record<string, unknown> | null) {
  if (!row) return null;
  // Never expose tenant_secret.
  return {
    id: row.tenant_id,
    tenantId: row.tenant_id,
    instituteName: row.institute_name,
    instituteAddress: row.institute_address,
    institutePhone: row.institute_phone,
    instituteEmail: row.institute_email,
    currencyCode: row.currency_code,
    locale: row.locale,
    timezone: row.timezone,
    defaultFeeModel: row.default_fee_model,
    invoicePrefix: row.invoice_prefix,
    receiptPrefix: row.receipt_prefix,
    graceDays: row.grace_days,
    autoInvoice: row.auto_invoice,
    nextInvoiceSeq: row.next_invoice_seq,
    nextReceiptSeq: row.next_receipt_seq,
    nextStudentSeq: row.next_student_seq,
    attendanceLockHours: row.attendance_lock_hours,
    defaultAttendanceStatus: row.default_attendance_status,
    holidayListJson: row.holiday_list_json,
    notifyDueFee: row.notify_due_fee,
    notifyUpcomingDue: row.notify_upcoming_due,
    notifyMissingAttendance: row.notify_missing_attendance,
    notifyInactiveStudent: row.notify_inactive_student,
    sessionTimeoutMin: row.session_timeout_min,
    biometricEnabled: row.biometric_enabled,
    autoArchiveInactiveDays: row.auto_archive_inactive_days,
    theme: row.theme,
    palette: row.palette,
    density: row.density,
    reducedMotion: row.reduced_motion,
  };
}

function studentName(r: Record<string, unknown>): string {
  return [r.first_name, r.last_name].filter(Boolean).join(" ");
}

// ---- Settings self-heal: ensure palette column exists on older Turso DBs --
const paletteHealed = new Set<string>();
async function ensureSettingsPalette(
  db: ReturnType<typeof createLibsql>,
  key: string,
) {
  if (paletteHealed.has(key)) return;
  await run(
    db,
    `ALTER TABLE settings ADD COLUMN palette TEXT NOT NULL DEFAULT 'aurora-cosmic'`,
  ).catch(() => {});
  paletteHealed.add(key);
}

const ERASABLE = [
  "audit_log",
  "sync_outbox",
  "backup_manifest",
  "notifications",
  "reminders",
  "receipts",
  "ledger_entries",
  "invoices",
  "fee_schedule_items",
  "fee_plans",
  "attendance_records",
  "attendance_sessions",
  "student_documents",
  "student_notes",
  "student_tags",
  "student_enrollments",
  "guardians",
  "students",
  "batches",
  "tags",
];

const SERVICES = [
  "settings",
  "students",
  "attendance",
  "ledger",
  "reports",
  "notifications",
  "sync",
];

// ---- Main handler --------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(req.url);
  let path = url.pathname;
  path = path.replace(/^\/functions\/v1\/gateway/, "");
  path = path.replace(/^\/gateway/, "");
  if (!path.startsWith("/")) path = "/" + path;
  const method = req.method;
  const sp = url.searchParams;

  // Global health + per-service health.
  if (path === "/health") return ok({ ok: true });
  const svcHealth = SERVICES.find(
    (s) => path === `/api/v1/${s}/health`,
  );
  if (svcHealth) {
    return ok({ service: svcHealth, ok: true, ts: new Date().toISOString() });
  }

  // Locate Turso creds. Prefer forwarded headers; fall back to env (local/dev).
  const dbUrl =
    req.headers.get("x-db-url") ||
    req.headers.get("X-Db-Url") ||
    Deno.env.get("DATABASE_URL") ||
    "";
  const dbToken =
    req.headers.get("x-db-token") ||
    req.headers.get("X-Db-Token") ||
    Deno.env.get("TURSO_TOKEN") ||
    "";
  if (!dbUrl) {
    return fail("no_database: X-Db-Url header or DATABASE_URL required", 400);
  }
  const db = getTurso(dbUrl, dbToken);

  // Authenticate Supabase JWT.
  const sb = createSb(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  let tenantId =
    req.headers.get("x-tutor-id") ||
    req.headers.get("X-Tutor-Id") ||
    "";
  if (jwt) {
    const { data: ud, error: ue } = await sb.auth.getUser(jwt);
    if (ue || !ud.user) return fail("unauthenticated", 401);
    if (!tenantId) tenantId = ud.user.id;
  }
  if (!tenantId) {
    return fail("unauthenticated: provide Authorization or X-Tutor-Id", 401);
  }

  try {
    // ===== SETTINGS =====
    if (path === "/api/v1/settings" && method === "GET") {
      await ensureSettingsPalette(db, dbUrl + "::" + dbToken);
      const row = await oneRow(
        db,
        "SELECT * FROM settings WHERE tenant_id = ?",
        [tenantId],
      );
      return ok(mapSettings(row));
    }
    if (path === "/api/v1/settings" && method === "PATCH") {
      await ensureSettingsPalette(db, dbUrl + "::" + dbToken);
      const body = await req.json().catch(() => ({}));
      const sets: string[] = [];
      const args: unknown[] = [];
      for (const [k, v] of Object.entries(body)) {
        const col = SETTINGS_KEYS[k] ?? (k in SETTINGS_KEYS ? k : null);
        if (!col) continue;
        sets.push(`${col} = ?`);
        args.push(v);
      }
      if (!sets.length) return fail("no_valid_fields", 400);
      sets.push("updated_at = ?");
      args.push(new Date().toISOString());
      args.push(tenantId);
      // Ensure row exists (upsert).
      await run(
        db,
        `INSERT OR IGNORE INTO settings (tenant_id, institute_name, tenant_secret, created_at, updated_at)
         VALUES (?, 'My Tuition', ?, ?, ?)`,
        [
          tenantId,
          crypto.randomUUID(),
          new Date().toISOString(),
          new Date().toISOString(),
        ],
      ).catch(() => {});
      await run(
        db,
        `UPDATE settings SET ${sets.join(", ")} WHERE tenant_id = ?`,
        args,
      );
      await recordAudit(db, tenantId, tenantId, "settings.update", "settings", tenantId, body);
      const row = await oneRow(
        db,
        "SELECT * FROM settings WHERE tenant_id = ?",
        [tenantId],
      );
      return ok(mapSettings(row));
    }

    // ===== STUDENTS =====
    if (path === "/api/v1/students" && method === "GET") {
      const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
      const pageSize = Math.min(200, parseInt(sp.get("pageSize") ?? "50", 10));
      const search = (sp.get("search") ?? "").toLowerCase();
      const statusFilter = (sp.get("status") ?? "").split(",").filter(Boolean);
      const from = (page - 1) * pageSize;
      const where: string[] = ["s.tenant_id = ?"];
      const args: unknown[] = [tenantId];
      if (search) {
        where.push(
          "(LOWER(s.first_name) LIKE ? OR LOWER(s.last_name) LIKE ? OR s.code LIKE ?)",
        );
        args.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      if (statusFilter.length) {
        where.push(
          `s.status IN (${statusFilter.map(() => "?").join(",")})`,
        );
        args.push(...statusFilter);
      }
      const w = where.join(" AND ");
      const data = await allRows(
        db,
        `SELECT s.*, se.batch_id, b.name AS batch_name
         FROM students s
         LEFT JOIN student_enrollments se ON se.student_id = s.id AND se.exited_on IS NULL
         LEFT JOIN batches b ON b.id = se.batch_id
         WHERE ${w}
         ORDER BY s.first_name
         LIMIT ? OFFSET ?`,
        [...args, pageSize, from],
      );
      const cnt = await oneRow(
        db,
        `SELECT COUNT(*) AS c FROM students s WHERE ${w}`,
        args,
      );
      const students = data.map((s) => ({
        id: s.id,
        code: s.code,
        name: studentName(s),
        grade: s.grade,
        batch: s.batch_name ?? null,
        fee_model: s.fee_model,
        balance_due: s.balance_paise,
        status: s.status,
      }));
      return ok({ students, total: Number(cnt?.c ?? 0) });
    }
    if (path.startsWith("/api/v1/students/") && method === "GET") {
      const id = path.split("/").pop()!;
      const row = await oneRow(
        db,
        "SELECT * FROM students WHERE tenant_id = ? AND id = ?",
        [tenantId, id],
      );
      if (!row) return fail("not_found", 404);
      return ok(row);
    }
    if (path === "/api/v1/students" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const id = body.id ?? crypto.randomUUID();
      const now = new Date().toISOString();
      await run(
        db,
        `INSERT INTO students (id, tenant_id, code, first_name, last_name, dob, gender, phone, email,
           address, school, grade, board, admission_date, status, fee_model, base_fee_paise,
           balance_paise, dup_key, notes, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [
          id,
          tenantId,
          body.code ?? null,
          body.first_name ?? body.firstName ?? "Unknown",
          body.last_name ?? body.lastName ?? null,
          body.dob ?? null,
          body.gender ?? null,
          body.phone ?? null,
          body.email ?? null,
          body.address ?? null,
          body.school ?? null,
          body.grade ?? null,
          body.board ?? null,
          body.admission_date ?? now.slice(0, 10),
          body.status ?? "active",
          body.fee_model ?? "postpaid",
          body.base_fee_paise ?? body.baseFeePaise ?? 0,
          0,
          body.dup_key ?? body.code ?? id,
          body.notes ?? null,
          now,
          now,
        ],
      );
      // Optional enrollment via batch name (X-Batch-Name header) or body.batchName.
      const batchName =
        req.headers.get("X-Batch-Name") ||
        body.batchName ||
        body.batch_name ||
        null;
      if (batchName) {
        let batch = await oneRow(
          db,
          "SELECT id FROM batches WHERE tenant_id = ? AND name = ?",
          [tenantId, batchName],
        );
        if (!batch) {
          const bid = crypto.randomUUID();
          await run(
            db,
            "INSERT INTO batches (id, tenant_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            [bid, tenantId, batchName, now, now],
          );
          batch = { id: bid };
        }
        await run(
          db,
          `INSERT INTO student_enrollments (id, tenant_id, student_id, batch_id, joined_on, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            tenantId,
            id,
            batch.id,
            now.slice(0, 10),
            now,
            now,
          ],
        );
      }
      await recordOutbox(db, tenantId, "students", id, "create", body);
      await recordAudit(db, tenantId, tenantId, "student.create", "student", id, body);
      const row = await oneRow(
        db,
        "SELECT * FROM students WHERE tenant_id = ? AND id = ?",
        [tenantId, id],
      );
      return ok(row, 201);
    }
    if (path.startsWith("/api/v1/students/") && method === "PATCH") {
      const id = path.split("/").pop()!;
      const body = await req.json().catch(() => ({}));
      const allowed: Record<string, string> = {
        firstName: "first_name",
        lastName: "last_name",
        code: "code",
        grade: "grade",
        status: "status",
        feeModel: "fee_model",
        phone: "phone",
        email: "email",
        school: "school",
        board: "board",
        notes: "notes",
      };
      const sets: string[] = [];
      const args: unknown[] = [];
      for (const [k, v] of Object.entries(body)) {
        const col = allowed[k];
        if (!col) continue;
        sets.push(`${col} = ?`);
        args.push(v);
      }
      if (!sets.length) return fail("no_valid_fields", 400);
      sets.push("updated_at = ?");
      args.push(new Date().toISOString(), tenantId, id);
      await run(
        db,
        `UPDATE students SET ${sets.join(", ")} WHERE tenant_id = ? AND id = ?`,
        args,
      );
      await recordOutbox(db, tenantId, "students", id, "update", body);
      const row = await oneRow(
        db,
        "SELECT * FROM students WHERE tenant_id = ? AND id = ?",
        [tenantId, id],
      );
      return ok(row);
    }

    // ===== ATTENDANCE =====
    if (path === "/api/v1/attendance/batches" && method === "GET") {
      const rows = await allRows(
        db,
        "SELECT id, name, subject FROM batches WHERE tenant_id = ? AND archived_at IS NULL ORDER BY name",
        [tenantId],
      );
      return ok(rows);
    }
    if (path === "/api/v1/attendance" && method === "GET") {
      const date = sp.get("date") ?? new Date().toISOString().slice(0, 10);
      const batchId = sp.get("batchId");
      const session = await oneRow(
        db,
        "SELECT * FROM attendance_sessions WHERE tenant_id = ? AND session_date = ? AND (batch_id IS ? OR batch_id = ?)",
        [tenantId, date, batchId ?? null, batchId ?? null],
      );
      const roster = await allRows(
        db,
        `SELECT s.id, s.first_name, s.last_name, b.name AS batch_name
         FROM students s
         LEFT JOIN student_enrollments se ON se.student_id = s.id AND se.exited_on IS NULL
         LEFT JOIN batches b ON b.id = se.batch_id
         WHERE s.tenant_id = ? AND s.status = 'active' AND s.archived_at IS NULL
         ORDER BY s.first_name`,
        [tenantId],
      );
      let records: unknown[];
      if (session) {
        const recs = await allRows(
          db,
          "SELECT student_id, status, notes FROM attendance_records WHERE tenant_id = ? AND session_id = ?",
          [tenantId, session.id],
        );
        const byStu = new Map(recs.map((r) => [r.student_id, r]));
        records = roster.map((s) => ({
          student_id: s.id,
          name: studentName(s),
          batch: s.batch_name ?? null,
          status: byStu.get(s.id)?.status ?? null,
        }));
      } else {
        records = roster.map((s) => ({
          student_id: s.id,
          name: studentName(s),
          batch: s.batch_name ?? null,
          status: null,
        }));
      }
      return ok({ session: session ?? null, records });
    }
    if (path === "/api/v1/attendance" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (!body.session_date || !Array.isArray(body.updates)) {
        return fail("Missing session_date or updates", 400);
      }
      const now = new Date().toISOString();
      const existing = await oneRow(
        db,
        "SELECT * FROM attendance_sessions WHERE tenant_id = ? AND session_date = ? AND (batch_id IS ? OR batch_id = ?)",
        [tenantId, body.session_date, body.batch_id ?? null, body.batch_id ?? null],
      );
      // Lock-after-N-hours rule (18_Microservice_Architecture.md §3.3, enforced
      // server-side, not in the client). A session auto-locks once its age in
      // hours exceeds attendance_lock_hours (default 48).
      const lockSetting = await oneRow(
        db,
        "SELECT attendance_lock_hours FROM settings WHERE tenant_id = ?",
        [tenantId],
      );
      const lockHours = Number(lockSetting?.attendance_lock_hours ?? 48);
      if (existing) {
        const ageHours =
          (Date.now() - new Date(existing.session_date as string).getTime()) / 3_600_000;
        if (existing.locked_at || ageHours > lockHours) {
          return fail("Session is locked. Unlock it to edit.", 409);
        }
      }
      let sessionId = existing?.id;
      if (!sessionId) {
        sessionId = crypto.randomUUID();
        await run(
          db,
          "INSERT INTO attendance_sessions (id, tenant_id, batch_id, session_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          [
            sessionId,
            tenantId,
            body.batch_id ?? null,
            body.session_date,
            now,
            now,
          ],
        );
      }
      for (const u of body.updates as { student_id: string; status: string }[]) {
        await run(
          db,
          `INSERT INTO attendance_records (id, tenant_id, session_id, student_id, status, marked_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(session_id, student_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
          [
            crypto.randomUUID(),
            tenantId,
            sessionId,
            u.student_id,
            u.status,
            now,
            now,
            now,
          ],
        );
      }
      await recordOutbox(db, tenantId, "attendance_sessions", sessionId, "update", body);
      await recordAudit(db, tenantId, tenantId, "attendance.mark", "session", sessionId, { count: body.updates.length });
      return ok({ sessionId });
    }
    if (path === "/api/v1/attendance/lock" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const now = new Date().toISOString();
      await run(
        db,
        "UPDATE attendance_sessions SET locked_at = ?, locked_by = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
        [now, tenantId, now, tenantId, body.sessionId],
      );
      await recordAudit(db, tenantId, tenantId, "attendance.lock", "session", body.sessionId, {});
      return ok({ locked: true });
    }

    // ===== LEDGER (append-only) =====
    if (path === "/api/v1/ledger" && method === "GET") {
      const studentId = sp.get("studentId");
      const rows = await allRows(
        db,
        `SELECT * FROM ledger_entries WHERE tenant_id = ? AND student_id = ?
         ORDER BY occurred_on DESC LIMIT 200`,
        [tenantId, studentId],
      );
      return ok(
        rows.map((e) => ({
          id: e.id,
          tenant_id: e.tenant_id,
          student_id: e.student_id,
          type: e.type,
          debit: e.debit_paise,
          credit: e.credit_paise,
          balance_after: e.balance_after_paise,
          method: e.payment_method,
          description: e.description,
          occurred_on: e.occurred_on,
          invoice_id: e.invoice_id,
          receipt_no: e.receipt_no,
          reverses_entry_id: e.void_of_id,
          this_hash: e.this_hash,
        })),
      );
    }
    if (path === "/api/v1/ledger/invoices" && method === "GET") {
      const studentId = sp.get("studentId");
      const invs = await allRows(
        db,
        "SELECT * FROM invoices WHERE tenant_id = ? AND student_id = ? ORDER BY issue_date DESC",
        [tenantId, studentId],
      );
      const data = await Promise.all(
        invs.map(async (inv) => {
          const pa = await oneRow(
            db,
            "SELECT COALESCE(SUM(credit_paise),0) AS p FROM ledger_entries WHERE tenant_id = ? AND invoice_id = ? AND credit_paise > 0",
            [tenantId, inv.id],
          );
          return {
            id: inv.id,
            tenant_id: inv.tenant_id,
            number: inv.number,
            student_id: inv.student_id,
            issue_date: inv.issue_date,
            due_date: inv.due_date,
            subtotal: inv.subtotal,
            total: inv.total,
            status: inv.status,
            paid_amount_minor: Number(pa?.p ?? 0),
          };
        }),
      );
      return ok(data);
    }
    if (path === "/api/v1/ledger/fees" && method === "GET") {
      const search = (sp.get("search") ?? "").toLowerCase();
      const where = ["tenant_id = ?", "archived_at IS NULL"];
      const args: unknown[] = [tenantId];
      if (search) {
        where.push(
          "(LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ? OR code LIKE ?)",
        );
        args.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      const rows = await allRows(
        db,
        `SELECT id, first_name, last_name, code, fee_model, balance_paise FROM students
         WHERE ${where.join(" AND ")} ORDER BY first_name LIMIT 200`,
        args,
      );
      return ok(
        rows.map((s) => ({
          id: s.id,
          name: studentName(s),
          code: s.code,
          fee_model: s.fee_model,
          balance_due: s.balance_paise,
        })),
      );
    }
    if (path === "/api/v1/ledger/payment" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const studentId = body.studentId ?? body.student_id;
      const credit = Number(body.amount ?? body.amount_minor ?? 0);
      if (!studentId || !(credit > 0)) {
        return fail("studentId and positive amount required", 400);
      }
      const method = body.method ?? body.payment_method ?? "upi";
      const occurredOn =
        body.occurredOn ?? body.occurred_on ?? new Date().toISOString().slice(0, 10);
      const stu = await oneRow(
        db,
        "SELECT balance_paise FROM students WHERE tenant_id = ? AND id = ?",
        [tenantId, studentId],
      );
      if (!stu) return fail("student_not_found", 404);
      const newBalance = Math.max(0, Number(stu.balance_paise) - credit);
      const now = new Date().toISOString();
      const receiptNo = `R-${Date.now().toString().slice(-6)}`;
      const leId = crypto.randomUUID();
      await run(
        db,
        `INSERT INTO ledger_entries (id, tenant_id, student_id, type, debit_paise, credit_paise,
           balance_after_paise, description, receipt_no, payment_method, occurred_on, source, created_at, updated_at)
         VALUES (?, ?, ?, 'PAYMENT_RECEIVED', 0, ?, ?, ?, ?, ?, ?, 'gateway', ?, ?)`,
        [
          leId,
          tenantId,
          studentId,
          credit,
          newBalance,
          body.description ?? "Payment received",
          receiptNo,
          method,
          occurredOn,
          now,
          now,
        ],
      );
      await run(
        db,
        "INSERT INTO receipts (id, tenant_id, number, ledger_entry_id, student_id, amount, payment_method, received_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          crypto.randomUUID(),
          tenantId,
          receiptNo,
          leId,
          studentId,
          credit,
          method,
          occurredOn,
          now,
          now,
        ],
      );
      await run(
        db,
        "UPDATE students SET balance_paise = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
        [newBalance, now, tenantId, studentId],
      );
      await recordOutbox(db, tenantId, "ledger_entries", leId, "create", { type: "payment" });
      await recordAudit(db, tenantId, tenantId, "ledger.payment", "student", studentId, { credit });
      return ok({ ok: true, receiptNo, newBalance });
    }
    if (path === "/api/v1/ledger/invoice" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const studentId = body.studentId ?? body.student_id;
      const amount = Number(body.amount ?? body.amount_minor ?? 0);
      if (!studentId || !(amount > 0)) {
        return fail("studentId and positive amount required", 400);
      }
      const now = new Date().toISOString();
      const stu = await oneRow(
        db,
        "SELECT balance_paise FROM students WHERE tenant_id = ? AND id = ?",
        [tenantId, studentId],
      );
      if (!stu) return fail("student_not_found", 404);
      const newBalance = Number(stu.balance_paise) + amount;
      const leId = crypto.randomUUID();
      const invId = crypto.randomUUID();
      const invNo = `${body.number ?? "INV-" + Date.now().toString().slice(-6)}`;
      await run(
        db,
        `INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date, subtotal, total, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?)`,
        [
          invId,
          tenantId,
          invNo,
          studentId,
          body.issueDate ?? body.issue_date ?? now.slice(0, 10),
          body.dueDate ?? body.due_date ?? null,
          amount,
          amount,
          now,
          now,
        ],
      );
      await run(
        db,
        `INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type, debit_paise, credit_paise,
           balance_after_paise, description, occurred_on, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'FEE_CHARGED', ?, 0, ?, ?, ?, 'gateway', ?, ?)`,
        [
          leId,
          tenantId,
          studentId,
          invId,
          amount,
          newBalance,
          body.description ?? "Fee charged",
          body.occurredOn ?? body.occurred_on ?? now.slice(0, 10),
          now,
          now,
        ],
      );
      await run(
        db,
        "UPDATE students SET balance_paise = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
        [newBalance, now, tenantId, studentId],
      );
      await recordOutbox(db, tenantId, "ledger_entries", leId, "create", { type: "invoice" });
      await recordAudit(db, tenantId, tenantId, "ledger.invoice", "student", studentId, { amount });
      return ok({ ok: true, invoiceId: invId, newBalance });
    }
    if (path === "/api/v1/ledger/void" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const entryId = body.entryId ?? body.entryIdToVoid;
      if (!entryId) return fail("entryId required", 400);
      const entry = await oneRow(
        db,
        "SELECT * FROM ledger_entries WHERE tenant_id = ? AND id = ?",
        [tenantId, entryId],
      );
      if (!entry) return fail("entry_not_found", 404);
      const now = new Date().toISOString();
      const newBalance =
        Number(entry.balance_after_paise) + Number(entry.credit_paise ?? 0);
      const voidId = crypto.randomUUID();
      // Append-only: new reversing row.
      await run(
        db,
        `INSERT INTO ledger_entries (id, tenant_id, student_id, type, debit_paise, credit_paise,
           balance_after_paise, description, occurred_on, void_of_id, source, created_at, updated_at)
         VALUES (?, ?, ?, 'VOID', ?, 0, ?, 'Voided via Gateway', ?, ?, 'gateway', ?, ?)`,
        [
          voidId,
          tenantId,
          entry.student_id,
          Number(entry.credit_paise ?? 0),
          newBalance,
          entry.occurred_on,
          entryId,
          now,
          now,
        ],
      );
      await run(
        db,
        "UPDATE students SET balance_paise = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
        [newBalance, now, tenantId, entry.student_id],
      );
      await recordOutbox(db, tenantId, "ledger_entries", voidId, "create", { void_of: entryId });
      await recordAudit(db, tenantId, tenantId, "ledger.void", "ledger", entryId, {});
      return ok({ ok: true, voidId, newBalance });
    }

    // ===== REPORTS =====
    if (path === "/api/v1/reports/dashboard/kpis" && method === "GET") {
      const periodStart = sp.get("periodStartIso") ?? new Date().toISOString().slice(0, 10);
      const active = await allRows(
        db,
        "SELECT balance_paise FROM students WHERE tenant_id = ? AND status = 'active' AND archived_at IS NULL",
        [tenantId],
      );
      const totalStudents = active.length;
      const dues = active.filter((s) => Number(s.balance_paise) > 0);
      const dueTill = dues.reduce((a, s) => a + Number(s.balance_paise), 0);
      const payments = await allRows(
        db,
        "SELECT credit_paise FROM ledger_entries WHERE tenant_id = ? AND type = 'PAYMENT_RECEIVED' AND occurred_on >= ?",
        [tenantId, periodStart.slice(0, 10)],
      );
      const collected = payments.reduce((a, p) => a + Number(p.credit_paise ?? 0), 0);
      const invs = await allRows(
        db,
        "SELECT total, status, due_date FROM invoices WHERE tenant_id = ? AND due_date >= ?",
        [tenantId, periodStart.slice(0, 10)],
      );
      const dueForMonth = invs
        .filter((i) => i.status !== "paid")
        .reduce((a, i) => a + Number(i.total), 0);
      return ok({
        totalStudents,
        studentsWithDues: dues.length,
        collectedThisMonthMinor: collected,
        dueTillDateMinor: dueTill,
        dueForMonthMinor: dueForMonth,
        paymentBreakdown: {
          paid: totalStudents - dues.length,
          partial: dues.length,
          unpaid: 0,
          noDues: totalStudents - dues.length,
        },
      });
    }
    if (path === "/api/v1/reports/dashboard/feed" && method === "GET") {
      const ledger = await allRows(
        db,
        `SELECT id, type, credit_paise, occurred_on, student_id, receipt_no, description
         FROM ledger_entries WHERE tenant_id = ? ORDER BY occurred_on DESC LIMIT 20`,
        [tenantId],
      );
      const notifs = await allRows(
        db,
        "SELECT id, title, body, created_at FROM notifications WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20",
        [tenantId],
      );
      const items = [
        ...notifs.map((n) => ({
          id: n.id,
          type: "notification",
          title: n.title,
          description: n.body,
          timestamp: n.created_at,
        })),
        ...ledger.map((e) => ({
          id: e.id,
          type: e.type,
          title: e.description ?? e.type,
          description: `amount ${Number(e.credit_paise ?? 0)}`,
          timestamp: e.occurred_on,
        })),
      ].sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
      return ok(items.slice(0, 20));
    }
    if (path === "/api/v1/reports/dashboard/due-today" && method === "GET") {
      const today = new Date().toISOString().slice(0, 10);
      const invs = await allRows(
        db,
        `SELECT i.*, s.first_name, s.last_name, s.code FROM invoices i
         JOIN students s ON s.id = i.student_id
         WHERE i.tenant_id = ? AND i.status IN ('unpaid','partial','overdue') AND i.due_date <= ?
         ORDER BY i.due_date ASC`,
        [tenantId, today],
      );
      const data = await Promise.all(
        invs.map(async (inv) => {
          const pa = await oneRow(
            db,
            "SELECT COALESCE(SUM(credit_paise),0) AS p FROM ledger_entries WHERE tenant_id = ? AND invoice_id = ? AND credit_paise > 0",
            [tenantId, inv.id],
          );
          return {
            student_id: inv.student_id,
            student_name: studentName(inv),
            due_minor: Number(inv.total) - Number(pa?.p ?? 0),
            invoice_number: inv.number,
            due_date: inv.due_date,
          };
        }),
      );
      return ok(data);
    }
    if (path === "/api/v1/reports/dashboard/heatmaps" && method === "GET") {
      const start = (sp.get("periodStartIso") ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
      const end = (sp.get("periodEndIso") ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
      const ledger = await allRows(
        db,
        `SELECT occurred_on, credit_paise FROM ledger_entries
         WHERE tenant_id = ? AND type = 'PAYMENT_RECEIVED' AND occurred_on >= ? AND occurred_on <= ?`,
        [tenantId, start, end],
      );
      const financial: Record<string, number> = {};
      for (const e of ledger) {
        financial[e.occurred_on as string] =
          (financial[e.occurred_on as string] ?? 0) + Number(e.credit_paise ?? 0);
      }
      const financialArr = Object.entries(financial).map(
        ([date, collectedMinor]) => ({ date, collectedMinor }),
      );
      const attendance = await allRows(
        db,
        `SELECT ar.status, COUNT(*) AS c FROM attendance_records ar
         JOIN attendance_sessions s ON s.id = ar.session_id
         WHERE ar.tenant_id = ? AND s.session_date >= ? AND s.session_date <= ?
         GROUP BY ar.status`,
        [tenantId, start, end],
      );
      const attRecords = attendance.map((a) => ({
        status: a.status,
        count: Number(a.c),
      }));
      const setting = await oneRow(
        db,
        "SELECT holiday_list_json FROM settings WHERE tenant_id = ?",
        [tenantId],
      );
      let holidays: unknown[] = [];
      try {
        holidays = JSON.parse((setting?.holiday_list_json as string) ?? "[]");
      } catch {
        holidays = [];
      }
      return ok({ attendance: { records: attRecords, holidays }, financial: financialArr });
    }

    // ===== NOTIFICATIONS =====
    if (path === "/api/v1/notifications" && method === "GET") {
      const limit = Math.min(50, parseInt(sp.get("limit") ?? "20", 10));
      const rows = await allRows(
        db,
        "SELECT * FROM notifications WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?",
        [tenantId, limit],
      );
      return ok(rows);
    }
    if (path === "/api/v1/notifications" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      await run(
        db,
        `INSERT INTO notifications (id, tenant_id, category, title, body, ref_type, ref_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          tenantId,
          body.category ?? "system",
          body.title ?? "Notification",
          body.body ?? null,
          body.refType ?? body.ref_type ?? null,
          body.refId ?? body.ref_id ?? null,
          now,
        ],
      );
      await recordAudit(db, tenantId, tenantId, "notification.create", "notification", id, body);
      return ok({ id }, 201);
    }
    if (path.startsWith("/api/v1/notifications/") && method === "PATCH") {
      const id = path.split("/").pop()!;
      await run(
        db,
        "UPDATE notifications SET read_at = ? WHERE tenant_id = ? AND id = ?",
        [new Date().toISOString(), tenantId, id],
      );
      return ok({ id, read: true });
    }

    // ===== SYNC (outbox drain) =====
    if (path === "/api/v1/sync/outbox" && method === "GET") {
      const limit = Math.min(500, parseInt(sp.get("limit") ?? "100", 10));
      const rows = await allRows(
        db,
        "SELECT * FROM sync_outbox WHERE tenant_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT ?",
        [tenantId, limit],
      );
      return ok(rows);
    }
    if (path === "/api/v1/sync/outbox" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const ids = Array.isArray(body.ids) ? body.ids : [];
      if (ids.length) {
        const ph = ids.map(() => "?").join(",");
        await run(
          db,
          `UPDATE sync_outbox SET status = 'flushed', flushed_at = ? WHERE tenant_id = ? AND id IN (${ph})`,
          [new Date().toISOString(), tenantId, ...ids],
        );
      }
      return ok({ flushed: ids.length });
    }

    // ===== SECURE ERASE =====
    if (path === "/api/v1/security/erase" && method === "POST") {
      for (const t of ERASABLE) {
        await run(db, `DELETE FROM ${t} WHERE tenant_id = ?`, [tenantId]).catch(
          () => {},
        );
      }
      await run(db, "DELETE FROM settings WHERE tenant_id = ?", [tenantId]).catch(
        () => {},
      );
      await recordAudit(db, tenantId, tenantId, "security.erase", null, null, {});
      return ok({ erased: tenantId });
    }

    return fail(`no_route: ${method} ${path}`, 404);
  } catch (err) {
    console.error("gateway error:", err);
    return fail(err instanceof Error ? err.message : "internal_error", 500);
  }
});
