// VENDORED for edge deployability (17_API_Gateway_System.md §5): byte copy of
// `packages/shared/src/redact.ts`, from its first non-comment line onward. The
// Supabase bundler only uploads `supabase/functions/<fn>/` (CI stages
// `apps/gateway/*` into it — see .github/workflows/supabase-ci.yml), so the
// gateway cannot import `../../../packages`: the deploy bundle 400s. Same
// pattern as `vendor/format.ts`, `vendor/outboxPayload.ts`, `vendor/tamper.ts`.
//
// KEEP IN SYNC: the body below is byte-identical to the source. The gateway needs
// `redact` + `sanitizeLogData`; the web logger needs `redactLogContext`. The
// patterns must be ONE set of rules, not two copies that drift.
// `apps/gateway/__tests__/redact-vendor-parity.test.ts` fails when they differ.
// Implements: 10_Security.md §8 (no secret, credential, PIN, email or card
// number in a log line) + AGENTS.md §2 Rule 9.

export const REDACTED = "[REDACTED]";

/** Characters kept from any one string in a log sink. */
export const MAX_LOG_STRING = 500;

/** Nesting levels walked inside a structured log context before it is cut off. */
export const MAX_LOG_DEPTH = 6;

/**
 * Card numbers, precisely.
 *
 * The previous pattern was `/(?<!\d)(?:\d{4}[- ]){3}\d{4}(?!\d)/g` — any 16-digit
 * run. It was over-broad in the direction that matters: it ate student ids,
 * Turso shard suffixes, and 16-digit timestamps, while a real card in 4-6-5
 * grouping, a 13-digit Visa, or any Amex/Discover/RuPay length sailed through
 * untouched. A redaction that is noisy on harmless input and silent on the
 * thing it is for is worse than none: a log full of `[REDACTED]` reads as safe,
 * so nobody looks.
 *
 * Now: a candidate run of 13–19 digits (optionally grouped by space or dash)
 * is matched, its issuer prefix is checked, and the digits are verified with
 * the Luhn checksum. A real PAN has a ~1-in-10 chance of passing Luhn by
 * accident, so the issuer prefix is checked too. Everything else — including
 * every 16-digit non-PAN — is left alone.
 */

/** Issuer prefixes (ISO/IEC 7812), as tested against the digits of the PAN.
 *  Each alternative must total the family's exact length — 13/16/19 for Visa,
 *  16 for Mastercard/Discover/RuPay, 15 for Amex/Diners. A prefix pattern of the
 *  wrong length is a silent hole, so the length is asserted by the test file
 *  (`apps/gateway/__tests__/log-redaction.test.ts`) against a real PAN per family. */
const CARD_PREFIXES: readonly RegExp[] = [
  /^4\d{12}(?:\d{3})?(?:\d{3})?$/, // Visa, 13 or 16
  /^5[1-5]\d{14}$/, // Mastercard 51–55, 16
  // Mastercard 2-series, BIN range 222100–272099, always 16.
  /^2(?:22[1-9]\d{12}|[3-6]\d{14}|7[01]\d{13}|720\d{12})$/,
  /^3[47]\d{13}$/, // American Express, 15
  // Discover: 6011, 622126–622925, 644–649, 65.
  /^6(?:011\d{12}|22\d{13}|[45]\d{14})$/,
  /^6(?:0|5)\d{14}$/, // RuPay 60/65, 16
  /^8(?:1[2-9]\d{12})\d$/, // RuPay 81/82
  /^3(?:0\d{14}|3\d{14})$/, // Diners Club, 16
];

/** A 13–19 digit run, optionally grouped by single spaces or dashes. */
const CARD_CANDIDATE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;

/** Luhn mod-10 check over the digits of a candidate. */
function passesLuhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function isCardNumber(candidate: string): boolean {
  const digits = candidate.replace(/[ -]/g, "");
  return CARD_PREFIXES.some((p) => p.test(digits)) && passesLuhn(digits);
}

/**
 * The card patterns run as a replacer FUNCTION, not a plain regex, so the Luhn
 * check can reject a false positive instead of redacting it. `SENSITIVE_PATTERNS`
 * below is everything else, applied in order after this.
 */
const CARD_REDACTOR = (input: string): string =>
  input.replace(CARD_CANDIDATE, (match) => (isCardNumber(match) ? REDACTED : match));

const SENSITIVE_PATTERNS: readonly RegExp[] = [
  // A bearer/basic credential rides AFTER a space, so the `key: value` patterns
  // below only eat the SCHEME word and leave the token itself in cleartext —
  // `authorization: Bearer eyJhbGci...` logged the JWT verbatim. This runs
  // first and eats the whole credential (same rule as lib/errors.ts `sanitizeError`).
  /Bearer\s+[A-Za-z0-9\-._~+/=]+/g,
  /(?:password|passwd|pwd)\s*[:=]\s*\S+/gi,
  /(?:secret|token|key|apikey|api_key)\s*[:=]\s*\S+/gi,
  /(?:authorization|auth)\s*[:=]\s*\S+/gi,
  /(?:x-db-token|x-db-url)\s*[:=]\s*\S+/gi,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  // SSN (kept, now bounded). The previous form `[-.\s]?` made the separators
  // OPTIONAL, which meant the 9-digit window matched INSIDE any longer digit run:
  // `9876543210987654` had its first 10 digits eaten as if they were an SSN +
  // partial phone. Requiring the canonical `-`/`.` separators and refusing to
  // start or end next to a digit or dash confines it to a real SSN shape, and it
  // no longer collides with a 13–19 digit card candidate or with an ISO date
  // (`2026-01-04` has no 3-digits-then-separator run).
  /(?<![\d-])\d{3}[-.]\d{2}[-.]\d{4}(?![\d-])/g,
  // INDIAN mobile (kept, and now specific): 10 digits starting 6–9, optionally
  // `+91`/`91` prefixed. This is genuinely ambiguous with a 10-digit numeric id,
  // and that ambiguity is the right way round — erring toward redacting an id
  // costs a log line, erring the other way prints a tutor's phone number.
  /(?<!\d)(?:\+?91[-\s]?)?[6-9]\d{9}(?!\d)/g,
  /libsql:\/\/[^\s]+/gi,
  /https?:\/\/[^\s]*@[^\s]+/gi,
];

/** Redact one string. Exported (and pure) so the redaction contract is directly
 * testable — a suite that re-implements logging locally never exercises the real
 * patterns at all. */
export function redact(input: string): string {
  let clean = CARD_REDACTOR(input);
  for (const pattern of SENSITIVE_PATTERNS) {
    clean = clean.replace(pattern, REDACTED);
  }
  return clean;
}

function truncate(clean: string): string {
  return clean.length > MAX_LOG_STRING ? clean.substring(0, MAX_LOG_STRING) + "..." : clean;
}

/**
 * The gateway's flat entry sanitizer: strings are redacted and truncated, an
 * object value collapses to `[OBJECT]` so a payload is never dumped, and
 * numbers / booleans / null pass through untouched. Kept byte-compatible with
 * `apps/gateway/__tests__/log-redaction.test.ts`.
 */
export function sanitizeLogData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      sanitized[key] = truncate(redact(value));
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = "[OBJECT]";
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// ---------------------------------------------------------------------------
// Structured log contexts (`apps/web/src/lib/logger.ts` → `audit_log`)
//
// `redact` alone is not enough for a context object. It works on a STRING, so a
// caller can still hand the logger `{ E2E_PASSWORD: "hunter2" }` — the value is a
// bare word with no `password:` prefix in front of it and sails through. Three
// extra gates close that, in order:
//
//   1. KEY GATE — a context key that names a credential drops its value whole,
//      whatever the value's type or shape. This is what catches `E2E_PASSWORD`,
//      `instituteEmail`, `pin`, `accessToken`.
//   2. UUID GATE — a bare UUID under any key that is not an allow-listed
//      correlation id is dropped. Correlation ids (`studentId`, `tenantId`,
//      `entryId`, …) are what an audit row is FOR, so they survive; anything else
//      shaped like an opaque handle is treated as a capability, not a reference.
//   3. VALUE GATE — every surviving string is redacted by `redact` above, so a
//      secret pasted into a "safe" key (`{ note: "password: hunter2" }`) is still
//      eaten.
// ---------------------------------------------------------------------------

/**
 * Substrings of a normalised context key (lower-cased, non-alphanumerics
 * stripped) that mean "this value is a credential or direct PII — never log it".
 * Deliberately fail-closed: a false positive costs one log line, a false negative
 * puts a tutor's PIN in a persisted table.
 */
const SENSITIVE_KEY_FRAGMENTS: readonly string[] = [
  "password",
  "passwd",
  "passphrase",
  "pwd",
  "secret",
  "token",
  "apikey",
  "authorization",
  "authheader",
  "bearer",
  "credential",
  "cookie",
  "csrf",
  "xsrf",
  "otp",
  "salt",
  "nonce",
  "signature",
  "pincode",
  "passcode",
  "email",
  "phone",
  "mobile",
  "ssn",
  "aadhaar",
  "cvv",
  "cvn",
  "iban",
  "card",
  "dbtoken",
  "dburl",
  "databaseurl",
  "libsqlurl",
  "accesskey",
  "privatekey",
  "signingkey",
  "encryptionkey",
];

/** Keys that END in one of these words are credentials whatever else they say. */
const SENSITIVE_KEY_SUFFIX = /(?:key|token|secret|password|passphrase|credential|otp|salt|nonce|signature|cookie|pin)$/i;

/**
 * The only context keys whose values are treated as known-safe correlation ids.
 * These are the identifiers the audit trail exists to join on (`LogContext`: "ids,
 * counts, status codes"); a UUID parked under any other key is an opaque handle
 * and is redacted.
 */
const SAFE_ID_KEYS: ReadonlySet<string> = new Set([
  "id",
  "refid",
  "ref",
  "tenantid",
  "userid",
  "tutorid",
  "studentid",
  "guardianid",
  "entryid",
  "entryidtovoid",
  "reversesentryid",
  "invoiceid",
  "paymentid",
  "receiptid",
  "batchid",
  "sessionid",
  "attendanceid",
  "requestid",
  "logid",
  "parentid",
  "tagid",
  "documentid",
  "noteid",
  "settingsid",
]);

/** RFC 4122 canonical 8-4-4-4-12 form, any version, either case. */
const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

/** Gate 1 — does this key name a credential or direct PII? */
export function isSensitiveLogKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (normalized === "") return true;
  for (const fragment of SENSITIVE_KEY_FRAGMENTS) {
    if (normalized.includes(fragment)) return true;
  }
  return SENSITIVE_KEY_SUFFIX.test(normalized);
}

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Redact one arbitrary context value to something `JSON.stringify` can emit
 * without throwing and without leaking. Depth- and cycle-bounded: a log call must
 * never be the thing that crashes a request (Rule 9).
 *
 * `allowUuid` is set only for an allow-listed correlation-id key, whose value is
 * a UUID by design (`studentId`, `tenantId`, `entryId`, …).
 */
export function redactLogValue(
  value: unknown,
  depth = 0,
  seen?: WeakSet<object>,
  allowUuid = false,
): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    // An allow-listed correlation id is carried verbatim (that is the point of
    // the audit row) but still bounded, so a pathological value cannot bloat a
    // table. Everything else is UUID-checked, then redacted, then bounded.
    if (allowUuid) {
      return value.length > MAX_LOG_STRING
        ? value.substring(0, MAX_LOG_STRING) + "..."
        : value;
    }
    if (UUID_SHAPE.test(value)) return REDACTED;
    return truncate(redact(value));
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : REDACTED;
  }
  if (typeof value === "boolean") return value;
  // bigint throws in JSON.stringify; a log call must not become the crash.
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return "[FUNCTION]";
  if (typeof value === "symbol") return "[SYMBOL]";

  const visited = seen ?? new WeakSet<object>();
  if (visited.has(value)) return "[CIRCULAR]";
  if (depth >= MAX_LOG_DEPTH) return "[MAX_DEPTH]";

  visited.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactLogValue(item, depth + 1, visited));
    }
    if (value instanceof Date) {
      return truncate(redact(value.toISOString()));
    }
    if (value instanceof Error) {
      return {
        name: value.name,
        message: truncate(redact(value.message)),
      };
    }
    if (!isPlainObject(value)) {
      return "[UNSERIALIZABLE]";
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = isSensitiveLogKey(key)
        ? REDACTED
        : redactLogValue(item, depth + 1, visited, SAFE_ID_KEYS.has(normalizeKey(key)));
    }
    return out;
  } finally {
    visited.delete(value);
  }
}

/**
 * The single entry point for a structured log context. `apps/web/src/lib/logger.ts`
 * calls this inside its entry builder, so redaction cannot be bypassed by a call
 * site — neither the string it prints nor the object it POSTs to `audit_log`.
 */
export function redactLogContext(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (context === undefined) return {};
  const visited = new WeakSet<object>();
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    out[key] = isSensitiveLogKey(key)
      ? REDACTED
      : redactLogValue(value, 1, visited, SAFE_ID_KEYS.has(normalizeKey(key)));
  }
  return out;
}
