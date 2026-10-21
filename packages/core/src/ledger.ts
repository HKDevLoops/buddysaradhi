// Verification audit: Core logic check
import type { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID, createHash } from "crypto";
import { z } from "zod";
import { paiseAdd, paiseSub } from "./money";
import { chunkIds } from "./sqlVars";

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
 * `reconcileLedger` walks the chain's LINKS (BR-LED-06, amended 2026-10-21),
 * so two rows sharing a millisecond can no longer be ordered wrongly - but the
 * timestamp order and the link order are kept the SAME order so a human (and
 * a `ORDER BY created_at` query) reads the ledger in the order it was written.
 * This per-process clock never repeats or goes backwards (a backwards system
 * clock is nudged +1ms past the last issued value). Cross-process ties are
 * possible - `nextChainCreatedAtIso` is what closes them.
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
 * The chain's LOGICAL CLOCK (BR-LED-06, amended 2026-10-21).
 *
 * WHY THIS EXISTS. A student's chain is a linked list: each row's `prev_hash`
 * names its predecessor, and the reader walks those links, so the ORDER is
 * the links. But the writer's tip is found by `created_at`, and two writers
 * in two processes can mint the SAME millisecond - three writers used to
 * break that tie three different ways (the ORM dialect by whatever the
 * database returned, the libsql dialect by whatever SQLite returned, the
 * gateway by `rowid`). A reader that broke the tie by `id` then disagreed
 * with the writer about which row came first, and the reconciler reported
 * "CHAIN BROKEN" on a ledger nobody had touched.
 *
 * The fix is to make the tie IMPOSSIBLE rather than to argue about how to
 * break it: a writer gives its new row a `created_at` strictly greater than
 * the tip's, so the timestamp order and the link order are the same order
 * and the tie never arises. The bump is one millisecond - invisible to a
 * human reading the ledger, decisive to a machine ordering it.
 *
 * `tipCreatedAt` is the chain tip's timestamp; `null`/undefined means the
 * chain is empty (the genesis row), and the wall clock is then the answer.
 */
export function nextChainCreatedAtIso(
  tipCreatedAt: Date | string | null | undefined,
): string {
  const own = nextCreatedAtIso();
  if (tipCreatedAt === null || tipCreatedAt === undefined) return own;
  const tipMs =
    tipCreatedAt instanceof Date
      ? tipCreatedAt.getTime()
      : Date.parse(String(tipCreatedAt));
  if (Number.isNaN(tipMs)) return own;
  const ownMs = Date.parse(own);
  if (ownMs > tipMs) return own;
  return new Date(tipMs + 1).toISOString();
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
  const source = input.source || "manual";

  try {
    const executeLogic = async (tx: Prisma.TransactionClient) => {
      // 1. Get previous hash and current balance for the student. The tip's
      // `created_at` comes with it: the new row's timestamp is the chain's
      // logical clock (BR-LED-06, amended 2026-10-21), so it is minted AFTER
      // the tip is known and is strictly greater than the tip's.
      const lastEntry = await tx.ledgerEntry.findFirst({
        where: { tenantId: input.tenantId, studentId: input.studentId },
        orderBy: { createdAt: "desc" },
        select: { balanceAfterPaise: true, thisHash: true, createdAt: true },
      });

      let currentBalance = 0;
      let prevHash: string | null = null;

      if (lastEntry) {
        currentBalance = lastEntry.balanceAfterPaise;
        prevHash = lastEntry.thisHash;
      }

      const now = nextChainCreatedAtIso(lastEntry?.createdAt);

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

// ---------------------------------------------------------------------------
// The void path — 12_Business_Rules.md BR-LED-04 (a void is a NEW reversing
// row), BR-LED-05 (a VOID cannot be voided), BR-LED-09 (a charge that live
// payments credit cannot be voided), BR-RPT-04 (the credited sum);
// 14_Edge_Cases.md EC-F-05 (the receipt is marked voided AND the invoice
// status reverts, in the SAME transaction); 07_Fees_and_Payments.md §9.10
// steps 1-5.
//
// ONE decision, TWO dialects (AGENTS.md §3.5): the flow below IS the decision,
// and each dialect supplies only row-level I/O — the ORM one in this file,
// the libsql one in `ledgerSql.ts`. A dialect that decided differently would
// hand a tutor two sets of books.
//
// Rule 1 (append-only): a void is a NEW row. Nothing here UPDATEs or DELETEs
// a `ledger_entries` row; the receipt and the invoice are ordinary mutable
// rows, and both are written inside the void's own transaction.
// ---------------------------------------------------------------------------

/** A ledger row the void decision reads — the six fields, nothing else. */
export interface VoidableEntry {
  id: string;
  studentId: string;
  invoiceId: string | null;
  type: string;
  debitPaise: number;
  creditPaise: number;
}

/** The three invoice statuses a recompute can produce (07 §9.6 step 5). */
export type VoidInvoiceStatus = "unpaid" | "partial" | "paid";

/** The reversing row the flow asks a dialect to append. */
export interface VoidPostInput {
  tenantId: string;
  studentId: string;
  debitPaise: number;
  creditPaise: number;
  description: string;
  voidOfId: string;
  invoiceId: string | null;
  occurredOn: string;
}

/** The audit row the flow asks a dialect to write (BR-SEC-03). */
export interface VoidAuditInput {
  tenantId: string;
  actor: string;
  action: string;
  refType: string;
  refId: string;
  metadata: string;
  now: string;
}

/**
 * The narrow port the void flow needs. Every method is ONE row-level
 * operation, so no dialect can smuggle in a second opinion about the money
 * (AGENTS.md §3.5 — the same shape as `FeeTx` in `feesFlow.ts`).
 */
export interface VoidTx {
  /** The row being voided, tenant-scoped, or null. */
  findEntry(tenantId: string, entryId: string): Promise<VoidableEntry | null>;
  /** An existing VOID row that reverses this entry (BR-LED-04). */
  findReversal(tenantId: string, entryId: string): Promise<{ id: string } | null>;
  /**
   * Σ LIVE `PAYMENT_RECEIVED` credits on the invoice (BR-LED-09).
   *
   * "Live" means NOT reversed: a payment the tutor has ALREADY voided must
   * not keep blocking the charge's void, or the correction path closes on an
   * append-only ledger that has no other way back (docs/audit/AUDIT-2026-10-21.md
   * AUD-014 — "void the credits first, then the charge").
   */
  livePaymentCredits(tenantId: string, invoiceId: string): Promise<number>;
  /** Σ LIVE credits on the invoice (BR-RPT-04) — the status recompute. */
  liveCreditedForInvoice(tenantId: string, invoiceId: string): Promise<number>;
  /** The invoice's total, or null when the invoice does not exist. */
  invoiceTotal(tenantId: string, invoiceId: string): Promise<number | null>;
  /** Append the reversing row (Rule 1: INSERT only). Returns the new row's id. */
  postVoid(entry: VoidPostInput): Promise<string>;
  /**
   * Mark the receipt linked to this ledger entry voided (EC-F-05), and queue
   * its replication row (Rule 7). Returns the receipt id, or null when the
   * entry carries no live receipt.
   */
  voidReceipt(tenantId: string, ledgerEntryId: string, now: string): Promise<string | null>;
  /** Write the invoice's recomputed status and queue its replication row. */
  setInvoiceStatus(
    tenantId: string,
    invoiceId: string,
    status: VoidInvoiceStatus,
    now: string,
  ): Promise<void>;
  /** The audit row (BR-SEC-03). */
  writeAudit(args: VoidAuditInput): Promise<void>;
}

export interface VoidFlowInput {
  tenantId: string;
  entryToVoidId: string;
  reason: string;
  occurredOn: string;
  actor: string;
}

/**
 * The void, decided once. Throws a typed error on every refusal — the
 * dialect entry points catch it and turn it into `Err`, so a refusal is
 * never a silent no-op (Rule 9) and never a partial write (the refusal
 * happens BEFORE any write, and the throw rolls the transaction back).
 */
export async function voidLedgerFlow(tx: VoidTx, input: VoidFlowInput): Promise<string> {
  const { tenantId, entryToVoidId, reason, occurredOn, actor } = input;

  // 1. The row being voided. The lookup is tenant-scoped, so a tutor can
  //    never void another tenant's row.
  const original = await tx.findEntry(tenantId, entryToVoidId);
  if (!original) {
    throw new Error(`ENTRY_NOT_FOUND: ledger entry ${entryToVoidId} not found for this tenant.`);
  }

  // 2. BR-LED-05 — a VOID entry cannot itself be voided.
  if (original.type === "VOID") {
    throw new Error("Cannot void a void entry (CANNOT_VOID_A_VOID, BR-LED-05).");
  }

  // 3. BR-LED-04 — a double void is a conflict, not a second reversing row.
  //    Read INSIDE the caller's transaction, so it cannot race a concurrent
  //    void of the same entry.
  const reversal = await tx.findReversal(tenantId, entryToVoidId);
  if (reversal) {
    throw new Error(
      `ENTRY_ALREADY_VOIDED: entry ${entryToVoidId} has already been voided (by ${reversal.id}) (BR-LED-04).`,
    );
  }

  // 4. BR-LED-09 — "Voiding a FEE_CHARGED is permitted only if no
  //    PAYMENT_RECEIVED credits it."
  //
  //    What it prevents: reversing a charge that ₹4,500 of payments already
  //    settle. The reversal restores the balance (it mirrors the debit), but
  //    those credits have nothing left to credit — the invoice still reads
  //    `paid` while the credited total no longer covers its total, and the
  //    student's balance reads −₹4,500, i.e. the tutor owes the student.
  //    The ledger is append-only (Rule 1), so a void is the ONLY correction
  //    path: a refused void that slips through leaves the books permanently
  //    wrong with no further correction available.
  //
  //    EC-F-06 gives the rule's UI half: "This fee has payments against it.
  //    Void those receipts first."
  if (original.type === "FEE_CHARGED" && original.invoiceId) {
    const livePayments = await tx.livePaymentCredits(tenantId, original.invoiceId);
    if (livePayments > 0) {
      throw new Error(
        `CHARGE_HAS_CREDITS: this fee has ${livePayments} paise of live payments against it — void those receipts first, then void the fee (BR-LED-09).`,
      );
    }
  }

  const now = new Date().toISOString();

  // 5. The reversing row: a NEW ledger row, mirroring the original in the
  //    opposite direction (BR-LED-04). `invoiceId` is carried onto it so the
  //    invoice's credited total can be recomputed from the same rows the
  //    payment path sums.
  const voidEntryId = await tx.postVoid({
    tenantId,
    studentId: original.studentId,
    debitPaise: original.creditPaise,
    creditPaise: original.debitPaise,
    description: `VOID: ${reason}`,
    voidOfId: entryToVoidId,
    invoiceId: original.invoiceId ?? null,
    occurredOn,
  });

  // 6. EC-F-05 — the receipt is marked voided in the SAME transaction, so a
  //    tutor can never hand out a receipt for money they just reversed. The
  //    receipt is found by its canonical link (`receipts.ledger_entry_id`).
  const receiptId = await tx.voidReceipt(tenantId, entryToVoidId, now);

  // 7. EC-F-05 — the invoice status is recomputed from what is STILL
  //    credited, exactly as §9.6 step 5 does on the payment path. A voided
  //    payment leaves the invoice `unpaid` (nothing credited) or `partial`
  //    (something else still credited) — never `paid`.
  if (original.invoiceId) {
    const credited = await tx.liveCreditedForInvoice(tenantId, original.invoiceId);
    const total = await tx.invoiceTotal(tenantId, original.invoiceId);
    if (total !== null) {
      const status: VoidInvoiceStatus =
        credited >= total ? "paid" : credited > 0 ? "partial" : "unpaid";
      await tx.setInvoiceStatus(tenantId, original.invoiceId, status, now);
    }
  }

  // 8. The audit row (BR-SEC-03) — the void is a money-reversing operation
  //    and must be auditable forever.
  await tx.writeAudit({
    tenantId,
    actor,
    action: "ledger_void",
    refType: "ledger_entries",
    refId: entryToVoidId,
    metadata: JSON.stringify({
      reason,
      original_type: original.type,
      void_entry_id: voidEntryId,
      receipt_id: receiptId,
    }),
    now,
  });

  return voidEntryId;
}

/**
 * Σ live credits on one invoice, over the ORM surface.
 *
 * BR-RPT-04 [CRITICAL]: a credit counts only while it has NOT been reversed.
 * The original row carries no `reverses_entry_id` column, so "has been
 * reversed" is a REVERSE LOOKUP — some OTHER row carries its id in
 * `void_of_id`. The filter `void_of_id IS NULL` on the row itself reads
 * "this row is not a reversal", which a voided ORIGINAL also satisfies — so
 * it kept counting (docs/audit/AUDIT-2026-10-21.md AUD-001, the same defect
 * class this lookup exists to fix).
 *
 * `type` narrows the sum to one entry type (BR-LED-09 asks about
 * `PAYMENT_RECEIVED` credits; the invoice status asks about every credit).
 */
async function sumLiveCredits(
  tx: Prisma.TransactionClient,
  tenantId: string,
  invoiceId: string,
  type: string | null,
): Promise<number> {
  const where: Prisma.LedgerEntryWhereInput = {
    tenantId,
    invoiceId,
    voidOfId: null,
  };
  // The libsql dialect's twin statement filters `type != 'VOID'` as well as
  // `void_of_id IS NULL`. A VOID row always carries `void_of_id`, so the two
  // agree on well-formed data — but on a row that somehow does not, the
  // mirroring credit of a voided CHARGE would be counted as money received.
  // The dialects must not differ on that, so the ORM one says it too.
  if (type === null) where.type = { not: "VOID" };
  else where.type = type;
  const credits = await tx.ledgerEntry.findMany({ where });

  const reversed = new Set<string>();
  const creditIds = credits.map((c) => c.id).filter((id) => id.length > 0);
  // The `IN (...)` list is CHUNKED: SQLite's variable ceiling is 32,766 on
  // the shipped build (measured) and 999 on older ones, and exceeding it is a
  // hard error, not a truncation.
  for (const chunk of chunkIds(creditIds)) {
    const reversals = await tx.ledgerEntry.findMany({
      where: { tenantId, type: "VOID", voidOfId: { in: chunk } },
    });
    for (const r of reversals) {
      if (r.voidOfId) reversed.add(r.voidOfId);
    }
  }

  // Rule 6 / BR-M-01: every addend is a safe integer checked by `paiseAdd`,
  // so a corrupt credit can never become NaN money (EC-F-01).
  let sum = 0;
  for (const c of credits) {
    if (reversed.has(c.id)) continue;
    sum = paiseAdd(sum, c.creditPaise);
  }
  return sum;
}

/**
 * The ORM dialect of the void port. The web's own ORM surface
 * (`apps/web/src/lib/libsql-proxy.ts`) and the generated Prisma client both
 * satisfy it, which is why the void behaves the same on either.
 */
function ormVoidTx(tx: Prisma.TransactionClient): VoidTx {
  return {
    async findEntry(tenantId, entryId) {
      const row = await tx.ledgerEntry.findFirst({ where: { id: entryId, tenantId } });
      if (!row) return null;
      return {
        id: row.id,
        studentId: row.studentId,
        invoiceId: row.invoiceId ?? null,
        type: row.type,
        debitPaise: row.debitPaise,
        creditPaise: row.creditPaise,
      };
    },

    async findReversal(tenantId, entryId) {
      const row = await tx.ledgerEntry.findFirst({
        where: { tenantId, type: "VOID", voidOfId: entryId },
      });
      return row ? { id: row.id } : null;
    },

    async livePaymentCredits(tenantId, invoiceId) {
      return sumLiveCredits(tx, tenantId, invoiceId, "PAYMENT_RECEIVED");
    },

    async liveCreditedForInvoice(tenantId, invoiceId) {
      return sumLiveCredits(tx, tenantId, invoiceId, null);
    },

    async invoiceTotal(tenantId, invoiceId) {
      const row = await tx.invoice.findFirst({
        where: { tenantId, id: invoiceId },
        select: { total: true },
      });
      return row ? row.total : null;
    },

    async postVoid(entry) {
      const res = await postLedgerEntry(tx, {
        tenantId: entry.tenantId,
        studentId: entry.studentId,
        type: "VOID",
        debitPaise: entry.debitPaise,
        creditPaise: entry.creditPaise,
        description: entry.description,
        voidOfId: entry.voidOfId,
        invoiceId: entry.invoiceId,
        occurredOn: entry.occurredOn,
        source: "manual",
      });
      if (!res.ok) throw res.error;
      return res.value;
    },

    async voidReceipt(tenantId, ledgerEntryId, now) {
      const receipt = await tx.receipt.findFirst({
        where: { tenantId, ledgerEntryId, voidedAt: null },
      });
      if (!receipt) return null;
      const written = await tx.receipt.updateMany({
        where: { tenantId, id: receipt.id, voidedAt: null },
        data: { voidedAt: now, updatedAt: now },
      });
      if (written.count === 0) return null;
      // Rule 7 / BR-SYN-01 — the receipt's voided state replicates too, or a
      // reconnected replica shows a receipt as live that the ledger reversed.
      await tx.syncOutbox.create({
        data: {
          id: randomUUID(),
          tenantId,
          tableName: "receipts",
          rowId: receipt.id,
          op: "update",
          payload: encodeOutboxPayload("receipts", "update", {
            id: receipt.id,
            tenant_id: tenantId,
            voided_at: now,
            updated_at: now,
          }).payload,
          status: "pending",
          createdAt: new Date(now),
        },
      });
      return receipt.id;
    },

    async setInvoiceStatus(tenantId, invoiceId, status, now) {
      await tx.invoice.updateMany({
        where: { tenantId, id: invoiceId },
        data: { status, updatedAt: now },
      });
      await tx.syncOutbox.create({
        data: {
          id: randomUUID(),
          tenantId,
          tableName: "invoices",
          rowId: invoiceId,
          op: "update",
          payload: encodeOutboxPayload("invoices", "update", {
            id: invoiceId,
            status,
            updated_at: now,
          }).payload,
          status: "pending",
          createdAt: new Date(now),
        },
      });
    },

    async writeAudit(a) {
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          tenantId: a.tenantId,
          actor: a.actor,
          action: a.action,
          refType: a.refType,
          refId: a.refId,
          metadata: a.metadata,
          createdAt: new Date(a.now),
        },
      });
    },
  };
}

/**
 * BR-LED-04: Voiding requires a new VOID row mirroring the original
 * BR-LED-05: A VOID entry cannot itself be voided
 * BR-LED-09: A FEE_CHARGED that live payments credit cannot be voided
 * EC-F-05:  the receipt is marked voided and the invoice status reverts, in
 *           the SAME transaction as the reversing row
 *
 * The decision lives in `voidLedgerFlow`; this is the ORM dialect of it.
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
      const voidEntryId = await voidLedgerFlow(ormVoidTx(tx), {
        tenantId,
        entryToVoidId,
        reason,
        occurredOn,
        actor,
      });
      return { ok: true, value: voidEntryId } as Result<string>;
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

/**
 * The chain, walked by its LINKS (BR-LED-06, amended 2026-10-21).
 *
 * WHY NOT BY TIMESTAMP. The chain of one student is a linked list: each row's
 * `prev_hash` names its predecessor, so the LINKS are the order. Ordering by
 * `created_at` instead means inventing an order for two rows that share a
 * millisecond - and three writers invented three different ones, so a reader
 * could disagree with a writer about which row came first and report "CHAIN
 * BROKEN" on a ledger nobody had touched. The links cannot disagree: they are
 * what the writer hashed.
 *
 * A FORK - two rows claiming the same predecessor - is not an ordering
 * artefact and is not silently picked between: it is reported.
 */
interface ChainLink {
  id: string;
  prevHash: string | null;
  thisHash: string;
  studentId: string;
  type: string;
  debitPaise: number;
  creditPaise: number;
  balanceAfterPaise: number;
  occurredOn: string;
  createdAt: unknown;
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
    // ORM shim throws on an array `orderBy`); the ORDER that matters is the
    // chain's links, applied by the walk below.
    const rows = (await db.ledgerEntry.findMany({
      where: { tenantId, studentId },
      orderBy: { createdAt: "asc" },
    })) as unknown as ChainLink[];

    const setting = await db.setting.findUnique({
      where: { tenantId },
      select: { tenantSecret: true },
    });
    if (!setting) throw new Error("Tenant settings not found");

    if (rows.length === 0) return { ok: true, value: true };

    // Index the chain by the link each row claims.
    const successors = new Map<string, ChainLink[]>();
    const roots: ChainLink[] = [];
    for (const row of rows) {
      if (row.prevHash === null || row.prevHash === undefined) {
        roots.push(row);
        continue;
      }
      const list = successors.get(row.prevHash);
      if (list) list.push(row);
      else successors.set(row.prevHash, [row]);
    }

    if (roots.length === 0) {
      return {
        ok: false,
        error: new Error(
          `Chain broken: no genesis row. All ${rows.length} rows of student ${studentId} claim a predecessor that is not in this chain.`,
        ),
      };
    }
    if (roots.length > 1) {
      return {
        ok: false,
        error: new Error(
          `Chain fork: ${roots.length} rows of student ${studentId} claim to be the first row of the chain.`,
        ),
      };
    }

    let runningBalance = 0;
    let prevHash: string | null = null;
    const visited = new Set<string>();
    let current: ChainLink | undefined = roots[0];

    while (current) {
      if (visited.has(current.id)) {
        return {
          ok: false,
          error: new Error(`Chain broken: the chain loops at entry ${current.id}.`),
        };
      }
      visited.add(current.id);

      runningBalance = runningBalance + current.debitPaise - current.creditPaise;

      if (runningBalance !== current.balanceAfterPaise) {
        return {
          ok: false,
          error: new Error(
            `Balance mismatch at entry ${current.id}. Expected ${runningBalance}, got ${current.balanceAfterPaise}`,
          ),
        };
      }

      const payload = buildEntryPayload({
        id: current.id,
        studentId: current.studentId,
        type: current.type,
        debitPaise: current.debitPaise,
        creditPaise: current.creditPaise,
        balanceAfterPaise: current.balanceAfterPaise,
        occurredOn: current.occurredOn,
      });

      // The row's OWN `prev_hash` is hashed, not the walked predecessor's: a
      // tampered link then fails the hash check as well as the walk.
      const expectedHash = computeHash(
        current.prevHash ?? null,
        payload,
        createdAtIso(current.createdAt),
        setting.tenantSecret,
      );
      if (expectedHash !== current.thisHash) {
        return {
          ok: false,
          error: new Error(
            `Hash mismatch at entry ${current.id}. Expected ${expectedHash}, got ${current.thisHash}`,
          ),
        };
      }

      prevHash = current.thisHash;
      const chainNext: ChainLink[] = successors.get(prevHash) ?? [];
      if (chainNext.length > 1) {
        return {
          ok: false,
          error: new Error(
            `Chain fork: ${chainNext.length} rows of student ${studentId} claim entry ${current.id} as their predecessor.`,
          ),
        };
      }
      current = chainNext[0];
    }

    if (visited.size !== rows.length) {
      return {
        ok: false,
        error: new Error(
          `Chain broken: ${rows.length - visited.size} of ${rows.length} rows of student ${studentId} are not reachable from the genesis row.`,
        ),
      };
    }

    return { ok: true, value: true };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}
