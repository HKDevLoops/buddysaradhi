// Implements: 08_Settings.md §2 — institute settings read
// All reads go through the API Gateway → auth-svc. No direct Prisma.
// web/02_State_and_Data_Flow.md §5 + §3.2 (settings singleton: reference data, cacheable);
// 02_Core_Logic.md §9 (batch + cache as metered-tier budget control);
// docs/rfc/003-saas-overhaul.md workstream C + §0 (63s tenant-scoped TTL: ~1 upstream
// fetch per minute per tenant instead of one per request — bandwidth + rows-read savings).
"use server";
import { cache } from "react";
import { gatewayGet, getGatewayHeaders } from "@/server/get-db";
import {
  QUERY_TIMEOUT_MS,
  getCached,
  toTypedQueryError,
  withQueryTimeout,
} from "@/server/cache";
import { log } from "@/lib/logger";

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
  // RFC-004 C4: the CAS base. The gateway GET returns the raw ORM row, which
  // carries camelCase `updatedAt` (its `toSafeSettings` projection strips
  // secrets, never timestamps); `updated_at` is the same value under the
  // snake_case spelling the PATCH `base_updated_at` contract uses. Forms
  // capture either as the base for updateSettingAction/updateSettingsBatchAction.
  updatedAt: string | null;
  updated_at: string | null;
}

export const getSettings = cache(async function getSettings() {
  try {
    // Tenant scope for the cache key: local auth resolution only (no metered rows).
    const { tenantId } = await getGatewayHeaders();
    const data = await getCached<InstituteSettings | null>(
      tenantId,
      "settings:singleton",
      async () => {
        const res = await withQueryTimeout(
          gatewayGet<InstituteSettings | null>("/api/v1/settings"),
          QUERY_TIMEOUT_MS,
        );
        if (!res.success) throw new Error(res.error);
        return res.data;
      },
    );
    if (!data) return { success: true, data: null };

    // RFC-004 C4: pass the row timestamp through in both spellings so edit
    // forms can capture the CAS base. A gateway that omits it yields null
    // (forms then send no base — the legacy path — never a fabricated stamp).
    const raw = data as InstituteSettings & { updatedAt?: unknown; updated_at?: unknown };
    const updatedAt =
      typeof raw.updatedAt === "string" ? raw.updatedAt
      : typeof raw.updated_at === "string" ? raw.updated_at
      : null;
    return {
      success: true,
      data: { ...data, updatedAt, updated_at: updatedAt }, // Gateway returns exact matches now
    };
  } catch (err) {
    const typed = toTypedQueryError(err);
    log.error("settings_read_failed", typed);
    return { success: false, data: null, error: typed };
  }
});
