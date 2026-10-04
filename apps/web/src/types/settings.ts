// Implements: 08_Settings.md §1 (institute parameters) + 11_Data_Model.md §2
// (the `settings` row).
//
// This interface was snake_case with `[key: string]: any` at the bottom. Two
// consequences, both bad:
//
//  1. The `any` index signature widened every declared field to `any`, so the
//     interface constrained nothing — a typo'd key type-checked fine.
//  2. The declared snake_case fields (`institute_name`) did not match what the
//     Settings sections actually read (`instituteName`), so *every* real access was
//     falling through to the index signature. The declared fields were decorative.
//
// The fields below are the ones the screens read, in the casing they use. The index
// signature is `unknown`, not `any`: the gateway returns whatever columns exist on
// the row, so the shape must stay open, but an unlisted key now has to be narrowed
// before use. Add a field here rather than casting at a call site — that is the whole
// point of the interface.
export interface Settings {
  tenantId?: string | null;

  // Institute profile (08_Settings.md §2)
  // Nullable: the gateway returns the raw column, which is NULL until the tutor
  // fills it in. Consumers already fall back with `||`, so `null` is the honest type.
  instituteName?: string | null;
  instituteAddress?: string | null;
  institutePhone?: string | null;
  instituteEmail?: string | null;

  // `currency_code` and `plan` are TEXT columns, so the raw read is `string`. The
  // allowed set is owned by Zod at the write boundary (`profileSchema` uses
  // `z.enum`), not by this read-side interface — a union here would force every
  // reader to cast a value the database never constrained.
  currencyCode?: string | null;
  locale?: string | null;

  /** BR-RC-01: monotonic prefixes; the sequence itself lives on the tenant row. */
  invoicePrefix?: string | null;
  receiptPrefix?: string | null;
  graceDays?: number;
  autoInvoice?: number;
  defaultFeeModel?: string;

  // Attendance rules (08_Settings.md §4)
  attendanceLockHours?: number;

  // Notifications (08_Settings.md §5)
  notifyDueFee?: number;
  notifyUpcomingDue?: number;
  notifyMissingAttendance?: number;
  notifyInactiveStudent?: number;

  // Security (10_Security.md §3)
  sessionTimeoutMin?: number;
  biometricEnabled?: number;
  pinHash?: string | null;
  backupPassphraseHash?: string | null;

  // Appearance (13_UI_Guidelines.md §2 — palette + material are generated, never literal)
  palette?: string | null;
  material?: string | null;
  density?: string | null;
  reducedMotion?: boolean | number | null;
  theme?: string | null;

  /** Set by the entitlements work, read by the upgrade paths. TEXT column, like currency. */
  plan?: string | null;

  [key: string]: unknown;
}