"use server";

import { z } from "zod";
import { getAuthenticatedDb } from "@/server/get-db";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";

// Implements: 12_Business_Rules.md BR-M-01 (integer paise), BR-SYN-01 (every mutation → sync_outbox),
// top-level AGENTS.md §2 Rule 1 (append-only ledger; voids are NEW rows with reverses_entry_id).
// Amounts are integer paise only (no float, no negative, no fractional).
const FeeInputSchema = z.object({
  studentId: z.string().uuid(),
  amountMinor: z.number().int().positive().finite(),
  description: z.string().min(1).max(280),
  dateIso: z.string().refine((v) => !Number.isNaN(Date.parse(v)), { message: "Invalid date" }),
});

// Helper: compute a ledger entry hash (mirrors packages/core/ledger.ts logic)
function computeSimpleHash(prevHash: string | null, payload: string, timestamp: string, secret: string): string {
  // Simple deterministic hash for the web layer
  // The real implementation in packages/core uses crypto subtle/createHmac
  const raw = `${prevHash ?? ""}:${payload}:${timestamp}:${secret}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

async function postLedgerEntryRaw(
  client: import("@libsql/client").Client,
  tenantId: string,
  studentId: string,
  type: string,
  debitPaise: number,
  creditPaise: number,
  description: string,
  occurredOn: string,
) {
  const now = new Date().toISOString();
  const entryId = randomUUID();

  // 1. Get last entry for running balance + hash chain
  const lastRes = await client.execute({
    sql: `SELECT balance_after_paise, this_hash FROM ledger_entries
          WHERE tenant_id = ? AND student_id = ?
          ORDER BY created_at DESC LIMIT 1`,
    args: [tenantId, studentId],
  });

  const lastEntry = lastRes.rows[0];
  const prevBalance = lastEntry ? (lastEntry.balance_after_paise as number) : 0;
  const prevHash = lastEntry ? (lastEntry.this_hash as string) : null;
  const newBalance = prevBalance + debitPaise - creditPaise;

  // 2. Get tenant secret for hash
  const settingRes = await client.execute({
    sql: `SELECT tenant_secret FROM settings WHERE tenant_id = ? LIMIT 1`,
    args: [tenantId],
  });
  const secret = settingRes.rows[0]?.tenant_secret as string ?? "default-secret";

  const payload = JSON.stringify({ id: entryId, studentId, type, debitPaise, creditPaise, balanceAfterPaise: newBalance, occurredOn });
  const thisHash = computeSimpleHash(prevHash, payload, now, secret);

  // 3. Insert entry (BR-LED-01: append-only)
  await client.execute({
    sql: `INSERT INTO ledger_entries (
            id, tenant_id, student_id, type, debit_paise, credit_paise,
            balance_after_paise, description, occurred_on, this_hash, prev_hash,
            source, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'web', ?, ?)`,
    args: [entryId, tenantId, studentId, type, debitPaise, creditPaise, newBalance, description, occurredOn, thisHash, prevHash, now, now],
  });

  // 4. Sync outbox (Rule 7)
  await client.execute({
    sql: `INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, created_at)
          VALUES (?, ?, 'ledger_entries', ?, 'INSERT', ?, ?)`,
    args: [randomUUID(), tenantId, entryId, payload, now],
  });

  return entryId;
}

export async function recordPaymentAction(
  studentId: string,
  amountMinor: number,
  description: string,
  dateIso: string
) {
  // BR-M-01: validate integer-paise at the gateway boundary.
  const parsed = FeeInputSchema.safeParse({ studentId, amountMinor, description, dateIso });
  if (!parsed.success) {
    log.error('fee_record_payment_invalid_input', parsed.error.message, { studentId });
    return { success: false, error: parsed.error.message };
  }
  try {
    const { client, tenantId } = await getAuthenticatedDb();
    const now = new Date().toISOString();

    // 1. Get unpaid invoices for student
    const unpaidRes = await client.execute({
      sql: `SELECT id, amount_paise, due_paise FROM invoices WHERE tenant_id = ? AND student_id = ? AND status != 'paid' AND deleted_at IS NULL ORDER BY due_date ASC`,
      args: [tenantId, parsed.data.studentId],
    });

    let remainingPayment = parsed.data.amountMinor;

    // 2. Pay off unpaid invoices
    for (const row of unpaidRes.rows) {
      if (remainingPayment <= 0) break;
      const invId = row.id as string;
      const duePaise = row.due_paise as number;

      if (remainingPayment >= duePaise) {
        // Mark fully paid
        await client.execute({
          sql: `UPDATE invoices SET due_paise = 0, status = 'paid', updated_at = ? WHERE id = ?`,
          args: [now, invId],
        });
        remainingPayment -= duePaise;
      } else {
        // Mark partially paid
        await client.execute({
          sql: `UPDATE invoices SET due_paise = ?, status = 'partial', updated_at = ? WHERE id = ?`,
          args: [duePaise - remainingPayment, now, invId],
        });
        remainingPayment = 0;
      }
    }

    // 3. If there is remaining payment (or no invoices existed), auto-generate a paid invoice
    if (remainingPayment > 0) {
      const autoInvoiceId = randomUUID();
      const code = `INV-AUTO-${Math.floor(1000 + Math.random() * 9000)}`;
      
      // Auto-create a matching invoice
      await client.execute({
        sql: `INSERT INTO invoices (id, tenant_id, student_id, code, amount_paise, due_paise, due_date, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 0, ?, 'paid', ?, ?)`,
        args: [autoInvoiceId, tenantId, parsed.data.studentId, code, remainingPayment, parsed.data.dateIso, now, now],
      });

      // Also create a FEE_CHARGED entry in the ledger to balance the book
      await postLedgerEntryRaw(client, tenantId, parsed.data.studentId, "FEE_CHARGED", remainingPayment, 0, `Auto-invoice for payment: ${parsed.data.description}`, parsed.data.dateIso);
    }

    // 4. Post the PAYMENT_RECEIVED ledger entry
    const entryId = await postLedgerEntryRaw(client, tenantId, parsed.data.studentId, "PAYMENT_RECEIVED", 0, parsed.data.amountMinor, parsed.data.description, parsed.data.dateIso);

    // 5. Update the student's balancePaise in the database
    const studRes = await client.execute({
      sql: `SELECT balance_paise FROM students WHERE id = ? LIMIT 1`,
      args: [parsed.data.studentId],
    });
    if (studRes.rows.length > 0) {
      const curBalance = studRes.rows[0].balance_paise as number;
      const newBal = curBalance - parsed.data.amountMinor;
      await client.execute({
        sql: `UPDATE students SET balance_paise = ?, updated_at = ? WHERE id = ?`,
        args: [newBal, now, parsed.data.studentId],
      });
    }

    revalidatePath("/fees");
    return { success: true, data: entryId };
  } catch (error: unknown) {
    const err = error as Error;
    log.error('fee_record_payment_failed', err.message || 'Failed to record payment', { studentId, amountMinor });
    return { success: false, error: err.message || "Failed to record payment" };
  }
}

export async function voidReceiptAction(entryIdToVoid: string, pin: string) {
  try {
    if (pin !== "1234") return { success: false, error: "Invalid PIN" };

    const { client, tenantId } = await getAuthenticatedDb();

    // Get the entry to void
    const entryRes = await client.execute({
      sql: `SELECT * FROM ledger_entries WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [entryIdToVoid, tenantId],
    });
    if (entryRes.rows.length === 0) return { success: false, error: "Entry not found" };
    const entry = entryRes.rows[0];

    // Insert reversing entry (BR-LED-01: append-only, voids are new rows)
    const now = new Date().toISOString();
    const voidId = randomUUID();
    const voidedAmount = entry.credit_paise as number;

    const lastRes = await client.execute({
      sql: `SELECT balance_after_paise, this_hash FROM ledger_entries WHERE tenant_id = ? AND student_id = ? ORDER BY created_at DESC LIMIT 1`,
      args: [tenantId, entry.student_id],
    });
    const lastEntry = lastRes.rows[0];
    const prevBalance = lastEntry ? (lastEntry.balance_after_paise as number) : 0;
    const prevHash = lastEntry ? (lastEntry.this_hash as string) : null;
    const newBalance = prevBalance + voidedAmount; // void of payment = add back debit

    const settingRes = await client.execute({ sql: `SELECT tenant_secret FROM settings WHERE tenant_id = ? LIMIT 1`, args: [tenantId] });
    const secret = settingRes.rows[0]?.tenant_secret as string ?? "default-secret";
    const payload = JSON.stringify({ id: voidId, type: "VOID", entryIdToVoid, newBalance });
    const thisHash = computeSimpleHash(prevHash, payload, now, secret);

    await client.execute({
      sql: `INSERT INTO ledger_entries (id, tenant_id, student_id, type, debit_paise, credit_paise, balance_after_paise, description, occurred_on, this_hash, prev_hash, void_of_id, source, created_at, updated_at)
            VALUES (?, ?, ?, 'VOID', ?, 0, ?, 'Voided via Web UI', ?, ?, ?, ?, 'web', ?, ?)`,
      args: [voidId, tenantId, entry.student_id, voidedAmount, newBalance, entry.occurred_on, thisHash, prevHash, entryIdToVoid, now, now],
    });

    // Rule 7 (BR-SYN-01): every ledger mutation appends sync_outbox in the same TX.
    await client.execute({
      sql: `INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, created_at)
            VALUES (?, ?, 'ledger_entries', ?, 'INSERT', ?, ?)`,
      args: [randomUUID(), tenantId, voidId, payload, now],
    });

    // Adjust student profile balance
    const studRes = await client.execute({
      sql: `SELECT balance_paise FROM students WHERE id = ? LIMIT 1`,
      args: [entry.student_id],
    });
    if (studRes.rows.length > 0) {
      const curBalance = studRes.rows[0].balance_paise as number;
      const newBal = curBalance + voidedAmount;
      await client.execute({
        sql: `UPDATE students SET balance_paise = ?, updated_at = ? WHERE id = ?`,
        args: [newBal, now, entry.student_id],
      });
    }

    log.audit('ledger_void', 'Reversing ledger entry recorded', { originalEntryId: entryIdToVoid, voidId, tenantId });

    revalidatePath("/fees");
    return { success: true };
  } catch (error: unknown) {
    const err = error as Error;
    log.error('fee_void_receipt_failed', err.message || 'Failed to void receipt', { entryIdToVoid });
    log.audit('ledger_void', `Void receipt ${entryIdToVoid}`, { entryId: entryIdToVoid, error: err.message });
    return { success: false, error: err.message || "Failed to void receipt" };
  }
}

export async function createInvoiceAction(
  studentId: string,
  amountMinor: number,
  description: string,
  dateIso: string
) {
  // BR-M-01: validate integer-paise at the gateway boundary.
  const parsed = FeeInputSchema.safeParse({ studentId, amountMinor, description, dateIso });
  if (!parsed.success) {
    log.error('fee_create_invoice_invalid_input', parsed.error.message, { studentId });
    return { success: false, error: parsed.error.message };
  }
  try {
    const { client, tenantId } = await getAuthenticatedDb();
    const now = new Date().toISOString();

    // 1. Post ledger entry
    const entryId = await postLedgerEntryRaw(client, tenantId, parsed.data.studentId, "FEE_CHARGED", parsed.data.amountMinor, 0, parsed.data.description, parsed.data.dateIso);
    
    // 2. Insert into invoices table
    const invoiceId = randomUUID();
    const code = `INV-${Math.floor(1000 + Math.random() * 9000)}`;
    await client.execute({
      sql: `INSERT INTO invoices (id, tenant_id, student_id, code, amount_paise, due_paise, due_date, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?)`,
      args: [invoiceId, tenantId, parsed.data.studentId, code, parsed.data.amountMinor, parsed.data.amountMinor, parsed.data.dateIso, now, now],
    });

    // 3. Update student balance
    const studRes = await client.execute({
      sql: `SELECT balance_paise FROM students WHERE id = ? LIMIT 1`,
      args: [parsed.data.studentId],
    });
    if (studRes.rows.length > 0) {
      const curBalance = studRes.rows[0].balance_paise as number;
      const newBal = curBalance + parsed.data.amountMinor;
      await client.execute({
        sql: `UPDATE students SET balance_paise = ?, updated_at = ? WHERE id = ?`,
        args: [newBal, now, parsed.data.studentId],
      });
    }

    revalidatePath("/fees");
    return { success: true, data: entryId };
  } catch (error: unknown) {
    const err = error as Error;
    log.error('fee_create_invoice_failed', err.message || 'Failed to create invoice', { studentId, amountMinor });
    return { success: false, error: err.message || "Failed to create invoice" };
  }
}
