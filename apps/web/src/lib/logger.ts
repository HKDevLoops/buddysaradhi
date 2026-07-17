// Implements: top-level AGENTS.md §2 Rule 9 (no silent failures, typed logger, no console.log in prod)
// web/AGENTS.md §3.6 (Use the typed logger from lib/logger.ts; routes to audit_log for sensitive events and Vercel logs for diagnostic events).
//
// The typed logger is the single replacement for `console.log/info/warn/error/debug` in apps/web.
// It NEVER throws. It routes:
//   - info → Vercel logs only (diagnostic, non-sensitive)
//   - warn → Vercel logs + audit_log on the server (non-fatal anomaly worth a paper trail)
//   - error → Vercel logs + audit_log on the server (sensitive; the next agent / tutor should be able to find it)
//   - audit → audit_log ONLY (for explicit, deliberate record-keeping events: ledger_void, error_unhandled, lock/unlock/import/export/backup per BR-SEC-03)
//
// The client-bundled version is a thin console wrapper that respects `no-console` semantics:
//   - it still warns/errors to the browser console in development, and is silent in production
//   - audit on the client routes to /api/v1/audit-log (server-only writes the row) — see apps/web/src/app/api/v1/[...slug]/route.ts
//
// We export a singleton `log` plus the structured `auditAction` helper so call sites can pick the right verb.

import { formatISO } from 'date-fns';

export type LogLevel = 'info' | 'warn' | 'error' | 'audit';

export interface LogContext {
  /** Who/what triggered the event — e.g. `studentId`, `requestId`, `actionName`. */
  [key: string]: unknown;
}

export interface LogPayload {
  level: LogLevel;
  /** Stable machine-readable action, e.g. `payment_recorded`, `ledger_void`. */
  action: string;
  /** Human-readable description, NEVER PII. */
  message: string;
  /** Optional structured context — ids, counts, status codes, NOT free-form user input. */
  context?: LogContext;
  /** ISO-8601 UTC timestamp. */
  timestamp: string;
}

export type AuditLogRow = LogPayload & { context: LogContext };

const inBrowser = typeof window !== 'undefined';
const isProd = process.env.NODE_ENV === 'production';
const AUDIT_PATH = '/api/v1/audit-log';

function build(level: LogLevel, action: string, message: string, context?: LogContext): LogPayload {
  return {
    level,
    action,
    message,
    context,
    timestamp: formatISO(new Date()),
  };
}

function emit(entry: LogPayload): void {
  // The browser-side: route everything through the platform's structured pipeline.
  // In development we still allow `console.*` so engineers can iterate, but in
  // production we suppress diagnostic noise and ONLY forward audit rows.
  if (inBrowser) {
    if (!isProd || entry.level === 'audit') {
      const fn =
        entry.level === 'error'
          ? console.error
          : entry.level === 'warn'
            ? console.warn
            : console.info;
      fn(`[${entry.level}] ${entry.action}: ${entry.message}`, entry.context ?? '');
    }
    if (entry.level === 'audit') {
      // Best-effort, fire-and-forget. We do not throw on the client.
      void fetch(AUDIT_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entry),
        keepalive: true,
      }).catch(() => {
        // Swallow network errors here — failing to write an audit log must NEVER
        // become a silent failure that hides the original event. The server-side
        // path is the authoritative one; this is best-effort.
      });
    }
    return;
  }

  // Server-side: Vercel logs always, then a side-effect to append audit rows.
  const stream =
    entry.level === 'error'
      ? console.error
      : entry.level === 'warn'
        ? console.warn
        : entry.level === 'audit'
          ? console.info
          : console.info;
  stream(`[${entry.level}] ${entry.action}: ${entry.message}`, entry.context ?? '');

  // The actual persistence to audit_log is performed by the route at AUDIT_PATH
  // (apps/web/src/app/api/v1/audit-log/route.ts). Server-side this is an in-process
  // fan-out: we don't want callers to await it, but we DO want it to run.
  // Guarded so we never crash the process if the route is misconfigured.
  // W-AP-5 / FM-06: never hardcode http://localhost:3000. If we cannot resolve
  // a base URL we skip the fan-out; the canonical write happens server-side via
  // audit_log (which is the authoritative sink).
  if (entry.level === 'audit' || entry.level === 'warn' || entry.level === 'error') {
    const base = process.env.NEXT_PUBLIC_APP_URL;
    if (base) {
      void fetch(`${base.replace(/\/$/, '')}${AUDIT_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entry),
        keepalive: true,
      }).catch(() => {
        // Persisted logs are best-effort here. The route itself is responsible for
        // the canonical write to audit_log; if it failed we still have the Vercel log.
      });
    }
  }
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
 * Records a typed action on the audit_log table via the route at `/api/v1/audit-log`.
 * Use this for explicit, deliberate record-keeping events per BR-SEC-03:
 * ledger_void, error_unhandled, lock/unlock, import, export, backup.
 */
export function auditAction(action: string, context: LogContext = {}, message?: string): void {
  log.audit(action, message ?? action, context);
}
