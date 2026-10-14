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
// AN AUDIT ROW IS NOT FIRE-AND-FORGET. It used to be: `void fetch(...).catch(() => {})`,
// so a BR-SEC-03 / Rule 7 audit row could vanish with no retry, no signal and no counter.
// Delivery now goes through the bounded queue + retry ladder + loud terminal failure in
// `Audit transport` below, and `auditTransportFailures()` must read 0. See that block for
// the full contract, including why the terminal step reports instead of throwing.
//
// We export a singleton `log` plus the structured `auditAction` helper so call sites can pick the right verb.
//
// REDACTION IS NOT OPTIONAL AND NOT THE CALL SITE'S JOB (10_Security.md §8).
// `build()` is the single choke point every verb goes through, and it runs
// `action`, `message` and `context` through the shared redactor
// (`@buddysaradhi/shared` → `src/redact.ts`, the same module the gateway uses)
// BEFORE anything is written. That matters because this logger has two sinks with
// different lifetimes: `console.*` goes to Vercel's log retention, while the
// `/api/v1/audit-log` POST is PERSISTED to `audit_log` — so a token or a PIN that
// reaches the context object is not merely printed, it is written down. The
// doc comment on `LogContext` says "ids, counts, status codes, NOT free-form user
// input"; that used to be a convention, and a convention is not a control. It is
// a control now.

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
const AUDIT_PATH = '/api/v1/audit-log';

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
  // The browser-side: route everything through the platform's structured pipeline.
  // In development we still allow `console.*` so engineers can iterate, but in
  // production we suppress diagnostic noise and ONLY forward audit rows.
  if (inBrowser) {
    if (!isProd || entry.level === 'audit') {
      streamFor(entry.level)(`[${entry.level}] ${entry.action}: ${entry.message}`, entry.context ?? '');
    }
    if (entry.level === 'audit') {
      enqueueAudit(entry, AUDIT_PATH);
    }
    return;
  }

  // Server-side: Vercel logs always, then a queued fan-out to the audit route.
  streamFor(entry.level)(`[${entry.level}] ${entry.action}: ${entry.message}`, entry.context ?? '');

  // W-AP-5 / FM-06: never hardcode http://localhost:3000. If we cannot resolve
  // a base URL there is nowhere to send the row, and saying nothing about that
  // is how a deployment ends up believing it has an audit trail it does not —
  // so it is reported once per process instead of skipped silently.
  if (entry.level === 'audit' || entry.level === 'warn' || entry.level === 'error') {
    const base = process.env.NEXT_PUBLIC_APP_URL;
    if (!base) {
      reportAuditFanoutUnconfigured(entry);
      return;
    }
    enqueueAudit(entry, `${base.replace(/\/$/, '')}${AUDIT_PATH}`);
  }
}

/** Resolved per call (never hoisted) so a test spy on `console` is honoured. */
function streamFor(level: LogLevel): (...args: unknown[]) => void {
  if (level === 'error') return console.error;
  if (level === 'warn') return console.warn;
  return console.info;
}

// ---------------------------------------------------------------------------
// Audit transport — Rule 9, BR-SEC-03
// ---------------------------------------------------------------------------
//
// An `audit` row is not a diagnostic. BR-SEC-03 and Rule 7 make it part of the
// record of a sensitive event, so a transport that can lose one without a trace
// is a lie told to the tutor and to the next engineer.
//
// The transport used to be `void fetch(...).catch(() => {})`: fire-and-forget,
// with the rejection explicitly swallowed. An audit row could vanish with no
// retry, no signal and no counter — and in a budget it looks like it worked,
// because the caller still gets its success return.
//
// This is a bounded pending set with a bounded retry ladder and a loud terminal
// failure, and deliberately NOT a pipeline — no persistence, no worker, no new
// origin, no new dependency:
//
//   enqueue → first attempt fires IMMEDIATELY (an audit row must not queue
//              behind another row's latency — `logger.test.ts` pins this)
//            ├─ 2xx                         → delivered, forget it
//            ├─ network error / 408 / 429 /
//            │  5xx                         → schedule a backoff retry, ≤3 attempts
//            └─ any other 4xx               → give up NOW and report. A 404/405 is
//                                             a misconfiguration; retrying it is
//                                             load that cannot succeed.
//   give up → console.error + `auditTransportFailures()`.
//
// The pending set is capped at `AUDIT_MAX_QUEUE`. An unbounded pending set is
// the same unbounded-growth defect F-29 removed from the rate limiter: a dead
// transport plus a chatty caller is a leak, so the OLDEST pending row is dropped
// and that drop is reported like any other loss.
//
// The terminal step never throws, on purpose: the caller is nearly always a
// server action whose transaction has ALREADY committed, and throwing there would
// convert a lost breadcrumb into a reported-but-unwritten mutation. The commit
// is the tutor's money; the breadcrumb is our problem to shout about, not theirs
// to pay for.

const AUDIT_MAX_QUEUE = 200;
const AUDIT_MAX_ATTEMPTS = 3;
const AUDIT_RETRY_BASE_MS = 50;
const AUDIT_RETRYABLE_STATUS = new Set([408, 429]);

interface PendingAudit {
  entry: LogPayload;
  url: string;
  attempts: number;
  /** Non-null while a backoff retry is scheduled. */
  timer: ReturnType<typeof setTimeout> | null;
  /** Set when the row was dropped from a full pending set; never reported twice. */
  cancelled: boolean;
}

const auditPending: PendingAudit[] = [];
const auditWaiters: Array<() => void> = [];
let auditActive = 0;
let auditFailures = 0;
let auditDropped = 0;
let fanoutUnconfiguredReported = false;

/**
 * The ONE place a lost audit row becomes visible.
 *
 * It calls `console.error` DIRECTLY rather than `log.error`: a transport that
 * reports its own failure through the transport it just failed is a loop.
 */
function reportAuditLoss(reason: string, entry: LogPayload, detail: LogContext): void {
  auditFailures += 1;
  console.error(
    `[audit_transport_failed] ${reason} action=${entry.action} detail=${JSON.stringify(detail)}`,
  );
}

/** Reported once per process: on a misconfigured deploy it would repeat forever. */
function reportAuditFanoutUnconfigured(entry: LogPayload): void {
  if (fanoutUnconfiguredReported) return;
  fanoutUnconfiguredReported = true;
  console.error(
    `[audit_transport_unconfigured] action=${entry.action} ` +
      `NEXT_PUBLIC_APP_URL is unset, so this row reached Vercel logs only and no ` +
      `audit_log write was attempted`,
  );
}

function notifyAuditWaiters(): void {
  const waiters = auditWaiters.splice(0, auditWaiters.length);
  for (const waiter of waiters) waiter();
}

/** Retire `job`: drop it from the pending set and, if it was lost, say so. Idempotent. */
function retire(job: PendingAudit, lostAs?: string, detail?: LogContext): void {
  const index = auditPending.indexOf(job);
  if (index < 0) return;
  auditPending.splice(index, 1);
  // An overflowed row was already reported when it was dropped; do not double-count
  // it if its in-flight attempt lands afterwards.
  if (lostAs && !job.cancelled) reportAuditLoss(lostAs, job.entry, detail ?? {});
  notifyAuditWaiters();
}

async function deliver(job: PendingAudit): Promise<void> {
  job.attempts += 1;
  auditActive += 1;
  let failure = 'unknown';
  let retryable = false;
  let delivered = false;
  try {
    const res = await fetch(job.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(job.entry),
      keepalive: true,
    });
    if (res.ok) {
      delivered = true;
    } else {
      failure = `http_${res.status}`;
      retryable = res.status >= 500 || AUDIT_RETRYABLE_STATUS.has(res.status);
    }
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
    retryable = true;
  } finally {
    // `finally`, not a second decrement on each exit: a counter that can only be
    // balanced on the happy path leaks, and a leaked one hangs `flushAuditTransport`.
    auditActive = Math.max(0, auditActive - 1);
  }

  if (delivered) {
    retire(job);
    return;
  }
  if (job.cancelled) {
    notifyAuditWaiters();
    return;
  }
  if (!retryable || job.attempts >= AUDIT_MAX_ATTEMPTS) {
    retire(job, 'give_up', { url: job.url, attempts: job.attempts, failure });
    return;
  }
  job.timer = setTimeout(() => {
    job.timer = null;
    startDelivery(job);
  }, AUDIT_RETRY_BASE_MS * 2 ** (job.attempts - 1));
}

/**
 * Kick off one attempt. `deliver` handles its own transport failures; this guard
 * exists so a bug in the ladder itself can never become an unhandled rejection,
 * which in a serverless runtime is a process kill — Rule 9 again, in the other
 * direction: visible, not silent.
 */
function startDelivery(job: PendingAudit): void {
  void deliver(job).catch((err: unknown) => {
    console.error(`[audit_transport_crash] ${err instanceof Error ? err.message : String(err)}`);
    retire(job, 'crashed');
  });
}

function enqueueAudit(entry: LogPayload, url: string): void {
  if (auditPending.length >= AUDIT_MAX_QUEUE) {
    const evicted = auditPending.shift();
    if (evicted) {
      if (evicted.timer !== null) clearTimeout(evicted.timer);
      evicted.cancelled = true;
      auditDropped += 1;
      reportAuditLoss('queue_overflow', evicted.entry, {
        url: evicted.url,
        droppedTotal: auditDropped,
      });
    }
  }
  const job: PendingAudit = { entry, url, attempts: 0, timer: null, cancelled: false };
  auditPending.push(job);
  startDelivery(job);
}

/**
 * Resolves once every queued audit row has been delivered or given up on.
 * Diagnostics and tests; production call sites keep using the sync `log.audit`.
 */
export async function flushAuditTransport(): Promise<void> {
  while (auditPending.length > 0 || auditActive > 0) {
    await new Promise<void>((resolve) => {
      auditWaiters.push(resolve);
    });
  }
}

/** Audit rows the transport could NOT deliver. Anything above 0 is a bug. */
export function auditTransportFailures(): number {
  return auditFailures;
}

/** Test-only reset (same convention as `resetApiRateLimits`). */
export function resetAuditTransport(): void {
  for (const job of auditPending) {
    if (job.timer !== null) clearTimeout(job.timer);
  }
  auditPending.length = 0;
  auditActive = 0;
  auditFailures = 0;
  auditDropped = 0;
  fanoutUnconfiguredReported = false;
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
 *
 * Returns once the row is QUEUED, not once it is delivered — the call site is
 * usually a server action whose transaction has already committed and must not
 * be held open by the transport. Delivery is not a guess though: it is retried,
 * and on give-up it is reported and counted by `auditTransportFailures()`.
 */
export function auditAction(action: string, context: LogContext = {}, message?: string): void {
  log.audit(action, message ?? action, context);
}
