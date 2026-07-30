"use server";

import { z } from "zod";
import { getAuthenticatedDb } from "@/server/get-db";
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

// R-CRYPTO-1, R-CRYPTO-2, Rule 8. Paise integer + HMAC-SHA256 chain.
async function computeSimpleHash(prevHash: string | null, payload: string, timestamp: string, secret: string): Promise<string> {
  const raw = `${prevHash ?? ""}|${payload}|${timestamp}|${secret}`;
  
  const cryptoSubtle = typeof globalThis !== 'undefined' ? globalThis.crypto?.subtle : null;
  if (!cryptoSubtle) {
    throw new Error("Web Crypto API (crypto.subtle) is not available.");
  }

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(raw);

  const key = await cryptoSubtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await cryptoSubtle.sign(
    "HMAC",
    key,
    messageData
  );

  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
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
  const entryId = crypto.randomUUID();

  // 1. Get last entry for running balance + hash chain
  const [lastRes, settingRes] = await Promise.all([
    client.execute({
      sql: `SELECT balance_after_paise, this_hash FROM ledger_entries
            WHERE tenant_id = ? AND student_id = ?
            ORDER BY created_at DESC LIMIT 1`,
      args: [tenantId, studentId],
    }),
    client.execute({
      sql: `SELECT tenant_secret FROM settings WHERE tenant_id = ? LIMIT 1`,
      args: [tenantId],
    }),
  ]);

  const lastEntry = lastRes.rows[0];
  const prevBalance = lastEntry ? (lastEntry.balance_after_paise as number) : 0;
  const prevHash = lastEntry ? (lastEntry.this_hash as string) : null;
  const newBalance = prevBalance + debitPaise - creditPaise;
  const secret = settingRes.rows[0]?.tenant_secret as string | null;
  if (!secret) throw new Error("SECURITY_VIOLATION: tenant secret is not initialised");

  const payload = JSON.stringify({ id: entryId, studentId, type, debitPaise, creditPaise, balanceAfterPaise: newBalance, occurredOn });
  const thisHash = await computeSimpleHash(prevHash, payload, now, secret);

  // Rule 7: ledger + sync_outbox + audit_log in one batch.
  await client.batch(
    [
      {
        sql: `INSERT INTO ledger_entries (
                id, tenant_id, student_id, type, debit_paise, credit_paise,
                balance_after_paise, description, occurred_on, this_hash, prev_hash,
                source, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'web', ?, ?)`,
        args: [entryId, tenantId, studentId, type, debitPaise, creditPaise, newBalance, description, occurredOn, thisHash, prevHash, now, now],
      },
      {
        sql: `INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, created_at)
              VALUES (?, ?, 'ledger_entries', ?, 'INSERT', ?, ?)`,
        args: [crypto.randomUUID(), tenantId, entryId, payload, now],
      },
      {
        sql: `INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          crypto.randomUUID(), tenantId, tenantId,
          `ledger.${type.toLowerCase()}`,
          "student", studentId,
          JSON.stringify({ entryId, debitPaise, creditPaise, newBalance }),
          now,
        ],
      },
    ],
    "write",
  );

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
      const autoInvoiceId = crypto.randomUUID();
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record payment";
    log.error('fee_record_payment_failed', message, { studentId, amountMinor });
    return { success: false, error: message };
  }
}

export async function voidReceiptAction(entryIdToVoid: string, pin: string) {
  try {
    // Fail-closed: previous `if (pin !== "1234")` was a backdoor.
    if (!pin || !pin.trim()) {
      return { success: false, error: "PIN required to void a receipt" };
    }
    log.error('fee_void_receipt_blocked', 'PIN verification disabled; awaiting Argon2', { entryIdToVoid });
    return { success: false, error: "PIN verification disabled — contact support" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to void receipt";
    log.error('fee_void_receipt_failed', message, { entryIdToVoid });
    return { success: false, error: message };
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
    const invoiceId = crypto.randomUUID();
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create invoice";
    log.error('fee_create_invoice_failed', message, { studentId, amountMinor });
    return { success: false, error: message };
  }
}
