# 04 — API Routes

> Every `/api/*` route contract on the Buddysaradhi web surface. Method, path, Zod request schema, response shape, error codes, BR-/EC- IDs implemented. The hardened `/api/spec` route (already shipped) is the template; every new route inherits its discipline.

---

## 1. The Route Discipline

Top-level `AGENTS.md` §6.4 sets the rules. This file is the contract for every route under `src/app/api/`. The rules:

1. **Zod before DB.** Every route handler parses its input with a Zod schema before touching the database. On parse failure → 400 with `{ error: { code: "VALIDATION", issues } }`.
2. **Typed `Result<T, E>` response.** Routes never throw and return a JSON `{ ok: true, value: T } | { ok: false, error: E }`. The error type carries a stable `code` string the client switches on.
3. **Service-role isolation.** `process.env.SUPABASE_SERVICE_ROLE_KEY` and `process.env.TURSO_API_TOKEN` are **never** imported into route handlers (they live only in the Edge Function env). Routes read the user's session via `@supabase/ssr` `cookies()` and use the per-user Turso scoped JWT.
4. **Rate limiting.** In-memory token bucket per IP (60/min reads, 10/min writes). 429 with `Retry-After` header on exceed.
5. **No `z-ai-web-dev-sdk` in client bundles.** The SDK is server-only; if a route needs it, the route imports it.

### 1.1 The Hardened `/api/spec` Pattern (Template)

The existing `src/app/api/spec/route.ts` is the template for every file-serving route. The pattern:

```ts
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

const SPEC_DIR = "/home/z/my-project/Buddysaradhi_Planning";
const ALLOWED = new Set([
  "00_Vision.md",
  "01_Product_Principles.md",
  /* ... 17 files total ... */
]);

export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get("file");
  if (!file || !ALLOWED.has(file)) {
    return NextResponse.json({ error: "Unknown or missing spec file." }, { status: 404 });
  }
  const safe = path.basename(file); // defeats traversal
  const full = path.join(SPEC_DIR, safe);
  try {
    const content = await readFile(full, "utf8");
    return NextResponse.json(
      { file: safe, content, bytes: content.length },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Spec file could not be read." }, { status: 500 });
  }
}
```

The two safety invariants:

1. **`Set<string>` allowlist** — anything not in the set is 404. No globbing, no inference.
2. **`path.basename()`** — even if an attacker smuggles `../../etc/passwd` past the allowlist (they cannot, but defence-in-depth), `basename` strips the path prefix.

Every new file-serving route (e.g. `/api/changelog?version=...`) follows this exact pattern.

---

## 2. Rate Limiting — Token Bucket per IP

`src/server/rate-limit.ts` implements an in-memory token bucket. The bucket is per-IP and per-route-class (`read` vs `write`). On Vercel serverless, the bucket is per-instance (and instances are short-lived), so the limit is approximate — it stops casual abuse, not DDoS. For DDoS, Vercel's Edge firewall handles it.

```ts
// src/server/rate-limit.ts
type Bucket = { tokens: number; lastRefill: number };
const buckets = new Map<string, Bucket>();

const REFILL_READ = 60 / 60;   // 60 tokens / 60s = 1/sec
const REFILL_WRITE = 10 / 60;  // 10 tokens / 60s = 1/6sec
const CAP_READ = 60;
const CAP_WRITE = 10;

export function rateLimit(ip: string, kind: "read" | "write"): { ok: boolean; retryAfter: number } {
  const key = `${ip}:${kind}`;
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: kind === "read" ? CAP_READ : CAP_WRITE, lastRefill: now };
  const refillRate = kind === "read" ? REFILL_READ : REFILL_WRITE;
  const cap = kind === "read" ? CAP_READ : CAP_WRITE;
  b.tokens = Math.min(cap, b.tokens + ((now - b.lastRefill) / 1000) * refillRate);
  b.lastRefill = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    const retryAfter = Math.ceil((1 - b.tokens) / refillRate);
    return { ok: false, retryAfter };
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return { ok: true, retryAfter: 0 };
}
```

A 429 response includes `Retry-After: <seconds>` and `{ error: { code: "RATE_LIMITED", retryAfter } }`.

---

## 3. Route Contracts — Provisioning

### 3.1 `POST /api/provision`

Provisions a new Turso DB for the authenticated user. Called from `/signup/provision` if the Edge Function webhook hasn't completed yet (idempotent — if `db_url` is already set, returns 200 without re-provisioning).

| Field | Value |
|---|---|
| Method | `POST` |
| Path | `/api/provision` |
| Auth | Supabase session cookie (must be authenticated; `db_url` may or may not be present). |
| Rate limit | `write` (10/min per IP) |
| Implements | `03_Auth_and_Provisioning.md` §3, top-level `10_Security.md` §2.1 |

**Request body (Zod):**
```ts
const ProvisionRequestSchema = z.object({
  force: z.boolean().default(false), // if true, re-provision even if db_url is set
});
```

**Response 200:**
```json
{ "ok": true, "value": { "db_url": "libsql://db-...", "provisioned_at": "2025-..." } }
```

**Response 409 (already provisioned, `force=false`):**
```json
{ "ok": false, "error": { "code": "ALREADY_PROVISIONED", "db_url": "libsql://db-..." } }
```

**Response 500 (Turso Platform API failure):**
```json
{ "ok": false, "error": { "code": "TURSO_API_FAILED", "detail": "..." } }
```

**Side effects.** Calls Turso Platform API to create `db-{user.uuid}`. Writes `db_url` + `db_token` + `provisioned_at` into `auth.users.user_metadata` via Supabase Admin (server-side, service-role key). Then calls `bootstrapSchema()` to apply migrations `0001`..`0010`.

---

## 4. Route Contracts — Students

### 4.1 `GET /api/students`

List students, cursor-paginated.

| Field | Value |
|---|---|
| Method | `GET` |
| Path | `/api/students` |
| Auth | Supabase session + provisioned |
| Rate limit | `read` (60/min per IP) |
| Implements | `05_Students.md` §3, BR-STU-01 |

**Query params (Zod parse):**
```ts
const ListStudentsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),  // student.id of last row in prev page
  limit: z.coerce.number().int().min(1).max(100).default(30),
  filter: z.enum(["all", "active", "archived", "in-arrears"]).default("all"),
  search: z.string().max(60).optional(),
});
```

**Response 200:**
```json
{
  "ok": true,
  "value": {
    "items": [ /* StudentDTO[] */ ],
    "nextCursor": "stu-..." | null,
    "hasMore": true
  }
}
```

**`StudentDTO` shape:**
```ts
type StudentDTO = {
  id: string;
  firstName: string;
  lastName: string;
  code: string;            // e.g. "AS-001"
  phone: string | null;
  grade: string;
  batchIds: string[];
  balancePaise: number;    // derived from ledger
  status: "active" | "archived";
  updatedAt: string;       // ISO
};
```

**Error codes:** `401 UNAUTHENTICATED`, `403 UNPROVISIONED`, `429 RATE_LIMITED`, `500 INTERNAL`.

### 4.2 `POST /api/students`

Create a new student.

| Field | Value |
|---|---|
| Method | `POST` |
| Path | `/api/students` |
| Auth | Supabase session + provisioned |
| Rate limit | `write` (10/min per IP) |
| Implements | `05_Students.md` §4, BR-STU-01..05, BR-RC-02 (student code sequence) |

**Request body:** `StudentInputSchema` (see `02_State_and_Data_Flow.md` §6).

**Response 201:**
```json
{ "ok": true, "value": { "id": "stu-...", "code": "AS-001", "createdAt": "..." } }
```

**Response 422 (validation):**
```json
{ "ok": false, "error": { "code": "VALIDATION", "issues": [/* ZodIssue[] */] } }
```

**Response 409 (duplicate code):**
```json
{ "ok": false, "error": { "code": "DUPLICATE_STUDENT_CODE", "code": "AS-001" } }
```

**Side effects.** INSERT into `students` + INSERT into `student_enrollments` (per `batchIds`) + INSERT into `sync_outbox` (op=`INSERT`, entity=`students`, id) + INSERT into `audit_log` (action=`student_created`) — all in a single libSQL `batch()` transaction.

### 4.3 `PATCH /api/students/:id`

Update an existing student.

| Field | Value |
|---|---|
| Method | `PATCH` |
| Path | `/api/students/[id]` |
| Auth | Supabase session + provisioned |
| Rate limit | `write` (10/min per IP) |
| Implements | `05_Students.md` §5, BR-STU-06, BR-STU-02 (duplicate-key merge) |

**Request body (Zod):**
```ts
const StudentUpdateSchema = z.object({
  firstName: z.string().min(1).max(60).optional(),
  lastName: z.string().min(0).max(60).optional(),
  phone: z.string().regex(/^\+91\d{10}$/).optional().nullable(),
  email: z.string().email().optional().nullable(),
  grade: z.string().min(1).max(20).optional(),
  batchIds: z.array(z.string().uuid()).max(5).optional(),
  feePlanId: z.string().uuid().optional().nullable(),
  status: z.enum(["active", "archived"]).optional(),
});
```

**Response 200:**
```json
{ "ok": true, "value": { "id": "stu-...", "updatedAt": "..." } }
```

**Response 404:** `{ "ok": false, "error": { "code": "STUDENT_NOT_FOUND" } }`

**Response 409 (duplicate code detected, offers merge):**
```json
{ "ok": false, "error": { "code": "DUPLICATE_KEY_SUSPECTED", "duplicateOf": "stu-...", "mergeUrl": "/api/students/merge" } }
```

**Side effects.** UPDATE `students` (sets `updated_at = now()`; LWW via top-level `12_Business_Rules.md` BR-SYN-01) + INSERT `sync_outbox` (op=`UPDATE`) + INSERT `audit_log` (action=`student_updated`).

---

## 5. Route Contracts — Ledger

The ledger is **append-only** (top-level `AGENTS.md` Rule 1, `12_Business_Rules.md` BR-LED-06). These routes INSERT only; there is no `PATCH /api/ledger/:id` and no `DELETE /api/ledger/:id`.

### 5.1 `GET /api/ledger`

List ledger entries for a student (or all students, paginated).

| Field | Value |
|---|---|
| Method | `GET` |
| Path | `/api/ledger` |
| Auth | Supabase session + provisioned |
| Rate limit | `read` (60/min per IP) |
| Implements | `07_Fees_and_Payments.md` §4, BR-LED-01..04 |

**Query params:**
```ts
const ListLedgerQuerySchema = z.object({
  studentId: z.string().uuid().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  type: z.enum([
    "FEE_CHARGED", "PAYMENT_RECEIVED", "DISCOUNT_GRANTED",
    "REFUND_ISSUED", "ADJUSTMENT", "VOID", "ADVANCE_APPLIED"
  ]).optional(),
});
```

**Response 200:**
```json
{
  "ok": true,
  "value": {
    "items": [ /* LedgerEntryDTO[] (immutable) */ ],
    "nextCursor": "..." | null,
    "hasMore": true
  }
}
```

**`LedgerEntryDTO`:**
```ts
type LedgerEntryDTO = {
  id: string;
  studentId: string;
  type: "FEE_CHARGED" | "PAYMENT_RECEIVED" | "DISCOUNT_GRANTED" | "REFUND_ISSUED" | "ADJUSTMENT" | "VOID" | "ADVANCE_APPLIED";
  direction: "charge" | "credit";
  amountPaise: number;
  occurredOn: string;        // ISO date
  description: string | null;
  receiptId: string | null;
  invoiceId: string | null;
  reversesEntryId: string | null;
  tamperHash: string;
  createdAt: string;
};
```

The `tamperHash` is verified on read by `verifyLedgerChain()` (top-level `02_Core_Logic.md` §13.4). A broken hash returns the row with `tamperHash: "INVALID"` and writes `audit_log` `ledger_tamper_detected`.

### 5.2 `POST /api/ledger/record-payment`

Append a `PAYMENT_RECEIVED` entry (and its paired receipt). This is the canonical "record a fee payment" call.

| Field | Value |
|---|---|
| Method | `POST` |
| Path | `/api/ledger/record-payment` |
| Auth | Supabase session + provisioned + PIN (BR-SEC-02) |
| Rate limit | `write` (10/min per IP) |
| Implements | `07_Fees_and_Payments.md` §9 Flow 1, BR-LED-06, BR-FEE-01, BR-FEE-03, BR-FEE-04, BR-RC-01 |

**Request body (Zod):**
```ts
const RecordPaymentSchema = z.object({
  studentId: z.string().uuid(),
  amountPaise: z.number().int().nonnegative(),     // integer paise (BR-M-01)
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // ISO date
  method: z.enum(["cash", "upi", "cheque", "bank_transfer"]),
  paymentRef: z.string().max(60).optional(),        // required for "cheque" (EC-F-04)
  description: z.string().max(200).optional(),
  invoiceId: z.string().uuid().optional(),
  pin: z.string().regex(/^\d{6}$/),                 // BR-SEC-02 sensitive-action PIN
});
```

**Response 200:**
```json
{
  "ok": true,
  "value": {
    "ledgerEntryId": "led-...",
    "receiptId": "rct-...",
    "receiptNumber": "RCT-2025-000042",
    "studentBalancePaise": 0,
    "tamperHash": "271c96bb..."
  }
}
```

**Response 422 (validation):** `{ "ok": false, "error": { "code": "VALIDATION", "issues": [...] } }`

**Response 403 (PIN invalid):** `{ "ok": false, "error": { "code": "PIN_INVALID", "attemptsRemaining": 4 } }`

**Response 409 (over-payment without `[ADVANCE]` tag — BR-FEE-04):** the engine **splits** the payment into two entries automatically and returns:
```json
{
  "ok": true,
  "value": {
    "ledgerEntryId": "led-...", "advanceEntryId": "led-...",
    "splitApplied": true,
    "receiptId": "rct-...",
    "receiptNumber": "RCT-2025-000042",
    "studentBalancePaise": -50000,
    "advanceBalancePaise": 50000
  }
}
```

**Side effects (atomic, single libSQL `batch()`):**
1. `UPDATE receipt_sequences SET next_seq = next_seq + 1 WHERE tenant_id=? AND year=? RETURNING next_seq - 1` — gets the new sequence.
2. `INSERT INTO receipts (id, receipt_no, ...) VALUES (...)`.
3. `INSERT INTO ledger_entries (id, type='PAYMENT_RECEIVED', direction='credit', amount=?, receipt_id=?, tamper_hash=?, ...) VALUES (...)`.
4. `INSERT INTO sync_outbox (entity_type='ledger_entries', entity_id=?, operation='INSERT', ...)`.
5. `INSERT INTO audit_log (action='payment_recorded', actor='tutor', ...)`.
6. (Optional) `UPDATE invoices SET status='paid' WHERE id=?` if `invoiceId` was provided and the payment exactly covers it.

All six statements succeed or all fail. The `tamper_hash` is computed as `sha256(prev_hash || entry_id || student_id || type || amount || occurred_on || tenant_secret)`.

### 5.3 `POST /api/ledger/void`

Append a `VOID` entry that reverses a prior entry (BR-LED-07, compensating entry).

| Field | Value |
|---|---|
| Method | `POST` |
| Path | `/api/ledger/void` |
| Auth | Supabase session + provisioned + PIN (BR-SEC-02) |
| Rate limit | `write` (10/min per IP) |
| Implements | `07_Fees_and_Payments.md` §9 Flow 10, BR-LED-07, EC-F-05 |

**Request body (Zod):**
```ts
const VoidEntrySchema = z.object({
  entryId: z.string().uuid(),
  reason: z.string().min(3).max(200),    // typed reason (BR-ATT-07 mirror)
  pin: z.string().regex(/^\d{6}$/),
});
```

**Response 200:**
```json
{
  "ok": true,
  "value": {
    "voidEntryId": "led-...",
    "reversesEntryId": "led-...",
    "tamperHash": "fd0d9903...",
    "studentBalancePaise": 500000
  }
}
```

**Response 409 (entry already voided):**
```json
{ "ok": false, "error": { "code": "ALREADY_VOIDED", "voidingEntryId": "led-..." } }
```

**Response 409 (cascade block — voiding a FEE_CHARGED that has PAYMENT_RECEIVED credits, BR-LED-04):**
```json
{ "ok": false, "error": { "code": "CASCADE_BLOCK", "reason": "Void the receipts first.", "blockingEntryIds": ["led-..."] } }
```

**Response 423 (entry is past 24h soft-lock and the reason was not provided / insufficient — BR-ATT-07 mirror):**
```json
{ "ok": false, "error": { "code": "LOCKED_ENTRY", "lockTier": "backdated", "requiresAudit": true } }
```

**Side effects.** INSERT `VOID` ledger entry with `reverses_entry_id = original.id`, direction opposite, amount equal. INSERT `audit_log` `action='ledger_void'`. If the original was a `PAYMENT_RECEIVED`, also marks the linked `receipts` row as `voided_at = now()` (the receipt row itself is never deleted — top-level `AGENTS.md` Rule 1).

---

## 6. Route Contracts — Attendance

### 6.1 `POST /api/attendance/mark`

Mark attendance for a session (one row per student per session).

| Field | Value |
|---|---|
| Method | `POST` |
| Path | `/api/attendance/mark` |
| Auth | Supabase session + provisioned + PIN (if session is locked — BR-ATT-03) |
| Rate limit | `write` (10/min per IP) |
| Implements | `06_Attendance.md` §4, BR-ATT-01..07 |

**Request body (Zod):**
```ts
const MarkAttendanceSchema = z.object({
  sessionId: z.string().uuid(),
  records: z.array(
    z.object({
      studentId: z.string().uuid(),
      status: z.enum(["present", "absent", "late", "excused"]),
      note: z.string().max(120).optional(),
    })
  ).min(1).max(200),
  pin: z.string().regex(/^\d{6}$/).optional(), // required if session.locked_at IS NOT NULL
});
```

**Response 200:**
```json
{ "ok": true, "value": { "marked": 30, "sessionLockedAt": "2025-...T...Z" | null } }
```

**Response 422:** `{ "ok": false, "error": { "code": "VALIDATION", "issues": [...] } }`

**Response 409 (session locked, PIN not provided):**
```json
{ "ok": false, "error": { "code": "SESSION_LOCKED", "lockedAt": "2025-...", "requiresPin": true } }
```

**Response 423 (session past 48h hard-lock — BR-ATT-03):**
```json
{ "ok": false, "error": { "code": "HARD_LOCKED", "lockedAt": "2025-...", "lockTier": "hard" } }
```

**Side effects.** For each record: `INSERT INTO attendance_records (...)` (or `UPDATE` if the `(session_id, student_id)` pair already exists — LWW applies; attendance records are mutable until the session is locked). INSERT `sync_outbox` per record. INSERT `audit_log` `action='attendance_marked'` (or `action='attendance_edit_locked'` if editing a locked session).

---

## 7. Route Contracts — Reports

### 7.1 `GET /api/reports/[type]`

Generate a report (CSV or PDF).

| Field | Value |
|---|---|
| Method | `GET` |
| Path | `/api/reports/[type]` |
| Auth | Supabase session + provisioned + PIN (BR-SEC-02 for some types) |
| Rate limit | `read` (60/min per IP) |
| Implements | `02_Core_Logic.md` §11 (Report engine), BR-RPT-* |

**Path params:**
- `type` ∈ `"student-statement"`, `"monthly-finance"`, `"attendance-summary"`, `"collection"`, `"arrears"`, `"tax-gst"` (v1.x).

**Query params:**
```ts
const ReportQuerySchema = z.object({
  studentId: z.string().uuid().optional(),  // required for "student-statement"
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  format: z.enum(["csv", "pdf"]).default("pdf"),
  pin: z.string().regex(/^\d{6}$/).optional(), // required for "tax-gst" (BR-SEC-02)
});
```

**Response 200 (`format=pdf`):** `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="student-statement-stu-....pdf"`, body = the PDF binary (rendered via `pdf-lib` server-side).

**Response 200 (`format=csv`):** `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="monthly-finance-2025-09.csv"`, body = the CSV text.

**Response 400:** `{ "ok": false, "error": { "code": "INVALID_REPORT_TYPE" } }`

**Response 422:** `{ "ok": false, "error": { "code": "VALIDATION", "issues": [...] } }`

**Cache:** `Cache-Control: private, no-store`. Reports are derived from the ledger and may change on the next mutation.

---

## 8. Route Contracts — Backup

### 8.1 `POST /api/backup/create`

Create an encrypted `.buddysaradhi` backup file.

| Field | Value |
|---|---|
| Method | `POST` |
| Path | `/api/backup/create` |
| Auth | Supabase session + provisioned + PIN (BR-SEC-02) |
| Rate limit | `write` (10/min per IP) |
| Implements | `09_Backup_and_Import_Export.md` §3, BR-BAT-01..03, BACKUP-1..4 |

**Request body (Zod):**
```ts
const CreateBackupSchema = z.object({
  passphrase: z.string().min(12).max(200),       // Argon2id KDF input
  includeAuditLog: z.boolean().default(true),
  pin: z.string().regex(/^\d{6}$/),
});
```

**Response 200:**
```json
{
  "ok": true,
  "value": {
    "downloadUrl": "/api/backup/download?token=...",
    "expiresAt": "2025-...T...Z",      // 5-minute signed URL
    "sizeBytes": 283456,
    "sha256": "ab12...",
    "createdAt": "2025-..."
  }
}
```

**Response 422 (passphrase too weak — zxcvbn score < 3):**
```json
{ "ok": false, "error": { "code": "WEAK_PASSPHRASE", "score": 2, "minRequired": 3 } }
```

**Side effects.** The server streams every table from the user's Turso DB into a JSON envelope, encrypts with AES-256-GCM keyed by Argon2id(passphrase, salt=16 random bytes; m=64MiB, t=3, p=2). The envelope layout is `salt(16) || nonce(12) || tag(16) || ciphertext`. The encrypted blob is held in memory (or Vercel Blob if > 4 MB) for 5 minutes; the response's `downloadUrl` is a signed URL.

### 8.2 `POST /api/backup/restore`

Restore from an encrypted `.buddysaradhi` file.

| Field | Value |
|---|---|
| Method | `POST` |
| Path | `/api/backup/restore` |
| Auth | Supabase session + provisioned + PIN (BR-SEC-02) |
| Rate limit | `write` (10/min per IP) |
| Implements | `09_Backup_and_Import_Export.md` §4, BR-BAT-02 |

**Request (multipart/form-data):**
- `file`: the `.buddysaradhi` file (binary, max 50 MB).
- `passphrase`: string.
- `pin`: string.
- `mode`: `"replace"` (wipe current DB and restore) or `"merge"` (insert new rows only, skip existing IDs).

**Response 200:**
```json
{
  "ok": true,
  "value": {
    "restoredRows": 1247,
    "skippedRows": 0,
    "wroteAuditLog": true,
    "completedAt": "2025-..."
  }
}
```

**Response 403 (wrong passphrase after 3 attempts — BR-BAT-02):**
```json
{ "ok": false, "error": { "code": "WRONG_PASSPHRASE", "attemptsUsed": 3, "locked": true } }
```

**Response 409 (`mode=replace` but the current DB has more rows than the backup — destructive confirm required):**
```json
{
  "ok": false,
  "error": {
    "code": "DESTRUCTIVE_CONFIRM_REQUIRED",
    "currentRows": 1500,
    "backupRows": 1200,
    "confirmToken": "..."
  }
}
```

**Side effects.** Decrypts the file (AES-256-GCM; Argon2id key from passphrase + salt in the envelope). Parses the JSON. In `replace` mode: drops all rows from every non-system table, runs the migration suite to recreate the schema, inserts the backup rows. In `merge` mode: iterates rows, INSERTs only if the ID doesn't exist. Always writes `audit_log` `action='backup_restored'` with the count.

---

## 9. Error Code Catalogue

Every error code returned by any `/api/*` route:

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION` | 400/422 | Zod parse failed; `issues` array in payload. |
| `UNAUTHENTICATED` | 401 | No Supabase session; client should redirect to `/login`. |
| `UNPROVISIONED` | 403 | Session exists but `user_metadata.db_url` missing; redirect to `/signup/provision`. |
| `PIN_INVALID` | 403 | PIN mismatch; `attemptsRemaining` in payload. |
| `PIN_LOCKED` | 423 | Lockout window active; `retryAfter` in payload. |
| `RATE_LIMITED` | 429 | Token bucket empty; `retryAfter` in payload. |
| `NOT_FOUND` | 404 | Entity ID not found in this tenant. |
| `STUDENT_NOT_FOUND` | 404 | Specialisation of `NOT_FOUND` for students. |
| `DUPLICATE_STUDENT_CODE` | 409 | Student code already exists in this tenant. |
| `DUPLICATE_KEY_SUSPECTED` | 409 | Soft-duplicate (BR-STU-02); offers merge URL. |
| `ALREADY_VOIDED` | 409 | Ledger entry already has a VOID pair. |
| `CASCADE_BLOCK` | 409 | Void blocked by FK constraint (BR-LED-04). |
| `LOCKED_ENTRY` | 423 | Ledger entry past 24h soft-lock. |
| `HARD_LOCKED` | 423 | Attendance session past 48h hard-lock (BR-ATT-03). |
| `SESSION_LOCKED` | 409 | Attendance session locked; PIN required. |
| `ALREADY_PROVISIONED` | 409 | `POST /api/provision` called when `db_url` already set. |
| `WEAK_PASSPHRASE` | 422 | Backup passphrase zxcvbn < 3. |
| `WRONG_PASSPHRASE` | 403 | Restore passphrase mismatch. |
| `DESTRUCTIVE_CONFIRM_REQUIRED` | 409 | `replace` mode restore needs explicit confirm. |
| `TURSO_API_FAILED` | 500 | Turso Platform API error (provisioning). |
| `TURSO_TOKEN_EXPIRED` | 401 | Scoped JWT hit 1-year expiry. |
| `TAMPER_DETECTED` | 500 | Ledger hash chain verification failed. |
| `INTERNAL` | 500 | Catch-all; detail in payload (server logs only, no PII). |

---

## 10. Common Pitfalls

| # | Anti-pattern | Why wrong | Fix |
|---|---|---|---|
| 1 | Returning `any` from a route | Breaks type safety (top-level `AGENTS.md` AP-7). | Return `Result<T, E>` typed; infer from Zod. |
| 2 | Skipping Zod parse "because the form already validated" | Defence-in-depth; client validation can be bypassed (top-level `AGENTS.md` §6.1). | Always parse server-side. |
| 3 | `UPDATE` on `ledger_entries` to "fix" an entry | Append-only invariant (Rule 1, BR-LED-06). | INSERT a `VOID` row via `/api/ledger/void`. |
| 4 | Using `number` (float) for `amountPaise` | Float drift (Rule 6, BR-M-01). | `z.number().int()`; bigint inside the server. |
| 5 | Reading `db_token` from a query string | URL leaks to logs (top-level `10_Security.md`). | Always from `cookies()` → Supabase session. |
| 6 | Forgetting `sync_outbox` INSERT | Other devices won't see the change (BR-SYN-01). | Same `batch()` as the mutation. |
| 7 | Hardcoding `http://localhost:3000` in a URL | FM-06 lint failure. | `process.env.NEXT_PUBLIC_APP_URL`. |
| 8 | `console.log(err)` in a catch | AP-9 lint failure. | Typed logger; surface via `audit_log`. |

---

## 11. Cross-References

- Top-level `AGENTS.md` §6.4 — API route discipline.
- Top-level `AGENTS.md` §2 Rule 1 — append-only ledger.
- Top-level `AGENTS.md` §2 Rule 6 — integer paise.
- Top-level `12_Business_Rules.md` §3 — BR-LED-* (ledger rules).
- Top-level `12_Business_Rules.md` §4 — BR-FEE-* (fee rules).
- Top-level `12_Business_Rules.md` §5 — BR-ATT-* (attendance rules).
- Top-level `12_Business_Rules.md` §9 — `BR-SYN-*` (sync rules: BR-SYN-01 v1 stub + BR-SYN-02..09 LWW/vector-clock/conflict).
- Top-level `12_Business_Rules.md` §10 — `BR-SEC-*` (security rules: BR-SEC-01 through BR-SEC-10).
- Top-level `12_Business_Rules.md` §5 — BR-BAT-* (batch rules — referenced where backup/restore touches batch enrollment cascades).
- Top-level `14_Edge_Cases.md` — EC-F-* (money), EC-A-* (attendance), EC-M-* (migration context only — see §0.1 retirement note).
- Top-level `10_Security.md` §9 — LEDGER-1..4.
- Top-level `10_Security.md` §15 — BACKUP-1..4.
- This directory's `02_State_and_Data_Flow.md` §3.5 — optimistic update pattern.
- This directory's `03_Auth_and_Provisioning.md` §4 — provisioning flow.
- This directory's `05_Deployment_Vercel.md` §9 — Edge Function deploy.
- This directory's `06_Build_and_Release.md` — the `/api/releases/latest` server route that merges the desktop + mobile Vercel Blob manifests into a single payload for the commercial landing page's Download Hub.
- This directory's `07_Landing_Page.md §6.1` — the consumer of `/api/releases/latest` on the commercial landing page (the `DownloadHub` RSC fetches it at build/revalidate time and passes the resolved data as props to the five `DownloadCard` children).

---

## 12. ASCII Art Mockup Suite (§20 Compliance)

Per `13_UI_Guidelines.md` §20.6, every web/ API-routes file must carry ≥ 2 ASCII art mockups. The mockups below add three views the existing route contracts in §3–§8 do not surface: (1) the full `/api/*` route tree with method + auth + rate-limit annotated, (2) the request/response envelope as a wire diagram, and (3) the error-response matrix mapping every error code to its HTTP status, accent colour, and toast severity. Every mockup sits inside a fenced code block per §20.3 rule 1; box widths stay within the 80–120 character desktop range per §20.3 rule 2; the §20.2 character set is in use; accent colours are named, never hexed; cross-references use canonical IDs only. The `/api/*` surface is server-only — it carries **no glass tier and no neumorphic recipe** (per §5.5 audit rule, a surface described without a glass tier is a spec defect *unless* it is server-only — the `/api/*` routes are the explicit server-only exception, surfaced in the architecture spec §3.0 as `NO glass / NO neumo`).

### 12.1 Design System Reference — API Surface (Server-Only)

> **The single rule (§6.6) does not apply to `/api/*` routes.** API routes are server-only — they return JSON, not UI. They carry no glass tier and no neumorphic recipe. The **client-side surfaces that consume API responses** (the toast that surfaces an error, the drawer that renders a list, the modal that confirms a destructive action) ARE in the design system; the tables below list the consumer surfaces and their tier/recipe so the API contract author knows which UI surfaces a given error code will land on.

| Surface (consumer of API responses) | Glass tier | Where on web | Cross-ref |
|---|---|---|---|
| Toast (renders `error.code` from any `/api/*` Err) | `glass-strong` + 4px accent bar | app-wide transient | §5.5, §8.8 |
| Error helper text under input (renders `VALIDATION` issues) | flat tinted, no glass | inside `.neumo-inset` well | §6.6, §8.9 |
| Confirm modal (renders `DESTRUCTIVE_CONFIRM_REQUIRED`) | `glass-strong` + backdrop | `/fees`, `/settings` | §5.5, §8.7 |
| List row (renders `items[]` from GET endpoints) | `glass-faint` band | `/students`, `/fees` | §5.5, §8.4 |
| Drawer (renders `StudentDTO` from GET /api/students/[id]) | `glass-strong` | `/students/[id]` | §5.5, §8.7 |

| Control (consumer of API responses) | Neumo recipe | Where on web | Cross-ref |
|---|---|---|---|
| Retry button (on `5xx` / `RATE_LIMITED`) | `neumo-raised` + cyan glow | toast action | §6.6, §8.2 |
| Cancel button (on confirm modal) | ghost (transparent) | confirm modal | §8.2 |
| Confirm destructive button (on `DESTRUCTIVE_CONFIRM_REQUIRED`) | `neumo-raised` + flare glow | confirm modal | §6.6, §8.2 |

> **References.** Next.js 16 App Router docs (Route Handlers, `NextRequest` / `NextResponse`, dynamic routes, `runtime = 'edge'` vs `'nodejs'`); Vercel docs (serverless function `maxDuration`, Edge runtime limits, cron jobs, `@vercel/blob`); Stripe API docs (the `Result<T, E>` envelope pattern and error-code catalogue inspiration); Zod docs (`safeParse`, `z.object`, `z.coerce`, custom error maps); OWASP REST Security Cheat Sheet (rate-limiting, input validation, no sensitive data in URLs). These are the same references cited in `README.md` §7.2.

### 12.2 Mockup M1 — `/api/*` Route Tree (Method + Auth + Rate-Limit Annotated)

The §3–§8 contracts documented each route individually; this mockup shows the **full tree** at a glance, with method, auth gate, rate-limit class, and the BR-/EC- IDs implemented. Read top-down: the tree groups routes by domain (provisioning, students, ledger, attendance, reports, backup, releases, sync, cron).

```
   src/app/api/* — Full Route Tree (server-only; NO glass / NO neumo)
   ↑ per §5.5 audit rule, server-only surfaces are the explicit exception to the glass-tier requirement

   /
   └── api/
       ├── spec/                        GET   • auth: NONE                • rate: read  • template (allowlist + path.basename)
       │   └── route.ts                 ↑ the hardened template — every file-serving route inherits this pattern (§1.1)
       │
       ├── provision/                   POST  • auth: session (db_url may  • rate: write • 03_Auth §3, 10_Security §2.1
       │   └── route.ts                        be missing — idempotent)                  • side-effect: Turso Platform API +
       │                                                                            user_metadata write +
       │                                                                            bootstrapSchema()
       │
       ├── students/                    GET   • auth: session + prov.      • rate: read  • 05_Students §3, BR-STU-01
       │   ├── route.ts                  POST  • auth: session + prov.      • rate: write • 05_Students §4, BR-STU-01..05,
       │   │                                                                        BR-RC-02 (student code seq)
       │   │              ↑ side-effect: INSERT students + sync_outbox + audit_log (batch)
       │   └── [id]/
       │       └── route.ts              PATCH • auth: session + prov.      • rate: write • 05_Students §5, BR-STU-06,
       │                                                                        BR-STU-02 (dup-key merge)
       │                      ↑ side-effect: UPDATE students + sync_outbox + audit_log (batch, LWW via BR-SYN-01)
       │
       ├── ledger/                      GET   • auth: session + prov.      • rate: read  • 07_Fees §4, BR-LED-01..04
       │   ├── route.ts                  ↑ IMMUTABLE — ledger is append-only (BR-LED-06); staleTime: Infinity safe
       │   ├── record-payment/
       │   │   └── route.ts              POST  • auth: session + prov.      • rate: write • 07_Fees §9 Flow 1, BR-LED-06,
       │   │             • PIN required (BR-SEC-02)                                  BR-FEE-01/03/04, BR-RC-01
       │   │             • amountPaise: z.number().int() (BR-M-01)                  • 409 on over-payment → auto-split
       │   │             • paymentRef required for 'cheque' (EC-F-04)                • side-effect: INSERT ledger_entries +
       │   │                                                                            receipts + sync_outbox + audit_log
       │   └── void/
       │       └── route.ts              POST  • auth: session + prov.      • rate: write • 07_Fees §9 Flow 10, BR-LED-07,
       │             • PIN required (BR-SEC-02)                                  EC-F-05
       │             • reason: z.string().min(3).max(200)                       • 409 CASCADE_BLOCK (BR-LED-04)
       │                                                                        • 423 past 24h soft-lock (BR-ATT-07 mirror)
       │                                                                        • side-effect: INSERT VOID entry (reverses_entry_id) +
       │                                                                          sync_outbox + audit_log
       │
       ├── attendance/
       │   └── mark/
       │       └── route.ts              POST  • auth: session + prov.      • rate: write • 06_Attendance §4, BR-ATT-01..07
       │             • PIN if session locked (BR-ATT-03)                       • 423 past 48h hard-lock (BR-ATT-03)
       │             • date <= today (EC-A-01)                                  • side-effect: INSERT attendance_records +
       │             • student.status = 'active'                                sync_outbox + audit_log
       │
       ├── reports/
       │   └── [type]/
       │       └── route.ts              GET   • auth: session + prov.      • rate: read  • 09_Backup §3 (export), 04_Dashboard §10
       │             • type ∈ {csv,pdf}                                      • BR-RPT-01..05
       │             • maxDuration: 30 s (vercel.json)                       • returns Content-Disposition: attachment
       │
       ├── backup/
       │   ├── create/
       │   │   └── route.ts              POST  • auth: session + prov.      • rate: write • 09_Backup §3, BACKUP-1..4
       │   │             • PIN required (BR-SEC-02)                          • BR-BAT-01..03 (batch cascades)
       │   │             • passphrase zxcvbn ≥ 3 (BR-BAT-02)                  • maxDuration: 60 s
       │   │             • AES-256-GCM + Argon2id key                         • side-effect: writes encrypted .buddysaradhi to
       │   │                                                                            memory + audit_log
       │   └── restore/
       │       └── route.ts              POST  • auth: session + prov.      • rate: write • 09_Backup §4, BR-BAT-02
       │             • PIN required (BR-SEC-02)                          • maxDuration: 120 s
       │             • passphrase verify                                  • 403 WRONG_PASSPHRASE after 3 attempts
       │             • mode: 'replace' | 'merge'                          • 409 DESTRUCTIVE_CONFIRM_REQUIRED (replace)
       │                                                                        • side-effect: decrypts + parses +
       │                                                                          (replace) drops + recreates schema +
       │                                                                          inserts rows + audit_log
       │
       ├── releases/
       │   └── latest/
       │       └── route.ts              GET   • auth: NONE (public)        • rate: read  • 06_Build §4, 07_Landing §6.1
       │             • Cache-Control: public, max-age=3600                • merges desktop + mobile manifests
       │             • ISR revalidate: 3600                               • consumed by DownloadHub RSC
       │
       ├── sync/
       │   └── pull/
       │       └── route.ts              POST  • auth: session + prov.      • rate: read  • 02_State §7, BR-SYN-01..03
       │             • since: ISO 8601 timestamp                          • returns delta rows from sync_outbox
       │             • Zod validates response before cache write          • web polls every 30 s
       │
       ├── cron/
       │   ├── rotate-tokens/
       │   │   └── route.ts              GET   • auth: CRON_SECRET bearer   • (no rate)   • 05_Deployment §2.3, BR-SEC-02
       │             • schedule: 0 3 1 * * (monthly)                      • rotates Turso scoped JWTs 30 d pre-expiry
       │   ├── alerts-check/
       │   │   └── route.ts              GET   • auth: CRON_SECRET bearer   • (no rate)   • 05_Deployment §8
       │             • schedule: */15 * * * *                              • checks Vercel + Turso usage vs 80% threshold
       │   └── post-deploy-smoke/
       │       └── route.ts              GET   • auth: CRON_SECRET bearer   • (no rate)   • 05_Deployment §9.3
       │             • production-only                                     • agent-browser smoke on https://buddysaradhi.app/
       │             • runs after every prod deploy                       • screenshots + asserts 200
       │
       └── newsletter/
           └── subscribe/                POST  • auth: NONE (public)        • rate: write (5/hr per IP) • 07_Landing §11
               └── route.ts              • email: z.string().email()                            • side-effect: INSERT newsletter_subscribers
                                        • Zod parse + list-bombing defence                       in platform Turso DB (NOT per-user)

   ── Auth gates summary ─────────────────────────────────────────────────────────────────────────────────
     NONE                 : /api/spec, /api/releases/latest, /api/newsletter/subscribe
     CRON_SECRET bearer   : /api/cron/*
     session              : /api/provision (db_url may be missing — idempotent)
     session + prov.      : /api/students/*, /api/ledger/*, /api/attendance/mark, /api/reports/*,
                            /api/backup/*, /api/sync/pull
     session + prov. + PIN: /api/ledger/record-payment, /api/ledger/void, /api/backup/create,
                            /api/backup/restore (BR-SEC-02 sensitive-action gate)

   ── Rate-limit classes (token bucket per IP, in-memory, per-instance) ──────────────────────────────────
     read  : 60 tokens / 60 s = 1/sec;  cap 60   → 429 with Retry-After on exceed
     write : 10 tokens / 60 s = 1/6sec; cap 10   → 429 with Retry-After on exceed
     ↑ in-memory bucket is per-instance on Vercel serverless — limit is approximate (stops casual abuse,
       not DDoS; Vercel Edge firewall handles DDoS)
```

The tree shows all 17 `/api/*` routes, grouped by domain, with method, auth gate, rate-limit class, and the BR-/EC- IDs each implements. Three routes have NO auth (`/api/spec`, `/api/releases/latest`, `/api/newsletter/subscribe` — public endpoints); three have `CRON_SECRET` bearer auth (`/api/cron/*`); one has session-only auth (`/api/provision` — idempotent, runs pre-provision); seven have session + provisioned auth; and three of those seven additionally require a PIN (BR-SEC-02 sensitive-action gate). The rate-limit summary at the bottom restates the token-bucket caps — read routes get 60/min per IP, write routes get 10/min per IP. The in-memory bucket is per-instance on Vercel serverless, so the limit is approximate; DDoS protection is delegated to Vercel's Edge firewall.

### 12.3 Mockup M2 — Request / Response Envelope (Wire Diagram)

The §1 discipline said routes return a typed `Result<T, E>` JSON envelope; this mockup shows the **envelope on the wire** — the exact JSON shape that crosses the boundary between the Client island and the `/api/*` route. The point: the envelope is `{ ok: true, value: T } | { ok: false, error: E }` — never a bare value, never a thrown exception.

```
   Request / Response Envelope — Wire Diagram
   Every /api/* route returns Result<T, E> JSON; never a bare value, never a thrown exception

   ── Request (POST /api/ledger/record-payment) ──────────────────────────────────────────────────────────

     POST /api/ledger/record-payment HTTP/1.1
     Host: buddysaradhi.app
     Content-Type: application/json
     Cookie: sb-access-token=eyJhbG...; sb-refresh-token=eyJhbG...
     ↑ auth via HTTP-only cookie (not a bearer token — see 03_Auth §2)

     {
       "studentId": "stu-01HKX3...",
       "amountPaise": 450000,           ← integer paise (BR-M-01); 450000 = ₹4,500.00
       "method": "cash",
       "date": "2025-01-15",
       "pin": "123456",                ← BR-SEC-02 sensitive-action PIN
       "paymentRef": null,
       "description": "January tuition"
     }
     ↑ Zod parses this BEFORE the route handler runs (§1 rule 1)
     ↑ on parse failure → 400 { error: { code: "VALIDATION", issues: [...] } }

   ── Response 200 (Ok) ──────────────────────────────────────────────────────────────────────────────────

     HTTP/1.1 200 OK
     Content-Type: application/json
     Cache-Control: no-store
     ↑ no-store on mutations; read endpoints use ETag + max-age per entity

     {
       "ok": true,
       "value": {
         "entryId": "led-01HKX4...",
         "receiptNumber": "RCP-000043",
         "receiptUrl": "/api/reports/receipt?entryId=led-01HKX4...",
         "balancePaise": 0,
         "split": false                  ← true if over-payment auto-split (BR-FEE-04)
       }
     }
     ↑ the Client island's useMutation onSuccess reads value; onSettled invalidates Query keys

   ── Response 409 (Err — over-payment without [ADVANCE] tag) ────────────────────────────────────────────

     HTTP/1.1 409 Conflict
     Content-Type: application/json

     {
       "ok": false,
       "error": {
         "code": "OVERPAYMENT_SPLIT",
         "message": "Payment exceeded balance; split into exact + [ADVANCE] rows.",
         "entryIds": ["led-01HKX4...", "led-01HKX5..."],
         "split": true,
         "advancePortionPaise": 50000
       }
     }
     ↑ the Client island's useMutation onSuccess reads error (still 200-level success at the HTTP layer
       for typed business errors — the toast surfaces the typed code, not the HTTP status)
     ↑ wait — re-read §1 rule 2: routes return JSON { ok: true, value: T } | { ok: false, error: E };
       the HTTP status follows the error code's mapping (§9 catalogue). OVERPAYMENT_SPLIT returns 200 with
       ok=true (the split succeeded — it's a business outcome, not an error). The 409 case is
       DUPLICATE_STUDENT_CODE or CASCADE_BLOCK. Corrected below.

   ── Response 409 (Err — void blocked by cascade) ───────────────────────────────────────────────────────

     HTTP/1.1 409 Conflict
     Content-Type: application/json

     {
       "ok": false,
       "error": {
         "code": "CASCADE_BLOCK",
         "message": "Cannot void: 3 PAYMENT_RECEIVED credits reference this FEE_CHARGED.",
         "referencingEntryIds": ["led-01HKX1...", "led-01HKX2...", "led-01HKX3..."],
         "retry": false
       }
     }
     ↑ BR-LED-04 — voiding a FEE_CHARGED that has PAYMENT_RECEIVED credits is blocked at the engine level
     ↑ the Client island's useMutation onError reads error.code → toast with flare accent + Retry button
       disabled (retry: false means retrying won't help; the user must void the credits first)

   ── Response 423 (Err — hard-locked attendance session) ────────────────────────────────────────────────

     HTTP/1.1 423 Locked
     Content-Type: application/json

     {
       "ok": false,
       "error": {
         "code": "HARD_LOCKED",
         "message": "Attendance session past 48h hard-lock.",
         "sessionDate": "2025-01-13",
         "retryAfter": null,
         "retry": false
       }
     }
     ↑ BR-ATT-03 — attendance sessions past 48h cannot be edited; no PIN override path
     ↑ toast with flare accent; no Retry button (retry: false)

   ── Response 429 (Err — rate-limited) ──────────────────────────────────────────────────────────────────

     HTTP/1.1 429 Too Many Requests
     Content-Type: application/json
     Retry-After: 6
     ↑ the Retry-After header is the contract; the Client island MUST honour it (no retry loop)

     {
       "ok": false,
       "error": {
         "code": "RATE_LIMITED",
         "message": "Too many requests. Slow down.",
         "retryAfter": 6
       }
     }
     ↑ toast with amber accent; Retry button disabled for retryAfter seconds, then re-enabled

   ── Response 500 (Err — internal; no PII in detail) ────────────────────────────────────────────────────

     HTTP/1.1 500 Internal Server Error
     Content-Type: application/json

     {
       "ok": false,
       "error": {
         "code": "INTERNAL",
         "message": "Unexpected error. The team has been notified.",
         "detail": null,              ← PII NEVER in detail; full stack trace in server logs only
         "requestId": "req_01HKX6..."  ← surfaces in audit_log; support can correlate
       }
     }
     ↑ toast with flare accent; persistent (no auto-dismiss); Retry button after 5 s
     ↑ audit_log row: action='error_unhandled', actor='system', request_id=req_01HKX6...
```

The wire diagram shows six response variants — 200 Ok, 409 CascadeBlock, 423 HardLocked, 429 RateLimited, 500 Internal — and the exact JSON shape for each. The envelope is always `{ ok: true, value: T } | { ok: false, error: E }` — never a bare value, never a thrown exception. The `error` object always carries a stable `code` string (the §9 catalogue) that the Client island switches on; it may carry additional fields (`referencingEntryIds`, `retryAfter`, `requestId`) depending on the code. The `detail` field on 500 responses is ALWAYS `null` to the client — the full stack trace lives in server logs only, never in the response body, never PII. The `Retry-After` header on 429 is the contract — the Client island must honour it (no retry loop).

### 12.4 Mockup M3 — Error-Response Matrix (Code → HTTP → Accent → Toast Severity)

The §9 catalogue listed the error codes; this mockup shows them as a **matrix** mapping each code to its HTTP status, accent colour, toast severity, and the user-facing message template. The point: every error code has exactly one accent and one severity — the Client island's toast renderer switches on the code, not the HTTP status.

```
   Error-Response Matrix — every code → HTTP status → accent → toast severity → user message
   ↑ accent colours are NAMED, never hexed (§20.3 rule 6)
   ↑ toast severity drives auto-dismiss behaviour (§8.8): persistent = no auto-dismiss

   Code                          │ HTTP │ Accent  │ Severity   │ Auto-     │ User message template
                                │      │         │            │ dismiss   │
   ──────────────────────────────┼──────┼─────────┼────────────┼───────────┼──────────────────────────────────────────
   VALIDATION                    │ 400  │ amber   │ warning    │ 4 s       │ "Some fields need attention."
   UNAUTHENTICATED               │ 401  │ flare   │ error      │ persist   │ "Your session ended. Please sign in again."
   UNPROVISIONED                 │ 403  │ flare   │ error      │ persist   │ "Your database isn't ready yet. Redirecting…"
   PIN_INVALID                   │ 403  │ flare   │ error      │ 4 s       │ "Wrong PIN. {n} attempts left."
   PIN_LOCKED                    │ 423  │ flare   │ error      │ persist   │ "Too many PIN attempts. Wait {retryAfter}s."
   RATE_LIMITED                  │ 429  │ amber   │ warning    │ persist   │ "Slow down — retry in {retryAfter}s."
   NOT_FOUND                     │ 404  │ amber   │ warning    │ 4 s       │ "We couldn't find that."
   STUDENT_NOT_FOUND             │ 404  │ amber   │ warning    │ 4 s       │ "That student doesn't exist."
   DUPLICATE_STUDENT_CODE        │ 409  │ amber   │ warning    │ 4 s       │ "Student code {code} already exists."
   DUPLICATE_KEY_SUSPECTED       │ 409  │ cyan    │ info       │ persist   │ "Similar student found. Merge?"
   ALREADY_VOIDED                │ 409  │ amber   │ warning    │ 4 s       │ "That receipt is already voided."
   CASCADE_BLOCK                 │ 409  │ flare   │ error      │ persist   │ "Can't void — {n} credits reference it."
   LOCKED_ENTRY                  │ 423  │ amber   │ warning    │ 4 s       │ "That entry is past 24h. Void needs a reason."
   HARD_LOCKED                   │ 423  │ flare   │ error      │ persist   │ "Past 48h hard-lock. No edits."
   SESSION_LOCKED                │ 409  │ amber   │ warning    │ 4 s       │ "Session locked. Enter PIN to edit."
   ALREADY_PROVISIONED           │ 409  │ cyan    │ info       │ 4 s       │ "Your database is already set up."
   WEAK_PASSPHRASE               │ 422  │ amber   │ warning    │ 4 s       │ "Passphrase too weak. Use 3+ words."
   WRONG_PASSPHRASE              │ 403  │ flare   │ error      │ 4 s       │ "Wrong passphrase. {n} attempts left."
   DESTRUCTIVE_CONFIRM_REQUIRED  │ 409  │ amber   │ warning    │ persist   │ "Type {word} to confirm replace."
   TURSO_API_FAILED              │ 500  │ flare   │ error      │ persist   │ "Setup failed. Retry or contact support."
   TURSO_TOKEN_EXPIRED           │ 401  │ flare   │ error      │ persist   │ "Your DB token expired. Rotating…"
   TAMPER_DETECTED               │ 500  │ flare   │ error      │ persist   │ "Ledger tamper detected. Halt + contact support."
   INTERNAL                      │ 500  │ flare   │ error      │ persist   │ "Unexpected error. Team notified. {requestId}"
   ──────────────────────────────┼──────┼─────────┼────────────┼───────────┼──────────────────────────────────────────

   ── Accent → toast rendering (per §8.8) ────────────────────────────────────────────────────────────────
     emerald  (✓) : success toast — 4 s auto-dismiss, swipe-to-dismiss, aria-live="polite"
     cyan     (ℹ) : info toast    — 4 s auto-dismiss, swipe-to-dismiss, aria-live="polite"
     amber    (◐) : warning toast  — 4 s auto-dismiss OR persist (per matrix), aria-live="polite"
     flare    (✕) : error toast    — PERSISTENT (no auto-dismiss), aria-live="assertive"
     violet   (−) : NOT used for errors (reserved for excused/neutral states)

   ── Toast surface contract (per §8.8) ──────────────────────────────────────────────────────────────────
     • every toast is .glass-strong + 4px accent left-bar (§5.5)
     • positioned fixed bottom-4 right-4 (desktop) / fixed bottom-20 inset-x-4 (mobile, above tab bar)
     • carries an optional action button (.neumo-raised) — e.g. "Retry" on RATE_LIMITED, "Merge" on
       DUPLICATE_KEY_SUSPECTED, "Rotate" on TURSO_TOKEN_EXPIRED
     • carries a close ✕ (.neumo-raised micro-button, 44px hit area)
     • swipe-down to dismiss on non-persistent variants; persistent requires tap ✕ or action

   ── Client island switch (pseudocode) ──────────────────────────────────────────────────────────────────
     useMutation({
       mutationFn: (input) => fetch('/api/ledger/record-payment', { method: 'POST', body: JSON.stringify(input) }),
       onSuccess: (res) => {
         if (res.ok) {
           toast.success('Payment recorded', { description: `RCP-${res.value.receiptNumber}` });
           qc.invalidateQueries({ queryKey: ['ledger','list'] });
         } else {
           // typed business error — switch on res.error.code
           switch (res.error.code) {
             case 'OVERPAYMENT_SPLIT': // 200-level business outcome, handled in onSuccess not onError
               toast.info('Payment split', { description: 'Excess tagged [ADVANCE].' });
               break;
             // ... other business codes ...
           }
         }
       },
       onError: (err) => {
         // network/transport error only — application errors arrive as res.ok=false in onSuccess
         toast.error('Network error', { description: 'Check your connection.' });
       },
     });
     ↑ the toast.success / .info / .warning / .error helpers read the matrix above and render the
       appropriate .glass-strong + accent bar + auto-dismiss behaviour
```

The matrix shows all 23 error codes mapped to HTTP status, accent, severity, auto-dismiss behaviour, and user message template. The accent drives the toast's 4px left-bar colour (emerald/cyan/amber/flare per §2.4); the severity drives the auto-dismiss behaviour (success/info/warning auto-dismiss after 4 s; error persists). The Client island's toast helper (`toast.success` / `.info` / `.warning` / `.error`) reads the matrix and renders the appropriate `.glass-strong` + accent bar + auto-dismiss behaviour — the renderer switches on the code, not the HTTP status. The pseudocode at the bottom shows the `useMutation` pattern: typed business errors arrive as `res.ok = false` in `onSuccess` (not `onError`); only network/transport errors arrive in `onError`. This split is the contract that lets the Client island surface typed error codes via toast AND write an `audit_log` row in the same handler.

---

*Every route in this file is the contract. When a path, a Zod schema, or an error code diverges, the spec wins — unless the spec is wrong, in which case you amend this file first, then the code, then the worklog.*
