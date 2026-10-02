"use server";

// Implements: web/03_Auth_and_Provisioning.md §1 (Supabase-owned identity);
// 10_Security.md §8 (audited auth events) + §11 (rate limits);
// 12_Business_Rules.md BR-SEC-08; RFC-003 §1 G-AUTH/G-ERR.
//
// Auth-surface server actions (workstream A): password-reset requests
// (rate-limited, redirect-validated, audited) and the credential-health
// check with silent refresh (session-start entry point for deliverable 1).

import { z } from "zod";
import { createSupabaseServer } from "@/lib/supabase/server";
import { auditAction, log } from "@/lib/logger";
import {
  assertSafeRedirectPath,
  buildProvisionUrl,
} from "@/server/auth-errors";
import {
  PASSWORD_RESET_WINDOW,
  authRateLimitKey,
  checkAuthRateLimit,
  getClientIp,
} from "@/server/auth-rate-limit";
import {
  checkCredentialsHealth,
  refreshCredentials,
  type CredentialHealth,
} from "@/server/get-db";

const ResetRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  redirectTo: z.string().max(512).optional(),
});

export interface ResetRequestResult {
  success: boolean;
  error?: string;
  code?: string;
  retryAfterSeconds?: number;
}

/**
 * Password-reset request: Zod-validated → per-IP+email throttled → Supabase
 * `resetPasswordForEmail` with a validated same-origin redirect. Reset-token
 * issuance AND expiry stay Supabase-owned (defaults unmodified — no custom
 * `expiresIn` is set anywhere in this codebase). Always returns success to
 * the caller shape on send (no account enumeration); throttle rejections
 * are the only typed failure. Audits `reset_requested` without PII.
 */
export async function requestPasswordResetAction(input: {
  email: string;
  redirectTo?: string;
}): Promise<ResetRequestResult> {
  const parsed = ResetRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Enter a valid email address.", code: "VALIDATION" };
  }
  const { email } = parsed.data;
  const safeRedirect = assertSafeRedirectPath(parsed.data.redirectTo, "/reset-password");

  const ip = await getClientIp();
  const decision = checkAuthRateLimit(authRateLimitKey(ip, email), PASSWORD_RESET_WINDOW);
  if (!decision.allowed) {
    log.warn("reset_request_rate_limited", "Password-reset throttled", {
      retryAfterSeconds: decision.retryAfterSeconds,
    });
    return {
      success: false,
      error: "Too many reset attempts — try again later.",
      code: "RATE_LIMITED",
      retryAfterSeconds: decision.retryAfterSeconds,
    };
  }

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const redirectTo = base ? `${base}${safeRedirect}` : undefined;

  try {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      // No enumeration: Supabase rarely errors here; surface generically.
      log.warn("reset_request_supabase_failed", "Reset email send failed", {});
      return { success: true };
    }
  } catch (err) {
    log.warn("reset_request_failed", err instanceof Error ? err.message : "reset failed", {});
    return { success: true };
  }

  // Rule 9 + BR-SEC-08: the request is audited server-side (no email/PII —
  // the audit sink must never carry identifiers; abuse signal only).
  auditAction("reset_requested");
  return { success: true };
}

export interface CredentialHealthResult extends CredentialHealth {
  refreshed: boolean;
}

/**
 * Session-start credential check (deliverable 1 entry point): probe stored
 * credentials → on failure attempt ONE silent refresh (Supabase session
 * refresh re-reads `user_metadata`) → return final status with a
 * redirect-back provision URL. Emits only stable G-ERR codes.
 */
export async function getCredentialHealthAction(intentNext?: string): Promise<CredentialHealthResult> {
  const safeIntent = assertSafeRedirectPath(intentNext, "");
  let health = await checkCredentialsHealth(safeIntent || undefined);
  let refreshed = false;
  if (health.status === "expired-invalid" || health.status === "missing-unprovisioned") {
    const attempt = await refreshCredentials();
    refreshed = attempt.refreshed;
    if (refreshed) {
      health = await checkCredentialsHealth(safeIntent || undefined);
    } else if (health.status === "expired-invalid") {
      // Refresh cannot mint a fresh Turso token (web/03 §3.1 — only the
      // provision Edge Function holds the Turso API token). Route to
      // re-provision with intent preserved; token rotation itself is a
      // follow-up (see report §spec gaps).
      health = { ...health, provisionUrl: buildProvisionUrl(safeIntent || undefined) };
    }
  }
  return { ...health, refreshed };
}
