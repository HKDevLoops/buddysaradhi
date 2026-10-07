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
  /**
   * The refusal's own reason, when — and only when — the failure is a VALIDATION
   * refusal this app produced. `message` is always a static literal; `detail` is
   * the one narrow exception, gated by `validationDetail` below.
   */
  detail?: string;
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

/**
 * VALIDATION, widened (settings audit, 2026-10-06) — this pattern was the whole
 * reason a real refusal reached a tutor as "Please try again. If this keeps
 * happening, contact support."
 *
 * The pattern only knew the words `zod|invalid|validation|must be|required|bad
 * request|400|format`. Almost none of the refusals this app actually emits
 * contain one of them. `SETTING_VALUE_SCHEMAS` in
 * `server/actions/settings.ts` builds every message as `${field}: ${detail}`,
 * and its `detail` is either a Zod default or a sentence we wrote:
 *
 *   - `instituteAddress: Expected string, received null`   (Zod default)
 *   - `attendanceLockHours: Expected number, received string` (Zod default)
 *   - `institutePhone: Use a phone number of 6 to 15 digits, optionally starting with +`
 *   - `currencyCode: Use a three-letter currency code such as INR`
 *   - `invoicePrefix: Prefix must be alphanumeric (letters, digits, hyphen)`
 *   - `nextInvoiceSeq is maintained by the app and cannot be set directly.`
 *   - `No valid settings fields`
 *
 * Four of those matched nothing in the old pattern, so `toAppErrorState` fell
 * through to UNKNOWN and the tutor was told to contact support about a value
 * gate they could fix themselves in one keystroke. That is Rule 9 broken twice:
 * a refused save, and then no reason for it.
 *
 * The additions are deliberately the four shapes these messages actually take —
 * Zod's `Expected …, received …`, a `Use a …` imperative, the sequence-state
 * refusal, and the empty-batch refusal — not a loose "looks like an error".
 */
const VALIDATION_RE =
  /zod|invalid|validation|must be|required|bad request|\b400\b|format|expected\s+\w+.*,\s*received\s+\w+|\buse a\b|maintained by the app|cannot be set|no valid settings fields/i;

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
  if (VALIDATION_RE.test(text)) return "VALIDATION";
  if (
    /network|fetch failed|failed to fetch|timeout|timed out|upstream|temporar|offline|unreachable|gateway|\b50[023]\b|econn|socket|turso|libsql/i.test(
      text,
    )
  )
    return "UPSTREAM";
  return null;
}

/**
 * The one bounded place server text is allowed to reach the screen.
 *
 * A VALIDATION refusal that renders as a static literal tells a tutor their input
 * was wrong and nothing about WHICH input — and on the Profile card the field that
 * failed is often one they never touched (`instituteAddress` is sent as `null` on
 * every save, so a new tutor cannot save their own name until this surfaces). So
 * the reason is surfaced, under a fail-closed allowlist rather than by relaxing
 * this module's "never echo server text" invariant:
 *
 *   - the shape must be exactly `field: Sentence`, which is how every
 *     `SETTING_VALUE_SCHEMAS` refusal is built (`${key}: ${detail}`);
 *   - `field` must be a plain camelCase identifier;
 *   - `Sentence` must be ONE line, at most 160 characters, and must not read like
 *     anything but a human sentence — no stack frames, no SQL, no credential or
 *     URL vocabulary. A raw throw, a Next.js digest, or a driver message fails
 *     every one of those and is dropped, which is why the existing
 *     "never echoes raw payloads" guarantee is untouched.
 *
 * Returns null for anything it cannot vouch for; the caller then renders the
 * static literal exactly as before.
 */
export function validationDetail(text: string): string | null {
  const match = /^([a-z][a-zA-Z0-9_]{0,39}): ([^\n]{4,160})$/.exec(text.trim());
  const reason = match?.[2];
  if (reason === undefined) return null;
  if (/\bat\s+[\w$]+|\b(select|insert|update|delete|from|where|join|values)\b|:\s|\b(token|secret|password|bearer|authorization|apikey|api_key)\b|:\/\//i.test(reason))
    return null;
  // A sentence we wrote starts with a capital or a Zod word; a raw one rarely does.
  if (!/^(?:[A-Z]|\d|Expected|Too |Invalid|Required|Must |Use )/.test(reason)) return null;
  return reason;
}

/**
 * Maps any thrown error, message string, or `{ success: false, error }`
 * envelope to a safe, renderable UI state. Output strings are static
 * literals — digests, stacks, and raw payloads never pass through.
 */
export function toAppErrorState(input: unknown): AppErrorState {
  const text = coerceText(input);
  const code = extractServerCode(text) ?? "UNKNOWN";
  const state = STATES[code];
  if (code !== "VALIDATION") return state;
  const detail = validationDetail(text);
  return detail ? { ...state, message: `${state.message} ${detail}`, detail } : state;
}
