import type { PrismaClient, Prisma } from "../../prisma-client";
import { vacuum } from "../db/admin";

/**
 * Data tables wiped on a secure device erase. Every table here is tenant-scoped
 * (or, like student_tags, a pure join table in a single-tenant DB). We use an
 * EMPTY filter (`deleteMany({})`) per 10_Security.md §18.1 — never a `where`
 * clause — because the gateway connects to exactly one tutor's DB, so an
 * empty filter wipes that DB in full.
 *
 * `audit_log` is intentionally NOT in this list: the erase_initiated witness
 * written below must survive so the erase is provable (10_Security.md §18.1).
 */
const ERASABLE_MODELS = [
  "syncOutbox",
  "backupManifest",
  "notification",
  "reminder",
  "receipt",
  "ledgerEntry",
  "invoice",
  "feeScheduleItem",
  "feePlan",
  "attendanceRecord",
  "attendanceSession",
  "studentDocument",
  "studentNote",
  "studentTag",
  "studentEnrollment",
  "guardian",
  "student",
  "batch",
  "tag",
] as const;

export interface SecureEraseResult {
  erased: string;
}

/**
 * Secure erase of a tutor's device DB, compliant with 10_Security.md §18.1:
 *   1. write audit_log(erase_initiated) and commit it (the witness),
 *   2. wipe every data table inside a single $transaction with empty filters,
 *   3. VACUUM to reclaim space.
 */
export async function secureErase(
  db: PrismaClient,
  tenantId: string,
): Promise<SecureEraseResult> {
  // 1. Witness — committed before any data is touched.
  await db.auditLog.create({
    data: {
      id: crypto.randomUUID(),
      tenantId,
      actor: "security_erase",
      action: "erase_initiated",
      refType: "device",
      metadata: JSON.stringify({ reason: "secure_erase_request" }),
      createdAt: new Date(),
    },
  });

  // 2. Wipe data inside one transaction, empty filters (§18.1).
  const wipeOps = ERASABLE_MODELS.map((model) => {
    const delegate = (
      db as unknown as Record<
        string,
        { deleteMany: (a: object) => Prisma.PrismaPromise<{ count: number }> }
      >
    )[model];
    return delegate.deleteMany({});
  });
  await db.$transaction([...wipeOps, db.setting.deleteMany({}), db.appState.deleteMany({})]);

  // 3. Reclaim space (the only permitted raw SQL, §18.1).
  await vacuum(db);

  return { erased: tenantId };
}
