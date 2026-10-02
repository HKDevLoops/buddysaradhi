// Verification audit: Core logic check
import type { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID, createHash } from "crypto";
import { z } from "zod";

export const LEDGER_ENTRY_TYPES = [
  "FEE_CHARGED",
  "PAYMENT_RECEIVED",
  "DISCOUNT_GRANTED",
  "REFUND_ISSUED",
  "ADJUSTMENT",
  "WRITEOFF",
  "VOID",
] as const;

export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export interface LedgerEntryInput {
  tenantId: string;
  studentId: string;
  type: LedgerEntryType;
  debitPaise: number;
  creditPaise: number;
  description?: string;
  voidOfId?: string;
  /**
   * Links the row to the invoice it settles. Additive so the invoice/payment
   * flows (`feesFlow.ts`) can attribute a payment to an invoice through the
   * ORM dialect exactly as the libsql dialect does (`postLedgerEntrySql`
   * already carried it) — 07 §9.6 step 5 sums credits per `invoice_id`.
   * Omitted (null) for rows that settle nothing.
   */
  invoiceId?: string | null;
  occurredOn: string;
  source?: string;
}

export type Result<T, E = Error> =
  { ok: true; value: T } | { ok: false; error: E };

export function computeHash(
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
 * The canonical hash-payload for one ledger row (BR-LED-06). Both writer
 * dialects — Prisma (`postLedgerEntry`) and libsql (`postLedgerEntrySql` in
 * `ledgerSql.ts`) — MUST build the payload through this single function so a
 * row written by either dialect verifies against `reconcileLedger`
 * (reviews/overhaul-audit-report-2026-09-26.md F2: hash-dialect unification).
 * JSON key order is load-bearing: `JSON.stringify` preserves insertion order,
 * so this field order is part of the contract.
 */
export function buildEntryPayload(entry: {
  id: string;
  studentId: string;
  type: string;
  debitPaise: number;
  creditPaise: number;
  balanceAfterPaise: number;
  occurredOn: string;
}): string {
  return JSON.stringify({
    id: entry.id,
    studentId: entry.studentId,
    type: entry.type,
    debitPaise: entry.debitPaise,
    creditPaise: entry.creditPaise,
    balanceAfterPaise: entry.balanceAfterPaise,
    occurredOn: entry.occurredOn,
  });
}

// ---------------------------------------------------------------------------
// Outbox codec mirror (P3-11).
//
// Exact mirror of the canonical codec in
// `packages/shared/src/outboxPayload.ts` (same semantics, same key order,
// same error strings). `packages/core` cannot import that module: its
// `tsconfig.json` pins `rootDir: ./src` and it carries no
// `@buddysaradhi/shared` workspace dependency, so a cross-package source
// import fails `tsc` with TS6059 — the same boundary documented in `money.ts`
// for `paiseAdd`/`paiseSub`. Keep the two in sync: changing the canonical
// shape (snake_case keys, sorted key order, `insert | update | soft_delete`
// ops with `create → insert` / `delete → soft_delete` aliases) without
// changing this mirror re-opens P3-11.
//
// `apps/gateway` imports the canonical module directly (Deno/vitest both
// resolve it), so only the core dialects need this mirror.
// ---------------------------------------------------------------------------

const OUTBOX_OPS_MIRROR = ["insert", "update", "soft_delete"] as const;

type OutboxOpMirror = (typeof OUTBOX_OPS_MIRROR)[number];

const OutboxOpMirrorSchema = z.enum(OUTBOX_OPS_MIRROR);

const OutboxEnvelopeMirrorSchema = z.object({
  table_name: z.string().min(1),
  op: OutboxOpMirrorSchema,
  payload: z.string().refine(
    (s) => {
      try {
        const value: unknown = JSON.parse(s);
        return typeof value === "object" && value !== null && !Array.isArray(value);
      } catch {
        return false;
      }
    },
    { message: "payload must be a JSON object string" },
  ),
});

export type OutboxEnvelopeMirror = z.infer<typeof OutboxEnvelopeMirrorSchema>;

function normalizeOutboxOpMirror(op: string): OutboxOpMirror {
  const lower = op.toLowerCase();
  if (lower === "create") return "insert";
  if (lower === "delete") return "soft_delete";
  const parsed = OutboxOpMirrorSchema.safeParse(lower);
  if (!parsed.success) {
    throw new Error(
      `OUTBOX_OP_INVALID: op must be one of insert/update/soft_delete (aliases create/delete), got ${JSON.stringify(op)}`,
    );
  }
  return parsed.data;
}

function toSnakeKeyMirror(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/**
 * Mirror of shared `encodeOutboxPayload`: camelCase-or-snake_case row in,
 * canonical snake_case JSON + `{ table_name, op, payload }` envelope out
 * (Zod-validated). See the block comment above for why the mirror exists.
 */
export function encodeOutboxPayload(
  table: string,
  op: string,
  row: Record<string, unknown>,
): OutboxEnvelopeMirror {
  if (typeof table !== "string" || table.length === 0) {
    throw new Error("OUTBOX_TABLE_INVALID: table_name must be a non-empty string");
  }
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("OUTBOX_ROW_INVALID: row must be a plain object");
  }
  const normalizedOp = normalizeOutboxOpMirror(op);
  const seen = new Map<string, unknown>();
  for (const rawKey of Object.keys(row)) {
    const key = toSnakeKeyMirror(rawKey);
    const value: unknown = row[rawKey];
    if (seen.has(key)) {
      const prev: unknown = seen.get(key);
      if (JSON.stringify(prev) !== JSON.stringify(value)) {
        throw new Error(
          `OUTBOX_ROW_CONFLICT: keys collide on column ${JSON.stringify(key)} with different values (12_Business_Rules.md BR-SYN-02)`,
        );
      }
      continue;
    }
    seen.set(key, value);
  }
  const canonical: Record<string, unknown> = {};
  for (const key of [...seen.keys()].sort()) {
    canonical[key] = seen.get(key);
  }
  const envelope = {
    table_name: table,
    op: normalizedOp,
    payload: JSON.stringify(canonical),
  };
  const parsed = OutboxEnvelopeMirrorSchema.safeParse(envelope);
  if (!parsed.success) {
    throw new Error(`OUTBOX_ENVELOPE_INVALID: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * Strictly-monotonic `created_at` (BR-LED-06 + 07_Fees_and_Payments.md §9.6).
 * `reconcileLedger` walks rows `ORDER BY created_at ASC` and recomputes each
 * hash from its predecessor, so two rows sharing a millisecond timestamp can
 * reorder and break verification. This per-process clock never repeats or goes
 * backwards (a backwards system clock is nudged +1ms past the last issued
 * value). Cross-process/cross-device ties remain possible — the writer with
 * the newer rowid wins chain continuation (documented residual gap).
 */
let lastCreatedAtIso = "";
export function nextCreatedAtIso(): string {
  const iso = new Date().toISOString();
  const next =
    lastCreatedAtIso && iso <= lastCreatedAtIso
      ? new Date(Date.parse(lastCreatedAtIso) + 1).toISOString()
      : iso;
  lastCreatedAtIso = next;
  return next;
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
  const now = nextCreatedAtIso();
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
      const payload = buildEntryPayload({
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
          invoiceId: input.invoiceId ?? null,
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
          // Dialect parity (feesDialectParity.test.ts): the libsql writer sets
          // `updated_at` explicitly because it is NOT NULL, and the generated
          // Prisma client only auto-fills `@updatedAt` on its own surface. Any
          // other ORM implementation of the model surface (the web shim, the
          // gateway's orm) would leave the column unset and abort the INSERT.
          updatedAt: new Date(now),
        },
      });

      // 4b. Sync balance to Student, scoped by tenant and proved by row count.
      // The libsql dialect does exactly this (`ledgerSql.ts` step 4b, including
      // the `updated_at` stamp): a 0-row write means the student does not exist
      // for THIS tenant and must abort — otherwise a mismatched (tenant,
      // student) pair would silently clobber another tutor's balance (F5,
      // defence-in-depth P-DM1). The stamp also advances the CAS base that
      // `updateStudentAction` compares against (RFC-004 C4).
      const balanceWrite = await tx.student.updateMany({
        where: { id: input.studentId, tenantId: input.tenantId },
        data: { balancePaise: newBalance, updatedAt: new Date(now) },
      });
      if (balanceWrite.count === 0) {
        throw new Error(
          `STUDENT_NOT_FOUND: no student ${input.studentId} in tenant ${input.tenantId}`,
        );
      }

      // 4c. Rule 7 / BR-SYN-01: the derived student balance is a local write
      // too — queue its replication row in the same transaction (both dialects:
      // ledgerSql.ts posts the identical row). Payload shape is the canonical
      // snake_case envelope (`encodeOutboxPayload` above — P3-11).
      await tx.syncOutbox.create({
        data: {
          id: randomUUID(),
          tenantId: input.tenantId,
          tableName: "students",
          rowId: input.studentId,
          op: "update",
          payload: encodeOutboxPayload("students", "update", {
            id: input.studentId,
            balancePaise: newBalance,
          }).payload,
          status: "pending",
          createdAt: new Date(now),
        },
      });

      // 5. Append to sync_outbox (canonical snake_case envelope — P3-11: the
      // Prisma dialect previously emitted the camelCase model while the libsql
      // dialect emitted snake_case columns for this same table).
      const outboxId = randomUUID();
      await tx.syncOutbox.create({
        data: {
          id: outboxId,
          tenantId: input.tenantId,
          tableName: "ledger_entries",
          rowId: entryId,
          op: "insert",
          payload: encodeOutboxPayload("ledger_entries", "insert", { ...newEntry }).payload,
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
    return await db.$transaction(async (tx: any) => {
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

      return { ok: true, value: (postResult as any).value } as Result<string>;
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
    // P3-12: `created_at` is millisecond ISO — two rows written in the same
    // transaction routinely share it, and a tie would let SQLite/Prisma return
    // them in any order, replaying the hash chain out of sequence and reporting
    // a false `Balance mismatch`. `id` is UUIDv7 (AGENTS.md §3.4), whose
    // lexicographic order is creation order, so it is a total, stable tie-break.
    const entries = await db.ledgerEntry.findMany({
      where: { tenantId, studentId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
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

      const payload = buildEntryPayload({
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
