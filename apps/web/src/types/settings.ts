export interface Settings {
  tenant_id?: string;
  institute_name?: string;
  institute_address?: string | null;
  institute_phone?: string | null;
  institute_email?: string | null;
  currency_code?: string;
  locale?: string;
  timezone?: string;
  
  default_fee_model?: string;
  invoice_prefix?: string;
  receipt_prefix?: string;
  grace_days?: number;
  auto_invoice?: number;
  next_invoice_seq?: number;
  next_receipt_seq?: number;
  next_student_seq?: number;

  attendance_lock_hours?: number;

  default_attendance_status?: string;
  holiday_list_json?: string;

  notify_due_fee?: number;
  notify_upcoming_due?: number;
  notify_missing_attendance?: number;
  notify_inactive_student?: number;

  session_timeout_min?: number;
  biometric_enabled?: number;
  pin_hash?: string | null;
  backup_passphrase_hash?: string | null;

  auto_archive_inactive_days?: number;

  theme?: string;
  density?: string;
  reduced_motion?: number;
  plan?: string;
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
