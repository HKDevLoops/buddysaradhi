// Verification audit: Core logic check
import type { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID, createHash } from "crypto";
import { z } from "zod";
import { paiseAdd, paiseSub } from "./money";

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
  // ── DIALECT PARITY (AGENTS.md §3.5) ─────────────────────────────────────
  // The libsql dialect (`postLedgerEntrySql` in `ledgerSql.ts`) refuses a
  // zero-amount row and an unknown entry type BEFORE it writes. This dialect
  // did not, so the SAME input produced two different books depending on
  // which platform recorded it: the gateway refused the row and the web
  // accepted it. The shipped schema's CHECK (`debit_paise + credit_paise > 0`)
  // catches the zero row at the database, but only on a database built from
  // `migrations/0001_init.sql` — the ORM dialect's own contract must not
  // depend on which schema happens to be underneath it.
  if (input.debitPaise + input.creditPaise <= 0) {
    return { ok: false, error: new Error("Amounts must be positive") };
  }
  if (!LEDGER_ENTRY_TYPES.includes(input.type)) {
    return {
      ok: false,
      error: new Error(`Invalid ledger entry type: ${input.type}`),
    };
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
      // Rule 6 / BR-M-01: the SAME paise arithmetic the libsql dialect uses
      // (`paiseSub` then `paiseAdd`), so a corrupt or overflowing balance is
      // a typed error in BOTH dialects instead of a poisoned
      // `balance_after_paise` that every later row inherits (EC-F-01).
      const newBalance = paiseAdd(
        paiseSub(currentBalance, input.creditPaise),
        input.debitPaise,
      );

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
      //
      // ── DIALECT PARITY (AGENTS.md §3.5) ───────────────────────────────────
      // The libsql dialect (`ledgerSql.ts` step 4c) writes this payload with
      // `updated_at`, and it writes it AFTER the ledger row. This dialect did
      // neither: it omitted `updated_at` and it wrote the balance row BEFORE
      // the ledger row it summarises. So the two platforms emitted
      //   libsql: {"balance_paise":1000,"id":"s1","updated_at":"..."}
      //   ORM   : {"balance_paise":2000,"id":"s1"}
      // and a replica that replays the stream IN ORDER saw the derived
      // balance arrive before the ledger row on the web path and after it on
      // the gateway path. The parity gate compares the outbox by
      // `(table_name, op)` ONLY, so neither the shape nor the order was
      // visible to it.
      const studentsPayload = encodeOutboxPayload("students", "update", {
        id: input.studentId,
        balance_paise: newBalance,
        updated_at: now,
      }).payload;

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

      // 5b. The derived-balance row AFTER the ledger row — the same order the
      // libsql dialect writes, so a replica's stream is identical whichever
      // platform recorded the entry.
      await tx.syncOutbox.create({
        data: {
          id: randomUUID(),
          tenantId: input.tenantId,
          tableName: "students",
          rowId: input.studentId,
          op: "update",
          payload: studentsPayload,
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

      // ── F-07: DOUBLE-VOID GUARD (BR-LED-04) ──────────────────────────────
      // The check above only refuses voiding something that is ALREADY a VOID.
      // It does NOT refuse voiding a payment that has already been voided:
      // `original.type` is still PAYMENT_RECEIVED on the second attempt, so the
      // guard passes and a SECOND mirroring row is posted. The books then read
      // as though the money were owed to the tutor — original credit plus two
      // debits of the same amount.
      //
      // Already known in-repo, as a test NAME with no assertion behind it:
      // apps/web/src/components/fees/void-sequence.test.ts:431 —
      //   "KNOWN P0: voiding an already-voided payment is NOT refused by
      //    voidEntry — it double-corrects"
      // Latent while nothing called it; apps/services/ledger-svc/src/index.ts
      // calls voidEntry, so it is now reachable.
      //
      // The gateway's own void route already implements both guards correctly
      // and inside the same transaction (apps/gateway/routes/ledger.ts:748
      // VOID-of-VOID, :752-758 double-void). This is that second guard, ported
      // — not re-invented. Read INSIDE the transaction opened above, so it
      // cannot race a concurrent void of the same entry: two simultaneous
      // voids would both read "not voided yet" and the guard would be useless.
      const existingVoid = await tx.ledgerEntry.findFirst({
        where: { tenantId: tenantId, voidOfId: entryToVoidId },
      });
      if (existingVoid) {
        throw new Error(
          `Entry ${entryToVoidId} has already been voided (by ${existingVoid.id}).`,
        );
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
        // ── F-07, second half: CARRY `invoiceId` ONTO THE REVERSING ROW ────
        // Every `creditedForInvoice` implementation filters over rows MATCHED
        // ON `invoice_id` (`feesFlow.ts:412`, `fees.ts:323-331`,
        // `feesPrisma.ts:346-367`), and a core-written payment DOES carry an
        // invoiceId. Voiding it without copying the link left the invoice's
        // credited total unchanged — so the invoice still read `paid` and the
        // Dashboard still counted the voided credit, while the student's
        // balance had already moved. Two panels disagreeing about the same
        // payment is worse than either being wrong alone.
        invoiceId: original.invoiceId ?? null,
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
 * The total chain order, in one place.
 *
 * BR-LED-06: the chain is walked in a deterministic order, so a hash
 * mismatch means "the row was tampered with" and never "the rows came back
 * in a different order".
 *
 * TWO FACTS force this to be a JS sort rather than a database ORDER BY:
 *   1. The web ORM shim (`apps/web/src/lib/libsql-proxy.ts`) supports only a
 *      SINGLE-key `orderBy` — `buildOrderClause` reads `Object.keys(...)[0]`.
 *      An ARRAY `orderBy` became `ORDER BY "0" ASC` and the query THREW, so
 *      `reconcileLedger` could not run at all on the surface `apps/web`
 *      actually holds.
 *   2. `created_at` is millisecond-resolution, so two rows can share it. The
 *      tie-break must therefore be applied by us, not by the driver.
 *
 * The tie-break is `id` ASC. NOTE (design gap, reported in
 * docs/audit/DYNAMIC-MONEY.md): `id` is a UUID v4 from `randomUUID()`, NOT the
 * UUID v7 the schema claims, so this tie-break is deterministic but NOT
 * creation order. The writers chain onto `ORDER BY created_at DESC` alone
 * (libsql), `ORDER BY created_at DESC, rowid DESC` (the gateway) and
 * `createdAt desc` (the ORM shim) — three different tie-breaks. On a
 * same-millisecond tie the writer and this verifier can disagree, which is a
 * FALSE "chain broken" alarm. The honest fix is a monotonic sequence column
 * owned by the two schema authorities (a §8 stop-and-ask), not another
 * tie-break heuristic.
 */
function chainOrderKey(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/**
 * `created_at` as the exact string the writer hashed. The generated Prisma
 * client hands back a `Date`; the web ORM shim hands back the raw TEXT. The
 * hash covers the ISO string, so the reader must reconstruct the SAME bytes —
 * `new Date(text).toISOString()` is byte-identical to the text the writer
 * stored (both are `toISOString()` output, millisecond precision).
 */
function createdAtIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
  }
  return String(value ?? "");
}

function sortChainEntries<T extends { createdAt: unknown; id: unknown }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const time = chainOrderKey(a.createdAt) - chainOrderKey(b.createdAt);
    if (time !== 0) return time;
    const idA = String(a.id ?? "");
    const idB = String(b.id ?? "");
    if (idA === idB) return 0;
    return idA < idB ? -1 : 1;
  });
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
    // A SINGLE-key `orderBy` so this runs on every model surface (the web
    // ORM shim throws on an array `orderBy`); the TOTAL order is applied by
    // `sortChainEntries` below.
    const entries = sortChainEntries(
      await db.ledgerEntry.findMany({
        where: { tenantId, studentId },
        orderBy: { createdAt: "asc" },
      }),
    );

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
        createdAtIso(entry.createdAt),
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
