// Implements: RFC-003 §1 G-ERR/G-HARDEN — UI error taxonomy mapper (server code → safe UI state)
//
// Every string this module returns is a static literal. Raw server text,
// Next.js digests, stacks, and payloads are NEVER echoed back — the mapper
// only reads the input to classify it.

export const APP_ERROR_CODES = [
  "AUTH_REQUIRED",
  "DB_NOT_PROVISIONED",
  "CREDENTIALS_EXPIRED",
  "NEEDS_PROVISION",
  "VALIDATION",
  "CONFLICT",
  "UPSTREAM",
  "NOT_FOUND",
  "UNKNOWN",
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

/** The single recovery affordance the UI may offer for this failure. */
export type AppErrorAction = "re-login" | "provision" | "retry" | "contact";

export interface AppErrorState {
  code: AppErrorCode;
  title: string;
  message: string;
  action: AppErrorAction;
}

const STATES: Record<AppErrorCode, AppErrorState> = {
  AUTH_REQUIRED: {
    code: "AUTH_REQUIRED",
    title: "Session expired",
    message: "Your session has expired. Please log in again to continue.",
    action: "re-login",
  },
  DB_NOT_PROVISIONED: {
    code: "DB_NOT_PROVISIONED",
    title: "Database not connected",
    message:
      "Your cloud database is not connected yet. Re-connect it to load this data.",
    action: "provision",
  },
  CREDENTIALS_EXPIRED: {
    code: "CREDENTIALS_EXPIRED",
    title: "Database credentials expired",
    message:
      "Your database credentials have expired. Please log in again to refresh them.",
    action: "re-login",
  },
  NEEDS_PROVISION: {
    code: "NEEDS_PROVISION",
    title: "Database setup needed",
    message:
      "Your database needs to be set up before this data can load. Start provisioning to continue.",
    action: "provision",
  },
  VALIDATION: {
    code: "VALIDATION",
    title: "Check the details",
    message: "Something in the request was invalid. Check the details and try again.",
    action: "retry",
  },
  CONFLICT: {
    code: "CONFLICT",
    title: "Already changed elsewhere",
    message:
      "This record changed somewhere else (duplicate, locked session, or a retry). Refresh and try again.",
    action: "retry",
  },
  UPSTREAM: {
    code: "UPSTREAM",
    title: "Couldn't reach the database",
    message: "Check your connection and retry. Your local data is unaffected.",
    action: "retry",
  },
  NOT_FOUND: {
    code: "NOT_FOUND",
    title: "Not found",
    message: "Student not found or was deleted.",
    action: "contact",
  },
  UNKNOWN: {
    code: "UNKNOWN",
    title: "Something went wrong",
    message: "Please try again. If this keeps happening, contact support.",
    action: "contact",
  },
};

const KNOWN_CODES: ReadonlySet<string> = new Set<string>(APP_ERROR_CODES);

/** Leading `CODE: rest` / `CODE - rest` prefix, e.g. `DB_NOT_PROVISIONED: ...`. */
const CODE_PREFIX_RE = /^\s*([A-Z][A-Z0-9_]{2,40})\s*[:\-–]\s*/;

interface SuccessEnvelope {
  success?: unknown;
  error?: unknown;
  message?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Pulls the most likely server text out of throws, strings, and `{success:false}` envelopes. */
function coerceText(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof Error) {
    // Next.js attaches `digest` to server-component errors; the digest alone
    // must classify as UPSTREAM without ever being rendered.
    if ("digest" in input && typeof input.digest === "string")
      return `NEXT_DIGEST ${input.message}`;
    return input.message;
  }
  if (isRecord(input)) {
    const envelope = input as SuccessEnvelope;
    if (typeof envelope.error === "string" && envelope.error.length > 0)
      return envelope.error;
    if (envelope.error instanceof Error) return envelope.error.message;
    if (typeof envelope.message === "string" && envelope.message.length > 0)
      return envelope.message;
    // Next.js server errors may surface as `{ digest: "..." }` with no message.
    if (typeof input["digest"] === "string") return "NEXT_DIGEST";
  }
  return "";
}

/**
 * Best-effort classification of raw failure text into a stable server code.
 * Returns null when nothing matches (caller falls back to UNKNOWN).
 */
export function extractServerCode(text: string): AppErrorCode | null {
  if (!text) return null;
  const prefix = CODE_PREFIX_RE.exec(text)?.[1];
  if (prefix && KNOWN_CODES.has(prefix)) return prefix as AppErrorCode;

  const lowered = text.toLowerCase();
  if (/__next|digest|dynamically|server component|chunk|hydrat/.test(lowered))
    return "UPSTREAM";
  if (/not yet provisioned|not provisioned|provision/i.test(text))
    return /needs provision|requires provisioning/i.test(text)
      ? "NEEDS_PROVISION"
      : "DB_NOT_PROVISIONED";
  if (/expir|invalid.*(token|credential)|refresh|stale.*session/i.test(text))
    return "CREDENTIALS_EXPIRED";
  // Locked/duplicate beats the generic session keyword: "Session is locked"
  // is a conflict on the record, not an auth failure.
  if (/not found|was deleted|no longer exist|does not exist|gone/i.test(text))
    return "NOT_FOUND";
  if (/locked|conflict|duplicate|already exists|version mismatch|stale/i.test(text))
    return "CONFLICT";
  if (
    /\b401\b|unauthor|forbidden|auth_required|no session|session|sign[ -]?in|log[ -]?in|jwt/i.test(
      text,
    )
  )
    return "AUTH_REQUIRED";
  if (/zod|invalid|validation|must be|required|bad request|\b400\b|format/i.test(text))
    return "VALIDATION";
  if (
    /network|fetch failed|failed to fetch|timeout|timed out|upstream|temporar|offline|unreachable|gateway|\b50[023]\b|econn|socket|turso|libsql/i.test(
      text,
    )
  )
    return "UPSTREAM";
  return null;
}

/**
 * Maps any thrown error, message string, or `{ success: false, error }`
 * envelope to a safe, renderable UI state. Output strings are static
 * literals — digests, stacks, and raw payloads never pass through.
 */
export function toAppErrorState(input: unknown): AppErrorState {
  const code = extractServerCode(coerceText(input)) ?? "UNKNOWN";
  return STATES[code];
}
