// Implements: docs/design/overhaul-plan.md §4.2 — /admin operations console.
// AGENTS.md §2 Rule 9: every admin failure is typed and surfaced. This logger
// is the only write path the console has; it is silent unless ADMIN_LOG=1 so a
// production admin session never prints to stdout by accident.

export type AdminLogLevel = "info" | "warn" | "error";

export type AdminLogFields = Readonly<Record<string, string | number | boolean | null>>;

interface AdminLogRecord {
  readonly at: string;
  readonly level: AdminLogLevel;
  readonly event: string;
  readonly fields: AdminLogFields;
}

function enabled(): boolean {
  return process.env.ADMIN_LOG === "1";
}

/**
 * Masks the local part of anything that looks like an email. The console's own
 * values are admin identities, not tenant PII, but stdout on a platform log is
 * a wider blast radius than the audit table, so the narrower form is used here.
 */
function redact(value: string): string {
  const at = value.indexOf("@");
  if (at <= 0) return value;
  return `${value.slice(0, 1)}***${value.slice(at)}`;
}

function emit(level: AdminLogLevel, event: string, fields: AdminLogFields): void {
  if (!enabled()) return;
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    safe[key] = typeof value === "string" ? redact(value) : value;
  }
  const record: AdminLogRecord = { at: new Date().toISOString(), level, event, fields: safe };
  // process.stdout, never console.* (AGENTS.md §2 Rule 9).
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

export function adminLogInfo(event: string, fields: AdminLogFields = {}): void {
  emit("info", event, fields);
}

export function adminLogWarn(event: string, fields: AdminLogFields = {}): void {
  emit("warn", event, fields);
}

export function adminLogError(event: string, fields: AdminLogFields = {}): void {
  emit("error", event, fields);
}

/** Whether admin logging is on, so the console can say so out loud. */
export function adminLogEnabled(): boolean {
  return enabled();
}