"use server";

import { getAuthenticatedDb, getAuthenticatedPrisma, gatewayPatch } from "@/server/get-db";
import { createSupabaseServer } from "@/lib/supabase/server";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";

export async function createBackupAction(passphrase: string) {
  try {
    if (passphrase.length < 8) {
      return { success: false, error: "Passphrase must be at least 8 characters" };
    }

    await new Promise(r => setTimeout(r, 1500));

    const mockEnvelope = `[AES-256-GCM-BACKUP-BLOB-${Date.now()}]`;

    return {
      success: true,
      data: {
        filename: `buddysaradhi_backup_${new Date().toISOString().split('T')[0]}.bsb`,
        size: "2.1 MB",
        mockBlobUrl: `data:application/octet-stream;base64,${Buffer.from(mockEnvelope).toString('base64')}`,
      },
    };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    return { success: false, error: "Failed to generate backup" };
  }
}

export async function deleteTenantDataAction(pin: string) {
  try {
    if (pin !== "1234") {
      return { success: false, error: "Invalid PIN" };
    }

    const { client, tenantId } = await getAuthenticatedDb();
    const now = new Date().toISOString();

    await client.execute({
      sql: `UPDATE students SET status = 'archived', archived_at = ?, updated_at = ? WHERE tenant_id = ?`,
      args: [now, now, tenantId],
    });

    await client.execute({
      sql: `INSERT INTO audit_log (id, tenant_id, actor, ref_type, ref_id, action, metadata, created_at)
            VALUES (?, ?, ?, 'tenant', ?, 'tenant_data_deleted', ?, ?)`,
      args: [randomUUID(), tenantId, tenantId, tenantId, JSON.stringify({ deleted_at: now }), now],
    });

    return { success: true };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    return { success: false, error: "Failed to delete data" };
  }
}

export async function updateSettingAction(field: string, value: unknown) {
  try {
    await getAuthenticatedPrisma();

    // Map UI camelCase field names to DB model fields
    // Prisma uses camelCase so we don't need to manually map to snake_case.
    const allowedFields: Record<string, boolean> = {
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
      reducedMotion: true, palette: true, plan: true,
    };
    
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
      log.error('settings_gateway_update_failed', res.error, { field });
      return { success: false, error: res.error };
    }

    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    log.error('settings_update_failed', error instanceof Error ? error.message : String(error), { field });
    return { success: false, error: "Failed to update setting" };
  }
}

export async function updateThemeAction(theme: string) {
  return updateSettingAction("theme", theme);
}
