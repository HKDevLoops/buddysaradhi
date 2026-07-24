import type { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID, createHash } from "crypto";

export type LedgerEntryType =
  | "FEE_CHARGED"
  | "PAYMENT_RECEIVED"
  | "DISCOUNT_GRANTED"
  | "REFUND_ISSUED"
  | "ADJUSTMENT"
  | "WRITEOFF"
  | "VOID";

export interface LedgerEntryInput {
  tenantId: string;
  studentId: string;
  type: LedgerEntryType;
  debitPaise: number;
  creditPaise: number;
  description?: string;
  voidOfId?: string;
  occurredOn: string;
  source?: string;
}

export type Result<T, E = Error> =
  { ok: true; value: T } | { ok: false; error: E };

function computeHash(
  prevHash: string | null,
  payload: string,
  createdAt: string,
  tenantSecret: string,
): string {
  const hash = createHash("sha256");
  if (prevHash) hash.update(prevHash);
  hash.update(payload);
  hash.update(createdAt);
  hash.update(tenantSecret);
  return hash.digest("hex");
}

/**
 * BR-LED-01: The ledger is append-only.
 * BR-M-01: Money is stored as integer paise.
 * BR-LED-06: Hash chain
 * BR-SYN-01: Every mutation writes to sync_outbox
 */
export async function postLedgerEntry(
  db: PrismaClient | Prisma.TransactionClient,
  input: LedgerEntryInput,
): Promise<Result<string>> {
  if (input.debitPaise < 0 || input.creditPaise < 0) {
    return { ok: false, error: new Error("Amounts must be positive") };
  }
  if (
    !Number.isInteger(input.debitPaise) ||
    !Number.isInteger(input.creditPaise)
  ) {
    return { ok: false, error: new Error("Amounts must be integers") };
  }

  const entryId = randomUUID();
  const now = new Date().toISOString();
  const source = input.source || "manual";

  try {
    const executeLogic = async (tx: Prisma.TransactionClient) => {
      // 1. Get previous hash and current balance for the student
      const lastEntry = await tx.ledgerEntry.findFirst({
        where: { tenantId: input.tenantId, studentId: input.studentId },
        orderBy: { createdAt: "desc" },
        select: { balanceAfterPaise: true, thisHash: true },
      });

      let currentBalance = 0;
      let prevHash: string | null = null;

      if (lastEntry) {
        currentBalance = lastEntry.balanceAfterPaise;
        prevHash = lastEntry.thisHash;
      }

      // 2. Calculate new balance
      const newBalance = currentBalance + input.debitPaise - input.creditPaise;

      // Fetch tenant secret for hash pepper
      const setting = await tx.setting.findUnique({
        where: { tenantId: input.tenantId },
        select: { tenantSecret: true },
      });
      if (!setting) throw new Error("Tenant settings not found");

      // 3. Compute hash
      const payload = JSON.stringify({
        id: entryId,
        studentId: input.studentId,
        type: input.type,
        debitPaise: input.debitPaise,
        creditPaise: input.creditPaise,
        balanceAfterPaise: newBalance,
        occurredOn: input.occurredOn,
      });
      const thisHash = computeHash(
        prevHash,
        payload,
        now,
        setting.tenantSecret,
      );

      // 4. Insert into ledger_entries
      const newEntry = await tx.ledgerEntry.create({
        data: {
          id: entryId,
          tenantId: input.tenantId,
          studentId: input.studentId,
          type: input.type,
          debitPaise: input.debitPaise,
          creditPaise: input.creditPaise,
          balanceAfterPaise: newBalance,
          description: input.description || null,
          prevHash: prevHash,
          thisHash: thisHash,
          voidOfId: input.voidOfId || null,
          occurredOn: input.occurredOn,
          source: source,
          createdAt: new Date(now),
        },
      });

      // 4b. Sync balance to Student
      await tx.student.update({
        where: { id: input.studentId },
        data: { balancePaise: newBalance },
      });

      // 5. Append to sync_outbox
      const outboxId = randomUUID();
      await tx.syncOutbox.create({
        data: {
          id: outboxId,
          tenantId: input.tenantId,
          tableName: "ledger_entries",
          rowId: entryId,
          op: "insert",
          payload: JSON.stringify(newEntry),
          status: "pending",
          createdAt: new Date(now),
        },
      });

      return entryId;
    };

    let resultEntryId: string;

    // Check if db is already a transaction client
    if ("$transaction" in db) {
      resultEntryId = await (db as PrismaClient).$transaction(executeLogic);
    } else {
      resultEntryId = await executeLogic(db);
    }

    return { ok: true, value: resultEntryId };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

/**
 * BR-LED-04: Voiding requires a new VOID row mirroring the original
 * BR-LED-05: A VOID entry cannot itself be voided
 */
export async function voidEntry(
  db: PrismaClient,
  tenantId: string,
  entryToVoidId: string,
  reason: string,
  occurredOn: string,
  actor: string,
): Promise<Result<string>> {
  try {
    return await db.$transaction(async (tx) => {
      // 1. Fetch the entry to void
      const original = await tx.ledgerEntry.findUnique({
        where: { id: entryToVoidId, tenantId: tenantId },
      });

      if (!original) {
        throw new Error(`Entry ${entryToVoidId} not found.`);
      }

      if (original.type === "VOID") {
        throw new Error("Cannot void a void entry.");
      }

      // 2. Post reversing entry
      const postResult = await postLedgerEntry(tx, {
        tenantId,
        studentId: original.studentId,
        type: "VOID",
        debitPaise: original.creditPaise,
        creditPaise: original.debitPaise,
        description: `VOID: ${reason}`,
        voidOfId: entryToVoidId,
        occurredOn: occurredOn,
        source: "manual",
      });

      if (!postResult.ok) {
        throw postResult.error;
      }

      // 3. Add audit log
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          tenantId: tenantId,
          actor: actor,
          action: "ledger_void",
          refType: "ledger_entries",
          refId: entryToVoidId,
          metadata: JSON.stringify({ reason }),
          createdAt: new Date(),
        },
      });

      return { ok: true, value: postResult.value };
    });
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

/**
 * Compute the current balance for a student.
 */
export async function computeBalance(
  db: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  studentId: string,
): Promise<number> {
  const lastEntry = await db.ledgerEntry.findFirst({
    where: { tenantId, studentId },
    orderBy: { createdAt: "desc" },
    select: { balanceAfterPaise: true },
  });

  return lastEntry ? lastEntry.balanceAfterPaise : 0;
}

/**
 * Reconcile ledger and verify hash chain integrity.
 */
export async function reconcileLedger(
  db: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  studentId: string,
): Promise<Result<boolean>> {
  try {
    const entries = await db.ledgerEntry.findMany({
      where: { tenantId, studentId },
      orderBy: { createdAt: "asc" },
    });

    let runningBalance = 0;
    let prevHash: string | null = null;

    const setting = await db.setting.findUnique({
      where: { tenantId },
      select: { tenantSecret: true },
    });
    if (!setting) throw new Error("Tenant settings not found");

    for (const entry of entries) {
      runningBalance = runningBalance + entry.debitPaise - entry.creditPaise;

      if (runningBalance !== entry.balanceAfterPaise) {
        return {
          ok: false,
          error: new Error(
            `Balance mismatch at entry ${entry.id}. Expected ${runningBalance}, got ${entry.balanceAfterPaise}`,
          ),
        };
      }

      const payload = JSON.stringify({
        id: entry.id,
        studentId: entry.studentId,
        type: entry.type,
        debitPaise: entry.debitPaise,
        creditPaise: entry.creditPaise,
        balanceAfterPaise: entry.balanceAfterPaise,
        occurredOn: entry.occurredOn,
      });

      const expectedHash = computeHash(
        prevHash,
        payload,
        entry.createdAt.toISOString(),
        setting.tenantSecret,
      );
      if (expectedHash !== entry.thisHash) {
        return {
          ok: false,
          error: new Error(
            `Hash mismatch at entry ${entry.id}. Expected ${expectedHash}, got ${entry.thisHash}`,
          ),
        };
      }

      prevHash = entry.thisHash;
    }

    return { ok: true, value: true };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}
