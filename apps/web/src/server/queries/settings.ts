// Implements: 08_Settings.md §2 — institute settings read
// All reads go through the API Gateway → auth-svc. No direct Prisma.
"use server";
import { gatewayGet } from "@/server/get-db";

export interface InstituteSettings {
  id: string;
  tenant_id: string;
  instituteName: string | null;
  instituteAddress: string | null;
  institutePhone: string | null;
  instituteEmail: string | null;
  currencyCode: string;
  locale: string;
  timezone: string;
  defaultFeeModel: string;
  invoicePrefix: string;
  receiptPrefix: string;
  graceDays: number;
  autoInvoice: number;
  nextInvoiceSeq: number;
  nextReceiptSeq: number;
  nextStudentSeq: number;
  attendanceLockHours: number;
  defaultAttendanceStatus: string;
  holidayListJson: string;
  notifyDueFee: number;
  notifyUpcomingDue: number;
  notifyMissingAttendance: number;
  notifyInactiveStudent: number;
  sessionTimeoutMin: number;
  biometricEnabled: number;
  autoArchiveInactiveDays: number;
  theme: string;
  density: string;
  reducedMotion: number;
  palette: string;
}

export async function getSettings() {
  const res = await gatewayGet<InstituteSettings | null>("/api/v1/settings");

  if (!res.success) return { success: false, data: null, error: res.error };
  if (!res.data) return { success: true, data: null };

  return {
    success: true,
    data: res.data, // Gateway returns exact matches now
  };
}
