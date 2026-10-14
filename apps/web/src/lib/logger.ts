// Implements: top-level AGENTS.md §2 Rule 9 (no silent failures, typed logger, no console.log in prod)
// web/AGENTS.md §3.6 (Use the typed logger from lib/logger.ts; routes to audit_log for sensitive events and Vercel logs for diagnostic events).
//
// The typed logger is the single replacement for `console.log/info/warn/error/debug` in apps/web.
// It NEVER throws. It routes everything to platform logs (Vercel logs
// server-side, the browser console client-side):
//   - info → diagnostic, non-sensitive
//   - warn → non-fatal anomaly worth a paper trail
//   - error → sensitive; the next agent / tutor should be able to find it
//   - audit → explicit, deliberate record-keeping events: ledger_void,
//     error_unhandled, lock/unlock/import/export/backup per BR-SEC-03
//
// The client-bundled version is a thin console wrapper that respects `no-console` semantics:
//   - it still warns/errors to the browser console in development, and is silent in production
//   - audit on the client prints like everything else; there is no second sink
//
// THERE IS DELIBERATELY NO NETWORK TRANSPORT HERE. `log.*` used to POST
// audit/warn/error rows to `/api/v1/audit-log` through a bounded queue +
// retry ladder — but no such route ever existed (the catch-all forwarded it
// to a gateway with no handler), so every fan-out was a guaranteed 404. The
// authoritative `audit_log` rows are written transactionally by the server
// actions and gateway routes that own the mutation (Rule 7); this module is
// the diagnostic breadcrumb layer, and breadcrumbs belong in platform logs.
// A transport to nowhere is worse than no transport: it converts every audit
// call into a failure report about a misconfiguration that cannot be fixed.
//

// We export a singleton `log` plus the structured `auditAction` helper so call sites can pick the right verb.
//
// REDACTION IS NOT OPTIONAL AND NOT THE CALL SITE'S JOB (10_Security.md §8).
// `build()` is the single choke point every verb goes through, and it runs
// `action`, `message` and `context` through the shared redactor
// (`@buddysaradhi/shared` → `src/redact.ts`, the same module the gateway uses)
// BEFORE anything is written. That matters because `console.*` goes to
// Vercel's log retention, where a token or PIN in the context object would sit
// readable for the retention window. The doc comment on `LogContext` says
// "ids, counts, status codes, NOT free-form user input"; that used to be a
// convention, and a convention is not a control. It is a control now.

import { formatISO } from 'date-fns';
import { redact, redactLogContext } from '@buddysaradhi/shared';

export type LogLevel = 'info' | 'warn' | 'error' | 'audit';

export interface LogContext {
  /** Who/what triggered the event — e.g. `studentId`, `requestId`, `actionName`. */
  [key: string]: unknown;
}

export interface LogPayload {
  level: LogLevel;
  /** Stable machine-readable action, e.g. `payment_recorded`, `ledger_void`. */
  action: string;
  /** Human-readable description. Redacted before it leaves this module. */
  message: string;
  /** Optional structured context. Redacted before it leaves this module. */
  context?: LogContext;
  /** ISO-8601 UTC timestamp. */
  timestamp: string;
}

export type AuditLogRow = LogPayload & { context: LogContext };

const inBrowser = typeof window !== 'undefined';
const isProd = process.env.NODE_ENV === 'production';

function build(level: LogLevel, action: string, message: string, context?: LogContext): LogPayload {
  return {
    level,
    action: redact(action),
    message: redact(message),
    context: context === undefined ? undefined : redactLogContext(context),
    timestamp: formatISO(new Date()),
  };
}

function emit(entry: LogPayload): void {
  // Local sinks ONLY. There is deliberately no network transport here anymore:
  // `log.*` used to POST audit/warn/error rows to `/api/v1/audit-log`, but no
  // such route ever existed — the catch-all forwarded it to a gateway with no
  // handler, so every fan-out was a guaranteed 404 followed by a loud report
  // about a misconfiguration that could never be configured away. Pure noise.
  // The authoritative audit rows live in the database, written
  // transactionally by the server actions and gateway routes that own them
  // (Rule 7 / BR-SEC-03); this module is the diagnostic breadcrumb layer, and
  // breadcrumbs belong in platform logs, not in a second write path to a table
  // they were never designed for.
  //
  // In development we still allow `console.*` so engineers can iterate; in
  // production diagnostic noise is suppressed and audit rows still print, so a
  // Vercel log tail always shows what the tutor-facing record-keeping did.
  if (inBrowser) {
    if (!isProd || entry.level === 'audit') {
      streamFor(entry.level)(`[${entry.level}] ${entry.action}: ${entry.message}`, entry.context ?? '');
    }
    return;
  }
  streamFor(entry.level)(`[${entry.level}] ${entry.action}: ${entry.message}`, entry.context ?? '');
}

/** Resolved per call (never hoisted) so a test spy on `console` is honoured. */
function streamFor(level: LogLevel): (...args: unknown[]) => void {
  if (level === 'error') return console.error;
  if (level === 'warn') return console.warn;
  return console.info;
}
export const log = {
  info(action: string, message: string, context?: LogContext): void {
    emit(build('info', action, message, context));
  },
  warn(action: string, message: string, context?: LogContext): void {
    emit(build('warn', action, message, context));
  },
  error(action: string, message: string, context?: LogContext): void {
    emit(build('error', action, message, context));
  },
  audit(action: string, message: string, context: LogContext = {}): void {
    emit(build('audit', action, message, context));
  },
};

/**
 * Emits a typed record-keeping event per BR-SEC-03: ledger_void,
 * error_unhandled, lock/unlock, import, export, backup.
 *
 * This is a LOCAL diagnostic breadcrumb (platform logs), not a database
 * write. The authoritative `audit_log` rows are written transactionally by
 * the server actions and gateway routes that own the mutation (Rule 7) —
 * there is deliberately no network transport here, because the `/api/v1/
 * audit-log` route it would POST to never existed.
 */
export function auditAction(action: string, context: LogContext = {}, message?: string): void {
  log.audit(action, message ?? action, context);
}
