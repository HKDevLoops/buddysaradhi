import type { RouteHandler } from "./students.ts";
import { run } from "../lib/db.ts";
import { ok } from "../lib/errors.ts";
import { recordAudit } from "./students.ts";
import { invalidateTenant } from "../lib/cache.ts";

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

export const handleSecurity: RouteHandler = async (_req, db, tenantId, path, method) => {
  // POST /api/v1/security/erase
  if (path === "/api/v1/security/erase" && method === "POST") {
    for (const t of ERASABLE) {
      await run(db, `DELETE FROM ${t} WHERE tenant_id = ?`, [tenantId]).catch(() => {});
    }
    await run(db, "DELETE FROM settings WHERE tenant_id = ?", [tenantId]).catch(() => {});
    await recordAudit(db, tenantId, tenantId, "security.erase", null, null, {});
    invalidateTenant(tenantId);
    return ok({ erased: tenantId });
  }

  return null;
};
