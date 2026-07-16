import { Elysia } from "elysia";
import { db } from "./db";

const PORT = process.env.PORT || 3037;

export const app = new Elysia()
  .get("/health", () => ({ status: "ok" }))

  // Settings Routes
  .group("/api/v1/settings", (app) =>
    app
      .get("/", async ({ request }) => {
        const tutorId = request.headers.get("X-Tutor-Id");
        if (!tutorId) return new Response("Missing X-Tutor-Id", { status: 401 });

        const setting = await db.setting.findFirst({ where: { tenantId: tutorId } });
        if (!setting) return { success: true, data: null };

        return {
          success: true,
          data: {
            id: setting.tenantId, // Using tenantId as ID
            tenant_id: setting.tenantId,
            instituteName: setting.instituteName,
            instituteAddress: setting.instituteAddress,
            institutePhone: setting.institutePhone,
            instituteEmail: setting.instituteEmail,
            currencyCode: setting.currencyCode,
            locale: setting.locale,
            timezone: setting.timezone,
            defaultFeeModel: setting.defaultFeeModel,
            invoicePrefix: setting.invoicePrefix,
            receiptPrefix: setting.receiptPrefix,
            graceDays: setting.graceDays,
            autoInvoice: setting.autoInvoice,
            nextInvoiceSeq: setting.nextInvoiceSeq,
            nextReceiptSeq: setting.nextReceiptSeq,
            nextStudentSeq: setting.nextStudentSeq,
            attendanceLockHours: setting.attendanceLockHours,
            defaultAttendanceStatus: setting.defaultAttendanceStatus,
            holidayListJson: setting.holidayListJson,
            notifyDueFee: setting.notifyDueFee,
            notifyUpcomingDue: setting.notifyUpcomingDue,
            notifyMissingAttendance: setting.notifyMissingAttendance,
            notifyInactiveStudent: setting.notifyInactiveStudent,
            sessionTimeoutMin: setting.sessionTimeoutMin,
            biometricEnabled: setting.biometricEnabled,
            autoArchiveInactiveDays: setting.autoArchiveInactiveDays,
            theme: setting.theme,
            density: setting.density,
            reducedMotion: setting.reducedMotion,
          },
        };
      })
      .patch("/", async ({ request, body }) => {
        const tutorId = request.headers.get("X-Tutor-Id");
        if (!tutorId) return new Response("Missing X-Tutor-Id", { status: 401 });

        const b = body as any;
        const existing = await db.setting.findFirst({ where: { tenantId: tutorId } });

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
          reducedMotion: true,
        };

        const updateData: Record<string, any> = {};
        for (const [key, val] of Object.entries(b)) {
          if (allowedFields[key]) {
            updateData[key] = val;
          }
        }

        let updated;
        if (existing) {
          updated = await db.setting.update({
            where: { tenantId: existing.tenantId },
            data: updateData,
          });
        } else {
          updated = await db.setting.create({
            data: {
              tenantId: tutorId,
              tenantSecret: crypto.randomUUID(),
              ...updateData,
            }
          });
        }

        return { success: true, data: updated };
      })
  )

  // Security / Auth Routes
  .group("/api/v1/security", (app) =>
    app.post("/erase", async ({ request, body }) => {
      const tutorIdHeader = request.headers.get("X-Tutor-Id");
      if (!tutorIdHeader) return new Response(JSON.stringify({
        code: "unauthenticated",
        message: "Missing X-Tutor-Id header",
        operationId: "secureErase",
        traceId: crypto.randomUUID()
      }), { status: 401, headers: { "Content-Type": "application/json" } });

      const b = body as any;
      if (!b || b.tutorId !== tutorIdHeader || b.confirm !== "ERASE") {
        return new Response(JSON.stringify({
          code: "contract_violation",
          message: "tutorId mismatch or confirmation phrase is not 'ERASE'",
          operationId: "secureErase",
          traceId: crypto.randomUUID()
        }), { status: 400, headers: { "Content-Type": "application/json" } });
      }

      try {
        // We will execute a sequence of drops and deletes to completely wipe tutor data
        // bypass triggers temporarily for hard erase
        await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS trg_ledger_no_update;`);
        await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS trg_ledger_no_delete;`);

        // Execute deletions
        await db.$executeRawUnsafe(`DELETE FROM ledger_entries WHERE tenant_id = ?;`, tutorIdHeader);
        await db.$executeRawUnsafe(`DELETE FROM attendance_records WHERE tenant_id = ?;`, tutorIdHeader);
        await db.$executeRawUnsafe(`DELETE FROM attendance_sessions WHERE tenant_id = ?;`, tutorIdHeader);
        await db.$executeRawUnsafe(`DELETE FROM student_enrollments WHERE tenant_id = ?;`, tutorIdHeader);
        await db.$executeRawUnsafe(`DELETE FROM students WHERE tenant_id = ?;`, tutorIdHeader);
        await db.$executeRawUnsafe(`DELETE FROM fee_plans WHERE tenant_id = ?;`, tutorIdHeader);
        await db.$executeRawUnsafe(`DELETE FROM sync_outbox WHERE tenant_id = ?;`, tutorIdHeader);
        await db.$executeRawUnsafe(`DELETE FROM audit_log WHERE tenant_id = ?;`, tutorIdHeader);
        await db.$executeRawUnsafe(`DELETE FROM settings WHERE tenant_id = ?;`, tutorIdHeader);

        // Recreate the triggers to preserve safety
        await db.$executeRawUnsafe(`
          CREATE TRIGGER IF NOT EXISTS trg_ledger_no_update
          BEFORE UPDATE ON ledger_entries
          BEGIN
            SELECT RAISE(FAIL, 'Ledger entries are immutable.');
          END;
        `);

        await db.$executeRawUnsafe(`
          CREATE TRIGGER IF NOT EXISTS trg_ledger_no_delete
          BEFORE DELETE ON ledger_entries
          BEGIN
            SELECT RAISE(FAIL, 'Ledger entries are immutable.');
          END;
        `);

        return { success: true };
      } catch (err: any) {
        console.error("Secure erase error:", err);
        return new Response(JSON.stringify({
          code: "internal",
          message: err.message || "Failed to erase tutor data",
          operationId: "secureErase",
          traceId: crypto.randomUUID()
        }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
    })
  )
// Start if main module
if (import.meta.main) {
  app.listen(PORT);
  console.log(`🦊 auth-svc is running at ${app.server?.hostname}:${app.server?.port}`);
}
