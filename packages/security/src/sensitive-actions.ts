// Implements: 10_Security.md §4 Sensitive-Mutation PIN & Export Controls Matrix.
//
// A typed registry, mirrored 1:1 by a UI test. Server actions / pages consult
// `lookupSensitiveAction(action)` before applying the mutation; the gate lives
// elsewhere. Compile-only scaffold — runtime wire-up deferred to RFC sub-RFC #1.

export type SensitiveActionId =
  | "void_receipt"
  | "unlock_attendance"
  | "backdated_ledger_entry"
  | "bulk_delete"
  | "backup_export"
  | "backup_restore"
  | "pin_change"
  | "biometric_toggle"
  | "disable_app_lock"
  | "tenant_secret_reveal"
  | "audit_log_export"
  | "secure_erase";

export type SensitiveActionGate = {
  freshAuthSeconds: number;          // fresh PIN/biometric ≤ N seconds old
  typedConfirmRequired: string | null; // e.g. "EXPORT", "RESTORE", "ERASE" — null if not required
  auditAction: string;               // value written to audit_log.action verbatim
};

export const SENSITIVE_ACTIONS: Record<SensitiveActionId, SensitiveActionGate> = {
  void_receipt:                    { freshAuthSeconds: 30, typedConfirmRequired: null,        auditAction: "payment_void" },
  unlock_attendance:               { freshAuthSeconds: 30, typedConfirmRequired: null,        auditAction: "attendance_unlock" },
  backdated_ledger_entry:          { freshAuthSeconds: 30, typedConfirmRequired: null,        auditAction: "backdated_ledger" },
  bulk_delete:                     { freshAuthSeconds: 30, typedConfirmRequired: "DELETE",   auditAction: "bulk_delete" },
  backup_export:                   { freshAuthSeconds: 30, typedConfirmRequired: "EXPORT",   auditAction: "export_full" },
  backup_restore:                  { freshAuthSeconds: 30, typedConfirmRequired: "RESTORE",  auditAction: "backup_restore" },
  pin_change:                      { freshAuthSeconds: 30, typedConfirmRequired: "CHANGE",   auditAction: "pin_change" },
  biometric_toggle:                { freshAuthSeconds: 30, typedConfirmRequired: "DISABLE",  auditAction: "biometric_toggle" },
  disable_app_lock:                { freshAuthSeconds: 30, typedConfirmRequired: "DISABLE",  auditAction: "app_lock_disabled" },
  tenant_secret_reveal:            { freshAuthSeconds: 30, typedConfirmRequired: "REVEAL",   auditAction: "tenant_secret_reveal" },
  audit_log_export:                { freshAuthSeconds: 30, typedConfirmRequired: null,        auditAction: "export_audit_log" },
  secure_erase:                    { freshAuthSeconds: 30, typedConfirmRequired: "ERASE",    auditAction: "erase_initiated" },
};

export function lookupSensitiveAction(id: SensitiveActionId): SensitiveActionGate {
  const gate = SENSITIVE_ACTIONS[id];
  if (!gate) throw new Error(`Unknown sensitive action: ${id}`);
  return gate;
}

export function isSensitiveActionExemptAction(action: string): boolean {
  // Per §4.1: monthly Excel export and single-receipt PDF statements are exempt
  // (single-tap confirm). The `auditAction` strings we never gate: `export_excel`,
  // `export_receipt_pdf`, `export_statement_pdf`.
  return action === "export_excel" || action === "export_receipt_pdf" || action === "export_statement_pdf";
}

export const SENSITIVE_ACTIONS_TEST_GUARD = {
  ids: Object.keys(SENSITIVE_ACTIONS).sort(),
  count: Object.keys(SENSITIVE_ACTIONS).length,
};
