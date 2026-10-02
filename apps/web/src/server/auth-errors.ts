// Implements: web/03_Auth_and_Provisioning.md §8 (failures & recovery);
// RFC-003 §1 G-ERR (typed error taxonomy); 10_Security.md §8 (audit of auth
// events); 12_Business_Rules.md BR-SEC-08.
//
// Server-side error EMITTER for workstream A. The code union lives in
// `@/lib/app-errors` (workstream D's UI mapper is the single owner of the
// code list); this module only emits `CODE: detail` strings the UI can map.
// Auth functions must never throw bare `Error("...")` strings — always an
// `AuthError` (or a `{ success: false, error, code }` envelope carrying one
// of these codes).

import { APP_ERROR_CODES, type AppErrorCode } from "@/lib/app-errors";

/** Codes this workstream emits. The G-ERR four are shared with the UI
 * mapper; PIN_* / RATE_LIMITED are workstream-A emissions the UI maps to
 * UNKNOWN until workstream D adds states (see report). */
export const AUTH_ERROR_CODES = [
  "AUTH_REQUIRED",
  "DB_NOT_PROVISIONED",
  "CREDENTIALS_EXPIRED",
  "NEEDS_PROVISION",
  "PIN_INVALID",
  "PIN_LOCKED",
  "PIN_WIPE_REQUIRED",
  "RATE_LIMITED",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

/** Compile-time guard: every G-ERR code we emit must exist in the UI mapper. */
const G_ERR_SHARED: AppErrorCode[] = [
  "AUTH_REQUIRED",
  "DB_NOT_PROVISIONED",
  "CREDENTIALS_EXPIRED",
  "NEEDS_PROVISION",
];
for (const code of G_ERR_SHARED) {
  if (!APP_ERROR_CODES.includes(code)) {
    throw new Error(`G-ERR drift: ${code} missing from lib/app-errors`);
  }
}

const DEFAULT_DETAIL: Record<AuthErrorCode, string> = {
  AUTH_REQUIRED: "No session — sign in again.",
  DB_NOT_PROVISIONED: "User database is not yet provisioned.",
  CREDENTIALS_EXPIRED: "Database credentials expired or rejected.",
  NEEDS_PROVISION: "Database setup is required before continuing.",
  PIN_INVALID: "Incorrect PIN.",
  PIN_LOCKED: "Too many wrong PIN attempts — try again later.",
  PIN_WIPE_REQUIRED: "PIN brute-force threshold reached — local cache wipe required.",
  RATE_LIMITED: "Too many attempts — try again later.",
};

/** Typed auth failure. `detail` must be a static string — never a token,
 * email, URL credential, or raw upstream payload (Rule 9, 10_Security.md §8). */
export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, detail?: string) {
    super(`${code}: ${detail ?? DEFAULT_DETAIL[code]}`);
    this.name = "AuthError";
    this.code = code;
  }
}

export function authError(code: AuthErrorCode, detail?: string): AuthError {
  return new AuthError(code, detail);
}

const CODE_PREFIX_RE = /^\s*([A-Z][A-Z0-9_]{2,40})\s*[:\-–]\s*/;

/** Extracts a stable `AuthErrorCode` from an `AuthError`, a `CODE: ...`
 * message, or a `{ success: false, error, code }` envelope. Never throws. */
export function parseAuthErrorCode(err: unknown): AuthErrorCode | null {
  if (err instanceof AuthError) return err.code;
  let text = "";
  if (typeof err === "string") {
    text = err;
  } else if (err instanceof Error) {
    text = err.message;
  } else if (typeof err === "object" && err !== null) {
    const rec = err as Record<string, unknown>;
    if (typeof rec.code === "string") text = rec.code;
    else if (typeof rec.error === "string") text = rec.error;
  }
  const m = CODE_PREFIX_RE.exec(text);
  if (m?.[1] && (AUTH_ERROR_CODES as readonly string[]).includes(m[1])) {
    return m[1] as AuthErrorCode;
  }
  const bare = text.trim();
  if ((AUTH_ERROR_CODES as readonly string[]).includes(bare)) {
    return bare as AuthErrorCode;
  }
  return null;
}

/**
 * Validates a redirect-back target (no open redirect).
 * Accepts same-origin paths only: must start with exactly one `/`, must not
 * contain `\`, a scheme (`:` before any `/`), or whitespace/control chars.
 * Anything else → `fallback`. (10_Security.md §11; RFC-003 G-AUTH.)
 */
export function assertSafeRedirectPath(raw: unknown, fallback = "/dashboard"): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  // Reject absolute URLs and schemes smuggled into the path (`/\\`, `java\t...`).
  const beforeSlash = raw.split("/")[0] ?? "";
  if (beforeSlash.includes(":")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\s\x00-\x1f\x7f]/.test(raw)) return fallback;
  if (/^\/[a-z]+:/i.test(raw)) return fallback;
  return raw;
}

/**
 * Re-provision URL preserving caller intent: expired/missing credentials
 * route here with `?next=<safe-path>` so the provision page can send the
 * tutor back after setup. Never links off-origin.
 * (web/03_Auth_and_Provisioning.md §3.4 manual-retry path.)
 */
export function buildProvisionUrl(next?: unknown): string {
  const safe = assertSafeRedirectPath(next, "");
  if (!safe || safe === "/signup/provision") return "/signup/provision";
  return `/signup/provision?next=${encodeURIComponent(safe)}`;
}

/** Probe-failure classification for the Turso `SELECT 1` health check.
 * auth-like rejections → `expired-invalid`; transport/timeout → `transient`
 * (must NOT route an offline tutor to re-provision). */
const CREDENTIAL_AUTH_RE =
  /401|403|unauthori[sz]ed|forbidden|invalid (auth |token|credential)|expired|jwt|token.*(invalid|expired|revoked)|auth.*fail/i;

export function classifyCredentialProbeError(err: unknown): "expired-invalid" | "transient" {
  const text =
    err instanceof Error ? `${err.message} ${"cause" in err ? String((err as { cause?: unknown }).cause) : ""}` : String(err);
  return CREDENTIAL_AUTH_RE.test(text) ? "expired-invalid" : "transient";
}
