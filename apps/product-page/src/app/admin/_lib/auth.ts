// Implements: docs/design/overhaul-plan.md §4.2 — server-side admin auth.
// Security contract (all of it non-negotiable, from the plan and the owner):
//   - Identity is an env allowlist. ADMIN_EMAILS, comma separated. There is no
//     hardcoded credential anywhere in this tree and no client-side gate.
//   - The session is a signed, httpOnly, SameSite=Lax cookie. It carries no
//     database reference, so it is verifiable with one HMAC and nothing else.
//   - Verification re-reads the allowlist. Removing an address from the env
//     revokes that session on its next request, with no revocation table.
//   - FAIL CLOSED. A missing allowlist, a short secret or a missing passphrase
//     makes every admin route refuse service. There is no fallback identity and
//     no path that returns data while unconfigured.
//
// Rule 2 (no outbound call), Rule 9 (typed errors, nothing swallowed), Rule 10
// (the sign-in form is labelled, focusable and 44px). No em dashes (R-02).

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { adminLogInfo, adminLogWarn } from "./log";

export const ADMIN_COOKIE = "bs_admin_session";
export const SESSION_FORMAT_VERSION = 1;

const MIN_SECRET_CHARS = 32;
const MIN_PASSPHRASE_CHARS = 12;
const DEFAULT_TTL_MINUTES = 480;
const MIN_TTL_MINUTES = 5;
const MAX_TTL_MINUTES = 1440;
const SIGNIN_WINDOW_MS = 15 * 60 * 1000;
const SIGNIN_MAX_FAILURES = 5;
const SIGNIN_LOCK_MS = 15 * 60 * 1000;
const SIGNIN_MAX_KEYS = 4096;

export type AdminAuthErrorCode =
  | "ADMIN_AUTH_UNCONFIGURED"
  | "ADMIN_NOT_ALLOWED"
  | "ADMIN_BAD_CREDENTIALS"
  | "ADMIN_RATE_LIMITED"
  | "ADMIN_SESSION_INVALID"
  | "ADMIN_SESSION_EXPIRED";

/** Typed auth failure. `recovery` is written for the operator who has to fix it. */
export class AdminAuthError extends Error {
  readonly code: AdminAuthErrorCode;
  readonly httpStatus: number;
  readonly recovery: string;

  constructor(code: AdminAuthErrorCode, httpStatus: number, message: string, recovery: string) {
    super(message);
    this.name = "AdminAuthError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.recovery = recovery;
  }
}

export interface AdminIdentity {
  readonly email: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly sessionId: string;
}

export interface AdminConfig {
  readonly allowlist: ReadonlySet<string>;
  readonly sessionSecret: string;
  readonly passphrase: string;
  readonly ttlMs: number;
}

export type AdminGuard =
  | { readonly kind: "ok"; readonly admin: AdminIdentity }
  | { readonly kind: "anonymous" }
  | {
      readonly kind: "unconfigured";
      readonly code: AdminAuthErrorCode;
      readonly message: string;
      readonly recovery: string;
    };

function env(name: string): string {
  const raw = process.env[name];
  return typeof raw === "string" ? raw.trim() : "";
}

/** Normalises an identity for comparison: trimmed, lowercased. */
export function normaliseIdentity(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Reads the admin configuration. Throws `ADMIN_AUTH_UNCONFIGURED` when any of
 * the three secrets is missing or too weak. Callers must handle the throw as a
 * refuse-service condition, never as a reason to fall open.
 */
export function readAdminConfig(): AdminConfig {
  const rawEmails = env("ADMIN_EMAILS");
  if (rawEmails.length === 0) {
    throw new AdminAuthError(
      "ADMIN_AUTH_UNCONFIGURED",
      503,
      "ADMIN_EMAILS is not set, so no identity can be recognised as an admin.",
      "Set ADMIN_EMAILS to a comma separated list of admin addresses on this deployment.",
    );
  }

  const allowlist = new Set<string>();
  for (const part of rawEmails.split(",")) {
    const email = normaliseIdentity(part);
    if (email.length > 0) allowlist.add(email);
  }
  if (allowlist.size === 0) {
    throw new AdminAuthError(
      "ADMIN_AUTH_UNCONFIGURED",
      503,
      "ADMIN_EMAILS is set but contains no usable address.",
      "Set ADMIN_EMAILS to at least one comma separated admin address.",
    );
  }

  const sessionSecret = env("ADMIN_SESSION_SECRET");
  if (sessionSecret.length < MIN_SECRET_CHARS) {
    throw new AdminAuthError(
      "ADMIN_AUTH_UNCONFIGURED",
      503,
      `ADMIN_SESSION_SECRET is missing or shorter than ${MIN_SECRET_CHARS} characters.`,
      `Set ADMIN_SESSION_SECRET to at least ${MIN_SECRET_CHARS} characters of random material.`,
    );
  }

  const passphrase = env("ADMIN_SIGNIN_PASSPHRASE");
  if (passphrase.length < MIN_PASSPHRASE_CHARS) {
    throw new AdminAuthError(
      "ADMIN_AUTH_UNCONFIGURED",
      503,
      `ADMIN_SIGNIN_PASSPHRASE is missing or shorter than ${MIN_PASSPHRASE_CHARS} characters.`,
      `Set ADMIN_SIGNIN_PASSPHRASE to at least ${MIN_PASSPHRASE_CHARS} characters.`,
    );
  }

  const ttlMinutes = clampTtlMinutes(env("ADMIN_SESSION_TTL_MINUTES"));

  return { allowlist, sessionSecret, passphrase, ttlMs: ttlMinutes * 60_000 };
}

function clampTtlMinutes(raw: string): number {
  if (raw.length === 0) return DEFAULT_TTL_MINUTES;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_MINUTES;
  if (parsed < MIN_TTL_MINUTES) return MIN_TTL_MINUTES;
  if (parsed > MAX_TTL_MINUTES) return MAX_TTL_MINUTES;
  return parsed;
}

interface SessionPayload {
  readonly v: number;
  readonly e: string;
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function encodeSession(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

function decodeSession(token: string, secret: string): SessionPayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = sign(body, secret);
  const given = Buffer.from(signature, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  if (given.length !== wanted.length) return null;
  if (!timingSafeEqual(given, wanted)) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    // SAFETY: the checks above prove `parsed` is a non-null object literal, and
    // every field is read through a typeof test before it is used, so a forged
    // payload can only ever yield null, never an unchecked value.
    const candidate = parsed as Partial<SessionPayload>;
    if (candidate.v !== SESSION_FORMAT_VERSION) return null;
    if (typeof candidate.e !== "string" || typeof candidate.jti !== "string") return null;
    if (typeof candidate.iat !== "number" || typeof candidate.exp !== "number") return null;
    return { v: candidate.v, e: candidate.e, iat: candidate.iat, exp: candidate.exp, jti: candidate.jti };
  } catch {
    return null;
  }
}

/** Mints a session token. Exported for tests and for a future identity bridge. */
export function mintSessionToken(email: string, config: AdminConfig, nowMs: number): string {
  const normalised = normaliseIdentity(email);
  const payload: SessionPayload = {
    v: SESSION_FORMAT_VERSION,
    e: normalised,
    iat: nowMs,
    exp: nowMs + config.ttlMs,
    jti: randomUUID(),
  };
  return encodeSession(payload, config.sessionSecret);
}

/**
 * Verifies a token against the live allowlist. Returns null for every failure
 * mode on purpose: a caller must not be able to distinguish a forged signature
 * from an expiry from a revoked identity.
 */
export function verifySessionToken(token: string, config: AdminConfig, nowMs: number): AdminIdentity | null {
  const payload = decodeSession(token, config.sessionSecret);
  if (payload === null) return null;
  if (payload.exp <= nowMs) return null;
  const email = normaliseIdentity(payload.e);
  if (!config.allowlist.has(email)) return null;
  return { email, issuedAt: payload.iat, expiresAt: payload.exp, sessionId: payload.jti };
}

/** Constant-time comparison of a submitted passphrase against the configured one. */
export function passphraseMatches(submitted: string, config: AdminConfig): boolean {
  const a = createHash("sha256").update(submitted, "utf8").digest();
  const b = createHash("sha256").update(config.passphrase, "utf8").digest();
  return timingSafeEqual(a, b);
}

export interface CookieOptions {
  readonly httpOnly: true;
  readonly sameSite: "lax";
  readonly secure: boolean;
  readonly path: string;
  readonly maxAge: number;
}

/**
 * `secure` is true in production and false in development. Development is the
 * only case where the console can be reached over plain http, and a Secure
 * cookie is dropped outright by Firefox and Safari there, which would lock the
 * owner out of their own console during review. Production is always https, so
 * production is always Secure.
 */
export function sessionCookieOptions(config: AdminConfig): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: Math.floor(config.ttlMs / 1000),
  };
}

// --- sign-in throttling -----------------------------------------------------
// Per-instance and in memory, on purpose: the console is a handful of named
// operators on one deployment. A shared deployment needs the gateway rate
// limiter, which the entitlement backend wires in; see docs/design/admin-console.md.

interface AttemptState {
  failures: number;
  windowStartedAt: number;
  lockedUntil: number;
}

const attempts = new Map<string, AttemptState>();

function attemptKey(email: string, ip: string): string {
  return `${normaliseIdentity(email)}|${ip}`;
}

function pruneAttempts(nowMs: number): void {
  for (const [key, state] of attempts) {
    const stale = state.lockedUntil <= nowMs && nowMs - state.windowStartedAt > SIGNIN_WINDOW_MS;
    if (stale) attempts.delete(key);
  }
  if (attempts.size <= SIGNIN_MAX_KEYS) return;
  // Bounded memory: drop the entries whose lock has been over longest.
  const ordered = [...attempts.entries()].sort((a, b) => a[1].lockedUntil - b[1].lockedUntil);
  for (const [key] of ordered) {
    if (attempts.size <= SIGNIN_MAX_KEYS) break;
    attempts.delete(key);
  }
}

/** Throws `ADMIN_RATE_LIMITED` when the address is inside its lock window. */
export function assertSignInAllowed(email: string, ip: string, nowMs: number): void {
  pruneAttempts(nowMs);
  const state = attempts.get(attemptKey(email, ip));
  if (state === undefined) return;
  if (state.lockedUntil > nowMs) {
    throw new AdminAuthError(
      "ADMIN_RATE_LIMITED",
      429,
      "This address is inside a sign-in lock window.",
      "Wait for the lock to clear before trying again.",
    );
  }
}

export function recordSignInFailure(email: string, ip: string, nowMs: number): void {
  pruneAttempts(nowMs);
  const key = attemptKey(email, ip);
  const previous = attempts.get(key);
  const withinWindow = previous !== undefined && nowMs - previous.windowStartedAt <= SIGNIN_WINDOW_MS;
  const failures = withinWindow ? previous.failures + 1 : 1;
  const windowStartedAt = withinWindow && previous !== undefined ? previous.windowStartedAt : nowMs;
  const lockedUntil = failures >= SIGNIN_MAX_FAILURES ? nowMs + SIGNIN_LOCK_MS : 0;
  attempts.set(key, { failures, windowStartedAt, lockedUntil });
  adminLogWarn("admin.sign_in_failure", { email, failures, locked: lockedUntil > 0 });
}

export function clearSignInFailures(email: string, ip: string): void {
  attempts.delete(attemptKey(email, ip));
}

// --- guards -----------------------------------------------------------------

/**
 * Per-request memoised guard for server components. `cache()` keys on the
 * request scope, so the layout and every page below it read the cookie once.
 */
export const requireAdminConsole = cache(async (): Promise<AdminGuard> => {
  let config: AdminConfig;
  try {
    config = readAdminConfig();
  } catch (error) {
    if (error instanceof AdminAuthError) {
      adminLogWarn("admin.auth_unconfigured", { code: error.code });
      return { kind: "unconfigured", code: error.code, message: error.message, recovery: error.recovery };
    }
    throw error;
  }

  const jar = await cookies();
  const raw = jar.get(ADMIN_COOKIE)?.value;
  if (raw === undefined || raw.length === 0) return { kind: "anonymous" };

  const admin = verifySessionToken(raw, config, Date.now());
  if (admin === null) {
    adminLogWarn("admin.session_rejected", {});
    return { kind: "anonymous" };
  }

  adminLogInfo("admin.session_verified", { email: admin.email });
  return { kind: "ok", admin };
});

/** Server-action guard. Throws the typed error instead of rendering a fallback. */
export async function currentAdminIdentity(): Promise<AdminIdentity> {
  const guard = await requireAdminConsole();
  if (guard.kind === "ok") return guard.admin;
  if (guard.kind === "unconfigured") {
    throw new AdminAuthError("ADMIN_AUTH_UNCONFIGURED", 503, guard.message, guard.recovery);
  }
  throw new AdminAuthError(
    "ADMIN_SESSION_INVALID",
    401,
    "The admin session is missing or no longer valid.",
    "Sign in again to continue.",
  );
}