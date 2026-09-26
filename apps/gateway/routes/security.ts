import type { RouteHandler } from "./students.ts";
import { ok, fail } from "../lib/errors.ts";
import { invalidateTenant } from "../lib/cache.ts";

// POST /api/v1/security/erase — implements contracts/openapi.yaml
// operationId `secureErase` ("Securely erase all tutor data").
// Identity: the JWT-derived tenantId must match the body tutorId.
// Confirmation: typed phrase "ERASE" per 10_Security.md 18.1 step 1 and the
// auth-svc reference implementation (apps/services/auth-svc). PIN verification
// is the app layer's gate (web deleteAccountAction, BR-SEC-04) — the edge
// runtime has no argon2 and must never compare raw client-supplied hashes.
export const handleSecurity: RouteHandler = async (req, db, tenantId, path, method) => {
  if (path === "/api/v1/security/erase" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const { tutorId, confirm } = body as { tutorId?: unknown; confirm?: unknown };

    if (typeof tutorId !== "string" || tutorId !== tenantId) {
      return fail("tutorId must match the authenticated tenant", 400);
    }
    if (confirm !== "ERASE") {
      return fail("confirm must be 'ERASE'", 400);
    }

    // 10_Security.md 18.1 step 2 / BR-SEC-03: erase intent is recorded BEFORE
    // any deletion, fail-closed — this insert is deliberately uncaught, so a
    // failed audit write aborts the erase while nothing has been destroyed.
    const initiatedAt = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO audit_log (id, tenant_id, actor, ref_type, ref_id, action, metadata, created_at)
            VALUES (?, ?, ?, 'tenant', ?, 'security.erase_initiated', ?, ?)`,
      args: [
        crypto.randomUUID(),
        tenantId,
        tenantId,
        tenantId,
        JSON.stringify({ confirm }),
        initiatedAt,
      ],
    });

    // 10_Security.md 18.1 step 4 — ONE atomic cascade (libsql batch = single
    // transaction) over every tenant-scoped runtime table (lib/schema.ts).
    // LEDGER-4's single audited exception: physical ledger deletion exists only
    // in the secure-erase flow; every other path posts a void.
    const tables = [
      "ledger_entries",
      "receipts",
      "invoices",
      "attendance_records",
      "attendance_sessions",
      "student_enrollments",
      "students",
      "batches",
      "tutors",
      "notifications",
      "sync_outbox",
      "audit_log",
      "settings",
    ];
    await db.batch(
      tables.map((table) => ({
        sql: `DELETE FROM ${table} WHERE tenant_id = ?`,
        args: [tenantId],
      })),
      "write",
    );

    // 18.1 step 7: erase_complete recorded AFTER the cascade — it and
    // erase_initiated's pre-wipe attempt are what remain of the audit chain.
    await db.execute({
      sql: `INSERT INTO audit_log (id, tenant_id, actor, ref_type, ref_id, action, metadata, created_at)
            VALUES (?, ?, ?, 'tenant', ?, 'security.erase_complete', ?, ?)`,
      args: [
        crypto.randomUUID(),
        tenantId,
        tenantId,
        tenantId,
        JSON.stringify({ tables }),
        new Date().toISOString(),
      ],
    });

    invalidateTenant(tenantId);
    return ok({ success: true });
  }

  return null;
};
