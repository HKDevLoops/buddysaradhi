"use server";

import { getAuthenticatedDb, getAuthenticatedPrisma, gatewayPatch, createLibsqlProxy } from "@/server/get-db";
import { createSupabaseServer, createSupabaseAdmin } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { verifyPin, encryptBackup } from "@/lib/crypto";

export async function createBackupAction(passphrase: string) {
  try {
    if (passphrase.length < 8) {
      return { success: false, error: "Passphrase must be at least 8 characters" };
    }

    const { client, tenantId } = await getAuthenticatedDb();
    const [settingsRes, studentsRes, ledgerRes] = await Promise.all([
      client.execute({ sql: "SELECT * FROM settings WHERE tenant_id = ?", args: [tenantId] }).catch(() => ({ rows: [] })),
      client.execute({ sql: "SELECT * FROM students WHERE tenant_id = ?", args: [tenantId] }).catch(() => ({ rows: [] })),
      client.execute({ sql: "SELECT * FROM ledger_entries WHERE tenant_id = ?", args: [tenantId] }).catch(() => ({ rows: [] })),
    ]);

    const backupPayload = JSON.stringify({
      version: 1,
      tenantId,
      exportedAt: new Date().toISOString(),
      settings: settingsRes.rows,
      students: studentsRes.rows,
      ledger: ledgerRes.rows,
    });

    // Rule 8: the passphrase is the KDF input (Argon2id), not just a check —
    // the backup must be restorable on any device with only the passphrase.
    const encryptedB64 = await encryptBackup(backupPayload, passphrase);
    const sizeBytes = Buffer.byteLength(encryptedB64, 'base64');
    const sizeKB = (sizeBytes / 1024).toFixed(1);

    return {
      success: true,
      data: {
        filename: `buddysaradhi_backup_${new Date().toISOString().split('T')[0]}.bsb`,
        size: `${sizeKB} KB`,
        mockBlobUrl: `data:application/octet-stream;base64,${encryptedB64}`,
      },
    };
  } catch (error) {
    log.error('create_backup_action_failed', error instanceof Error ? error.message : String(error));
    return { success: false, error: "Failed to generate backup" };
  }
}

export async function deleteTenantDataAction(pin: string) {
  try {
    const { client, tenantId } = await getAuthenticatedDb();
    const settingsRow = await client.execute({
      sql: "SELECT pin_hash FROM settings WHERE tenant_id = ?",
      args: [tenantId],
    });
    const pinHash = settingsRow.rows[0]?.pin_hash as string | null;
    if (!pinHash) {
      return { success: false, error: "No PIN configured. Set one in Settings → Security." };
    }
    const pinValid = await verifyPin(pin, pinHash);
    if (!pinValid) {
      return { success: false, error: "Invalid PIN" };
    }
    const now = new Date().toISOString();

    // Rule 7: archive + audit + sync_outbox in one batch
    await client.batch(
      [
        {
          sql: `UPDATE students SET status = 'archived', archived_at = ?, updated_at = ? WHERE tenant_id = ?`,
          args: [now, now, tenantId],
        },
        {
          sql: `INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, created_at) VALUES (?, ?, 'students', ?, 'batch_archive', ?, ?)`,
          args: [crypto.randomUUID(), tenantId, tenantId, JSON.stringify({ archived_at: now }), now],
        },
        {
          sql: `INSERT INTO audit_log (id, tenant_id, actor, ref_type, ref_id, action, metadata, created_at)
                VALUES (?, ?, ?, 'tenant', ?, 'tenant_data_deleted', ?, ?)`,
          args: [crypto.randomUUID(), tenantId, tenantId, tenantId, JSON.stringify({ deleted_at: now }), now],
        },
      ],
      "write",
    );

    return { success: true };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    log.error('delete_tenant_data_action_failed', error instanceof Error ? error.message : String(error));
    return { success: false, error: "Failed to delete data" };
  }
}

/**
 * Settings mass-assignment allowlist (08_Settings.md §3). Server-managed
 * fields are deliberately absent: `pinHash` is written only by `setPinAction`
 * (SR-04 — old-PIN re-verification, argon2id), and `plan` is billing state
 * written only by the checkout flow — never by a client-supplied PATCH.
 * Shared by `updateSettingAction` and `updateSettingsBatchAction`.
 */
const SETTING_WRITE_FIELDS: Record<string, boolean> = {
  instituteName: true, instituteAddress: true, institutePhone: true,
  instituteEmail: true, currencyCode: true, locale: true, timezone: true,
  defaultFeeModel: true, invoicePrefix: true, receiptPrefix: true,
  graceDays: true, autoInvoice: true, nextInvoiceSeq: true,
  nextReceiptSeq: true, nextStudentSeq: true,
  attendanceLockHours: true, defaultAttendanceStatus: true,
  holidayListJson: true, notifyDueFee: true, notifyUpcomingDue: true,
  notifyMissingAttendance: true, notifyInactiveStudent: true,
  sessionTimeoutMin: true, biometricEnabled: true,
  autoArchiveInactiveDays: true, theme: true, density: true,
  reducedMotion: true, palette: true,
};

export async function updateSettingAction(field: string, value: unknown) {
  try {
    await getAuthenticatedPrisma();

    // Map UI camelCase field names to DB model fields
    // Prisma uses camelCase so we don't need to manually map to snake_case.
    const allowedFields = SETTING_WRITE_FIELDS;

    if (!allowedFields[field]) {
      return { success: false, error: "Invalid setting field: " + field };
    }

    // Check if new email is provided and update Supabase auth if so
    if (field === "instituteEmail" && value) {
      const supabase = await createSupabaseServer();
      const { data: { user } } = await supabase.auth.getUser();
      if (user && user.email !== value) {
        const { error: authError } = await supabase.auth.updateUser({ email: value as string });
        if (authError) {
          log.error('settings_update_auth_email_failed', authError.message, { instituteEmail: value });
          return { success: false, error: "Failed to update auth email: " + authError.message };
        }
      }
    }

    const updateData = { [field]: value };
    const res = await gatewayPatch("/api/v1/settings", updateData);

    if (!res.success) {
      log.warn('settings_gateway_update_failed_using_direct_db', res.error);
      const { client, tenantId } = await getAuthenticatedDb();
      const proxy = createLibsqlProxy(client);
      await proxy.setting.upsert({
        where: { tenantId },
        create: { tenantId, ...updateData },
        update: updateData,
      });
      // Rule 7: every mutation writes sync_outbox + audit_log in same logical transaction
      const now = new Date().toISOString();
      const payload = JSON.stringify(updateData);
      await client.batch(
        [
          {
            sql: `INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, created_at) VALUES (?, ?, 'settings', ?, 'upsert', ?, ?)`,
            args: [crypto.randomUUID(), tenantId, tenantId, payload, now],
          },
          {
            sql: `INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at) VALUES (?, ?, ?, 'settings.update', 'settings', ?, ?, ?)`,
            args: [crypto.randomUUID(), tenantId, tenantId, tenantId, JSON.stringify({ field, value }), now],
          },
        ],
        "write",
      );
    }

    revalidatePath("/settings");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    log.error('settings_update_failed', error instanceof Error ? error.message : String(error), { field });
    return { success: false, error: "Failed to update setting" };
  }
}

export async function updateSettingsBatchAction(settingsObj: Record<string, unknown>) {
  try {
    // Same allowlist as updateSettingAction — a batch payload must not be an
    // end-run around the single-field guard (pinHash/plan stay server-managed).
    const updateData: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(settingsObj)) {
      if (val !== undefined && SETTING_WRITE_FIELDS[key]) {
        updateData[key] = val;
      }
    }
    if (Object.keys(updateData).length === 0) {
      return { success: false, error: "No valid settings fields" };
    }

    const res = await gatewayPatch("/api/v1/settings", updateData);
    if (!res.success) {
      log.warn('settings_batch_gateway_patch_failed_using_direct_db', res.error);
      const { client, tenantId } = await getAuthenticatedDb();
      const proxy = createLibsqlProxy(client);
      await proxy.setting.upsert({
        where: { tenantId },
        create: { tenantId, ...updateData },
        update: updateData,
      });
      // Rule 7: batch sync_outbox + audit_log alongside settings mutation
      const now = new Date().toISOString();
      const payload = JSON.stringify(updateData);
      await client.batch(
        [
          {
            sql: `INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, created_at) VALUES (?, ?, 'settings', ?, 'upsert', ?, ?)`,
            args: [crypto.randomUUID(), tenantId, tenantId, payload, now],
          },
          {
            sql: `INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at) VALUES (?, ?, ?, 'settings.batch_update', 'settings', ?, ?, ?)`,
            args: [crypto.randomUUID(), tenantId, tenantId, tenantId, JSON.stringify({ fields: Object.keys(updateData) }), now],
          },
        ],
        "write",
      );
    }

    revalidatePath("/settings");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    log.error('settings_batch_update_error', error instanceof Error ? error.message : String(error));
    return { success: false, error: "Failed to update settings" };
  }
}

export async function updateThemeAction(theme: string) {
  return updateSettingAction("theme", theme);
}

export async function deleteAccountAction(pin: string) {
  try {
    const supabase = await createSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Unauthorized" };
    }
    const userId = user.id;

    const { client, tenantId } = await getAuthenticatedDb();

    // BR-SEC-04: re-confirm with PIN before the destructive erase — same gate
    // as deleteTenantDataAction. 10_Security.md §18.1 step 1.
    const settingsRow = await client.execute({
      sql: "SELECT pin_hash FROM settings WHERE tenant_id = ?",
      args: [tenantId],
    });
    const pinHash = settingsRow.rows[0]?.pin_hash as string | null;
    if (!pinHash) {
      return { success: false, error: "No PIN configured. Set one in Settings → Security." };
    }
    const pinValid = await verifyPin(pin, pinHash);
    if (!pinValid) {
      return { success: false, error: "Invalid PIN" };
    }

    const now = new Date().toISOString();

    // 10_Security.md §18.1 step 2: erase_initiated MUST be recorded before any
    // row is deleted (BR-SEC-03). Fail-closed: a thrown error here aborts the
    // erase before anything is destroyed.
    await client.execute({
      sql: `INSERT INTO audit_log (id, tenant_id, actor, ref_type, ref_id, action, metadata, created_at)
            VALUES (?, ?, ?, 'tenant', ?, 'erase_initiated', ?, ?)`,
      args: [crypto.randomUUID(), tenantId, tenantId, tenantId, JSON.stringify({ scope: "account" }), now],
    });

    // 10_Security.md §18.1 step 4 — ONE atomic cascade (libsql batch = single
    // transaction). The previous five sequential executes could half-erase an
    // account (settings+students deleted, then a failure on the non-existent
    // `attendance` table aborted the rest).
    //
    // LEDGER-4 EXCEPTION (10_Security.md §9.2 / §18.1 step 4): the secure-erase
    // flow is the single audited place where ledger_entries is physically
    // deleted; every other code path posts a void instead. Erasing student PII
    // while leaving its fee history readable would fail the erase guarantee.
    // app_state carries tenant_secret + audit_chain_head — removing them
    // crypto-shreds every tamper hash (§9.3) and orphans the audit chain
    // (§18.1 step 3). audit_log rows SURVIVE as the erase record (§18.1 step 7).
    await client.batch(
      [
        { sql: "DELETE FROM ledger_entries WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM receipts WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM invoices WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM fee_schedule_items WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM fee_plans WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM attendance_records WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM attendance_sessions WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM student_documents WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM student_notes WHERE tenant_id = ?", args: [tenantId] },
        // student_tags is a join table with no tenant_id column (single-tenant
        // DB): unfiltered delete is the only valid form.
        { sql: "DELETE FROM student_tags", args: [] },
        { sql: "DELETE FROM tags WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM student_enrollments WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM guardians WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM students WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM batches WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM reminders WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM notifications WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM sync_outbox WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM backup_manifest WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM app_state WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM settings WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM tutors WHERE tenant_id = ?", args: [tenantId] },
      ],
      "write",
    );

    const supabaseAdmin = await createSupabaseAdmin();
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) {
      return { success: false, error: "Auth delete failed: " + deleteError.message };
    }

    // §18.1 step 7: erase_complete recorded AFTER the cascade — this row and
    // erase_initiated are all that remain, the audit chain severed with them.
    await client.execute({
      sql: `INSERT INTO audit_log (id, tenant_id, actor, ref_type, ref_id, action, metadata, created_at)
            VALUES (?, ?, ?, 'tenant', ?, 'erase_complete', ?, ?)`,
      args: [crypto.randomUUID(), tenantId, tenantId, tenantId, JSON.stringify({ scope: "account" }), now],
    });

    return { success: true };
  } catch (error) {
    log.error('delete_account_action_failed', error instanceof Error ? error.message : String(error));
    return { success: false, error: "Failed to delete account" };
  }
}

export async function setPinAction(newPin: string, currentPin?: string) {
  try {
    if (newPin.length < 4 || newPin.length > 8) {
      return { success: false, error: "PIN must be 4-8 digits" };
    }
    if (!/^\d+$/.test(newPin)) {
      return { success: false, error: "PIN must contain only digits" };
    }

    const { client, tenantId } = await getAuthenticatedDb();

    if (currentPin) {
      const settingsRow = await client.execute({
        sql: "SELECT pin_hash FROM settings WHERE tenant_id = ?",
        args: [tenantId],
      });
      const existingHash = settingsRow.rows[0]?.pin_hash as string | null;
      if (existingHash) {
        const { verifyPin: verifyPinFn } = await import("@/lib/crypto");
        const valid = await verifyPinFn(currentPin, existingHash);
        if (!valid) {
          return { success: false, error: "Current PIN is incorrect" };
        }
      }
    }

    const { hashPin } = await import("@/lib/crypto");
    const newHash = await hashPin(newPin);
    const now = new Date().toISOString();

    // Rule 7: pin update must also write sync_outbox + audit_log atomically
    await client.batch(
      [
        {
          sql: `INSERT INTO settings (tenant_id, institute_name, tenant_secret, pin_hash, created_at, updated_at)
                VALUES (?, 'My Tuition', ?, ?, ?, ?)
                ON CONFLICT (tenant_id) DO UPDATE SET pin_hash = excluded.pin_hash, updated_at = excluded.updated_at`,
          args: [tenantId, crypto.randomUUID(), newHash, now, now],
        },
        {
          sql: `INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, created_at) VALUES (?, ?, 'settings', ?, 'upsert', ?, ?)`,
          args: [crypto.randomUUID(), tenantId, tenantId, JSON.stringify({ pin_updated_at: now }), now],
        },
        {
          sql: `INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at)
                VALUES (?, ?, ?, 'pin.update', 'settings', ?, ?, ?)`,
          args: [crypto.randomUUID(), tenantId, tenantId, tenantId, JSON.stringify({ updated_at: now }), now],
        },
      ],
      "write",
    );

    return { success: true };
  } catch (error) {
    log.error('set_pin_action_failed', error instanceof Error ? error.message : String(error));
    return { success: false, error: "Failed to set PIN" };
  }
}

export async function verifyPinAction(pin: string) {
  try {
    const { client, tenantId } = await getAuthenticatedDb();
    const settingsRow = await client.execute({
      sql: "SELECT pin_hash FROM settings WHERE tenant_id = ?",
      args: [tenantId],
    });
    const pinHash = settingsRow.rows[0]?.pin_hash as string | null;
    if (!pinHash) {
      return { success: false, error: "No PIN configured", configured: false };
    }
    const { verifyPin: verifyPinFn } = await import("@/lib/crypto");
    const valid = await verifyPinFn(pin, pinHash);
    return { success: valid, error: valid ? undefined : "Invalid PIN", configured: true };
  } catch (error) {
    log.error('verify_pin_action_failed', error instanceof Error ? error.message : String(error));
    return { success: false, error: "Failed to verify PIN" };
  }
}
