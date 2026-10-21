"use server";

// Implements: 08_Settings.md §6.2.12 (Diagnostics → "Run integrity check",
// which reports mismatches and writes `audit_log` `integrity_check` with
// pass/fail counts, and offers the "Restore from last backup" CTA on a
// mismatch); 12_Business_Rules.md BR-LED-06 (the hash chain is verified, and
// a break surfaces in Diagnostics), BR-LED-02 + BR-RPT-04 (the running balance
// must reconcile); 10_Security.md §9.1 LEDGER-3 (the running-balance
// reconciliation), §9.4 (a violation writes `ledger_integrity_violation` with
// the offending ids), §8.2 (the audited actions); AGENTS.md §2 Rule 9 (a
// failure is stated, never swallowed), Rule 10, §3.4 (ORM only — no raw SQL
// in apps/web), §9.3.7 (the audit row is a local fact, not a replicated
// row — the same convention the fee flow's audit rows follow).
//
// WHY THIS FILE EXISTS. `reconcileLedger` (`packages/core/src/ledger.ts`) is
// the function that would catch a tampered or drifted ledger, and it had
// ZERO production call sites: every hit in the repo was a comment, a spec
// quote, a doc or a test. A corrupted ledger was therefore undetectable, and
// BR-LED-06's own enforcement column ("Red 'CHAIN BROKEN at entry X' in
// Diagnostics") pointed at a surface that did not exist. This is that call
// site — the tutor's own books, on demand, in the place the spec says.

import { getAuthenticatedPrisma } from "@/server/get-db";
import { reconcileLedger } from "@buddysaradhi/core";
import { log } from "@/lib/logger";

/** What is wrong with one student's ledger. */
export type LedgerIntegrityKind = "balance" | "hash";

export interface LedgerIntegrityFailure {
  studentId: string;
  /** The tutor's own words for the student — the audit row carries the id only. */
  studentName: string;
  kind: LedgerIntegrityKind;
  /** The reconciler's own sentence, verbatim — the forensic detail. */
  reason: string;
}

export type LedgerIntegrityCheckResult =
  | {
      success: true;
      studentsChecked: number;
      entriesChecked: number;
      failures: LedgerIntegrityFailure[];
      checkedAt: string;
    }
  | { success: false; error: string };

/**
 * Classify the reconciler's sentence, or `null` when the sentence is not one
 * of the two things the reconciler says about the BOOKS.
 *
 * The reconciler raises two sentences about a ledger that does not add up —
 * a running balance that disagrees, and a tamper hash that does not match —
 * and anything else is the reconciler itself failing (a missing tenant
 * secret, an unreadable row). That third case is NOT a statement about the
 * books, so it must not be reported as one: a check that could not run says
 * the books were not verified, and stops.
 */
function classify(reason: string): LedgerIntegrityKind | null {
  if (/balance mismatch/i.test(reason)) return "balance";
  if (/hash mismatch/i.test(reason)) return "hash";
  return null;
}

function studentNameOf(row: { firstName?: unknown; lastName?: unknown }): string {
  const first = typeof row.firstName === "string" ? row.firstName.trim() : "";
  const last = typeof row.lastName === "string" ? row.lastName.trim() : "";
  const full = `${first} ${last}`.trim();
  return full.length > 0 ? full : "A student";
}

/**
 * Run the ledger reconciliation over the authenticated tenant's books.
 *
 * A READ of the ledger: nothing here writes to `ledger_entries` (Rule 1 — the
 * ledger is append-only and a check is not a correction). What it DOES write
 * is the audit trail: 08 §6.2.12 asks for an `integrity_check` row with
 * pass/fail counts, and 10 §9.4 asks for a `ledger_integrity_violation` row
 * carrying the offending ids when the books do not agree.
 *
 * The audit rows are LOCAL facts, not replicated rows — the same convention
 * the fee flow's `writeAudit` follows. There is no `sync_outbox` row for
 * them, because a replica that has the ledger rows can reconcile them
 * itself, and a replicated "the books disagree" flag would be a claim about
 * a device, not about the books.
 */
export async function runLedgerIntegrityCheckAction(): Promise<LedgerIntegrityCheckResult> {
  try {
    const { db, tenantId } = await getAuthenticatedPrisma();

    // 10 §9.1 LEDGER-3 — the reconciliation walks EVERY student's ledger from
    // row 0. A tutor with no students has nothing to reconcile, and that is
    // an honest answer, not a failure.
    const students = await db.student.findMany({
      where: { tenantId },
      select: { id: true, firstName: true, lastName: true },
    });

    const failures: LedgerIntegrityFailure[] = [];
    for (const student of students) {
      // SAFETY: `reconcileLedger` reads through the ORM surface
      // (`ledgerEntry.findMany` + `setting.findUnique`), and the web's own
      // handle — `createLibsqlProxy`, the sanctioned shim — implements both
      // with the same semantics as the generated client. The cast is the
      // Prisma client's type, not the runtime contract; the runtime contract
      // is the two methods above.
      const res = await reconcileLedger(db as never, tenantId, student.id);
      if (!res.ok) {
        const kind = classify(res.error.message);
        if (kind === null) {
          // The reconciler itself failed — not the books. Stop the check: a
          // check that did not finish must not be reported as a pass.
          throw new Error(
            `LEDGER_RECONCILE_FAILED: ${res.error.message} (student ${student.id})`,
          );
        }
        failures.push({
          studentId: student.id,
          studentName: studentNameOf(student),
          kind,
          reason: res.error.message,
        });
      }
    }

    const entriesChecked = await db.ledgerEntry.count({ where: { tenantId } });
    const checkedAt = new Date().toISOString();

    // 08 §6.2.12 — "the books were checked and they agree" is a fact worth
    // having. The metadata carries COUNTS, never a name (RFC-010 §4.3: audit
    // metadata names the field, never the value).
    await db.auditLog.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        actor: tenantId,
        action: "integrity_check",
        refType: "ledger_entries",
        refId: tenantId,
        metadata: JSON.stringify({
          scope: "ledger",
          students_checked: students.length,
          entries_checked: entriesChecked,
          students_failed: failures.length,
          passed: failures.length === 0,
        }),
        createdAt: checkedAt,
      },
    });

    // 10 §9.4 (2) — one row with the offending ids, not one row per student.
    if (failures.length > 0) {
      await db.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          actor: tenantId,
          action: "ledger_integrity_violation",
          refType: "ledger_entries",
          refId: tenantId,
          metadata: JSON.stringify({
            scope: "ledger",
            offending_student_ids: failures.map((f) => f.studentId),
            kinds: failures.map((f) => f.kind),
          }),
          createdAt: checkedAt,
        },
      });
    }

    log.audit(
      "ledger_integrity_checked",
      failures.length === 0
        ? "The books agree"
        : `The books do not agree: ${failures.length} of ${students.length} students`,
      {
        tenantId,
        students_checked: students.length,
        entries_checked: entriesChecked,
        students_failed: failures.length,
      },
    );

    return {
      success: true,
      studentsChecked: students.length,
      entriesChecked,
      failures,
      checkedAt,
    };
  } catch (error) {
    // Rule 9: the failure is stated. The reconciler could not run — a missing
    // tenant settings row, an unreachable database — and the tutor is told
    // that, not shown a green tick.
    log.error(
      "ledger_integrity_check_failed",
      error instanceof Error ? error.message : String(error),
    );
    return {
      success: false,
      error:
        "The check could not run, so your books have NOT been verified. Nothing was changed. Try again in a moment.",
    };
  }
}
