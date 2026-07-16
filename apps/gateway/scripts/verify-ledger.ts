import { getPrismaClient } from "../src/db";
import { reconcileLedger } from "../../../packages/core/src/ledger";

/**
 * verify-ledger: tamper-detection for a tutor's ledger.
 *
 * Walks every student in the tenant and recomputes the per-student hash chain
 * via packages/core reconcileLedger. Exit code 0 = intact, 1 = tampered (or
 * missing Setting). Runs in dev (demo data re-posted via postLedgerEntry) and
 * could be wired into a CI gate / cron.
 *
 * Implements: AGENTS.md §2 (append-only, tamper-evident ledger).
 */

const dbUrl = process.env.DATABASE_URL || "file:./dev.db";
const dbToken = process.env.DB_TOKEN || "";
const tenantId = process.env.TENANT_ID || "local-dev";

const db = getPrismaClient(dbUrl, dbToken);

async function main() {
  const students = await db.student.findMany({
    where: { tenantId },
    select: { id: true, firstName: true, lastName: true, balancePaise: true },
  });

  if (students.length === 0) {
    console.log(`[verify] tenant ${tenantId}: no students; nothing to verify`);
    return;
  }

  let allOk = true;
  for (const s of students) {
    const res = await reconcileLedger(db, tenantId, s.id);
    if (res.ok) {
      console.log(`[verify] ${s.id} (${s.firstName} ${s.lastName}): OK`);
    } else {
      allOk = false;
      console.error(`[verify] ${s.id} (${s.firstName} ${s.lastName}): TAMPERED - ${res.error}`);
    }
  }

  if (!allOk) {
    console.error(`[verify] FAILED: ledger integrity compromised for tenant ${tenantId}`);
    process.exit(1);
  }
  console.log(`[verify] PASSED: ledger integrity verified for tenant ${tenantId}`);
}

main()
  .catch((e) => {
    console.error("verify failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
