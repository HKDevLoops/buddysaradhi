interface LogEntry {
  ts: string;
  level: "info" | "warn" | "error";
  event: string;
  tenantId?: string;
  path?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  cacheHit?: boolean;
  queryCount?: number;
  errorCode?: string | null;
  message?: string;
  [key: string]: unknown;
}

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
 *  (`log-redaction.test.ts`) against a real PAN per family. */
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
  input.replace(CARD_CANDIDATE, (match) => (isCardNumber(match) ? "[REDACTED]" : match));

const SENSITIVE_PATTERNS = [
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
 * testable — the previous suite re-implemented logging locally and never
 * exercised the real patterns at all. */
export function redact(input: string): string {
  let clean = CARD_REDACTOR(input);
  for (const pattern of SENSITIVE_PATTERNS) {
    clean = clean.replace(pattern, "[REDACTED]");
  }
  return clean;
}

export function sanitizeLogData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      let clean = redact(value);
      if (clean.length > 500) {
        clean = clean.substring(0, 500) + "...";
      }
      sanitized[key] = clean;
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = "[OBJECT]";
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function emit(
  level: LogEntry["level"],
  event: string,
  data: Record<string, unknown> = {},
): void {
  const sanitizedData = sanitizeLogData(data);
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...sanitizedData,
  };
  try {
    Deno.stdout.writeSync(
      new TextEncoder().encode(JSON.stringify(entry) + "\n"),
    );
  } catch {
    // Silently fail if stdout is not available
  }
}

export function logInfo(
  event: string,
  data: Record<string, unknown> = {},
): void {
  emit("info", event, data);
}

export function logWarn(
  event: string,
  data: Record<string, unknown> = {},
): void {
  emit("warn", event, data);
}

export function logError(
  event: string,
  data: Record<string, unknown> = {},
): void {
  emit("error", event, data);
}
