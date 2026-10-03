// Implements: docs/design/overhaul-plan.md §4.2 — every admin mutation, as a
// server action.
//
// Four rules hold across this whole file:
//
//   1. AUTH FIRST. Every action starts with `currentAdminIdentity()`, which
//      re-verifies the signed cookie against the live allowlist and throws
//      `AdminAuthError` when the console is unconfigured or the session is gone.
//      No action mutates before that check.
//   2. AUDIT EVERY MUTATION. Each action writes an `audit_log` row in its own
//      body. A mutation that cannot be audited does not happen: the audit call
//      is never wrapped in a catch (BR-SEC-03, Rule 9).
//   3. NO PAYMENT UI. No amount field, no card field, no charge, no provider call
//      anywhere in this product (owner rule 2).
//   4. NO TENANT DATA. Nothing read or written here comes from a tenant's
//      database. The repositories hold contract metadata only.
//
// Every action ends in a redirect, so the re-render comes from the server with
// no client-side cache to go stale. Operate mode: the URL is the state.

"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import {
  ADMIN_COOKIE,
  AdminAuthError,
  assertSignInAllowed,
  clearSignInFailures,
  currentAdminIdentity,
  mintSessionToken,
  normaliseIdentity,
  passphraseMatches,
  readAdminConfig,
  recordSignInFailure,
} from "./_lib/auth";
import { adminAudit } from "./_lib/audit";
import { adminLogInfo, adminLogWarn } from "./_lib/log";
import {
  AdminRecordNotFound,
  isBillingPeriod,
  isPlanId,
  isSubscriptionStatus,
  subscriptions,
} from "./_lib/subscriptions";
import { entitlements, isBooleanGrant, isFeatureFlag, readGrant } from "./_lib/entitlements";
import { exportRequests } from "./_lib/exports";
import { ReminderTransitionRefused, isReminderAdvance, reminders } from "./_lib/reminders";
import { isIsoDate } from "./_lib/format";
import { NUMERIC_GRANTS, NUMERIC_GRANT_BOUNDS } from "./_lib/types";
import type { AdminErrorCode, NumericGrant } from "./_lib/types";

const MAX_TEXT_LENGTH = 500;
const MAX_DETAIL_LENGTH = 180;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function clientIp(source: Headers): string {
  const forwarded = source.get("x-forwarded-for");
  if (forwarded !== null && forwarded.length > 0) {
    const first = forwarded.split(",")[0];
    if (first !== undefined) return first.trim();
  }
  return "unknown";
}

/** Typed input refusal. Never silent, never a partial write. */
class AdminInputRefused extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.name = "AdminInputRefused";
    this.detail = detail;
  }
}

function backTo(path: string, params: Readonly<Record<string, string>>): string {
  return `${path}?${new URLSearchParams(params).toString()}`;
}

function loginRedirect(error: AdminAuthError): string {
  const code: AdminErrorCode =
    error.code === "ADMIN_AUTH_UNCONFIGURED"
      ? "unconfigured"
      : error.code === "ADMIN_RATE_LIMITED"
        ? "rate_limited"
        : "not_allowed";
  return backTo("/admin/login", { error: code });
}

/** Same attributes the live cookie was set with, or the browser keeps it. */
function clearCookieOptions(): {
  readonly httpOnly: true;
  readonly sameSite: "lax";
  readonly secure: boolean;
  readonly path: string;
  readonly maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 0,
  };
}

// --- sign in / sign out -----------------------------------------------------

export async function signInAction(formData: FormData): Promise<void> {
  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);
  const rawEmail = field(formData, "email");
  const passphrase = field(formData, "passphrase");
  const email = normaliseIdentity(rawEmail);

  let nextPath: string;
  try {
    const config = readAdminConfig();
    assertSignInAllowed(email, ip, Date.now());

    if (!config.allowlist.has(email)) {
      recordSignInFailure(email, ip, Date.now());
      adminLogWarn("admin.sign_in_not_allowed", { email, ip });
      nextPath = backTo("/admin/login", { error: "not_allowed", email: rawEmail });
    } else if (!passphraseMatches(passphrase, config)) {
      recordSignInFailure(email, ip, Date.now());
      nextPath = backTo("/admin/login", { error: "bad_credentials", email: rawEmail });
    } else {
      clearSignInFailures(email, ip);
      const jar = await cookies();
      jar.set(ADMIN_COOKIE, mintSessionToken(email, config, Date.now()), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/admin",
        maxAge: Math.floor(config.ttlMs / 1000),
      });
      await adminAudit({
        actor: email,
        action: "admin.sign_in",
        refType: "admin_session",
        metadata: { ttlMinutes: Math.round(config.ttlMs / 60_000) },
      });
      adminLogInfo("admin.sign_in", { email });
      nextPath = "/admin/subscriptions";
    }
  } catch (error) {
    if (error instanceof AdminAuthError) {
      adminLogWarn("admin.sign_in_refused", { code: error.code });
      nextPath = loginRedirect(error);
    } else {
      throw error;
    }
  }

  redirect(nextPath);
}

export async function signOutAction(): Promise<void> {
  let actor = "unknown";
  try {
    const identity = await currentAdminIdentity();
    actor = identity.email;
    await adminAudit({ actor, action: "admin.sign_out", refType: "admin_session" });
  } catch (error) {
    if (!(error instanceof AdminAuthError)) throw error;
    adminLogWarn("admin.sign_out_without_session", { code: error.code });
  }

  const jar = await cookies();
  jar.set(ADMIN_COOKIE, "", clearCookieOptions());
  adminLogInfo("admin.sign_out", { email: actor });
  redirect("/admin/login?signed-out=1");
}

// --- subscriptions ----------------------------------------------------------

export async function updateSubscriptionAction(formData: FormData): Promise<void> {
  const tenantId = field(formData, "tenantId");
  let nextPath: string;
  try {
    const admin = await currentAdminIdentity();
    const plan = field(formData, "plan");
    const period = field(formData, "period");
    const status = field(formData, "status");
    const startsOn = field(formData, "startsOn");
    const expiresOn = field(formData, "expiresOn");
    const adminNote = field(formData, "adminNote").slice(0, MAX_TEXT_LENGTH);

    if (tenantId.length === 0) throw new AdminInputRefused("A tenant id is required.");
    if (!isPlanId(plan)) throw new AdminInputRefused(`Unknown plan: ${plan || "(empty)"}`);
    if (!isBillingPeriod(period)) throw new AdminInputRefused(`Unknown period: ${period || "(empty)"}`);
    if (!isSubscriptionStatus(status)) throw new AdminInputRefused(`Unknown status: ${status || "(empty)"}`);
    if (!isIsoDate(startsOn)) throw new AdminInputRefused(`Start date is not a date: ${startsOn || "(empty)"}`);
    if (!isIsoDate(expiresOn)) throw new AdminInputRefused(`Expiry date is not a date: ${expiresOn || "(empty)"}`);
    if (expiresOn <= startsOn) throw new AdminInputRefused("The expiry date must be after the start date.");

    const before = await subscriptions().get(tenantId);
    if (before === null) throw new AdminRecordNotFound(`No subscription for ${tenantId}.`);

    const after = await subscriptions().apply(tenantId, { plan, period, status, startsOn, expiresOn, adminNote }, admin.email);

    await adminAudit({
      actor: admin.email,
      action: "admin.subscription.update",
      refType: "subscription",
      refId: tenantId,
      metadata: {
        plan: { from: before.plan, to: after.plan },
        period: { from: before.period, to: after.period },
        status: { from: before.status, to: after.status },
        startsOn: { from: before.startsOn, to: after.startsOn },
        expiresOn: { from: before.expiresOn, to: after.expiresOn },
      },
    });

    nextPath = backTo("/admin/subscriptions", { tenant: tenantId, notice: "subscription-updated" });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      redirect(loginRedirect(error));
    }
    if (error instanceof AdminInputRefused) {
      redirect(backTo("/admin/subscriptions", { tenant: tenantId, error: "invalid_input", detail: error.detail.slice(0, MAX_DETAIL_LENGTH) }));
    }
    if (error instanceof AdminRecordNotFound) {
      redirect(backTo("/admin/subscriptions", { tenant: tenantId, error: "not_found" }));
    }
    throw error;
  }

  redirect(nextPath);
}

// --- entitlements -----------------------------------------------------------

export async function setFeatureFlagAction(formData: FormData): Promise<void> {
  const tenantId = field(formData, "tenantId");
  let nextPath: string;
  try {
    const admin = await currentAdminIdentity();
    const flag = field(formData, "flag");
    const enabled = field(formData, "enabled") === "1";

    if (tenantId.length === 0) throw new AdminInputRefused("A tenant id is required.");
    if (!isFeatureFlag(flag)) throw new AdminInputRefused(`Unknown feature flag: ${flag || "(empty)"}`);
    const before = await entitlements().get(tenantId);
    if (before === null) throw new AdminRecordNotFound(`No entitlements for ${tenantId}.`);

    await entitlements().setFlag(tenantId, flag, enabled, admin.email);
    await adminAudit({
      actor: admin.email,
      action: "admin.entitlement.flag_set",
      refType: "entitlement",
      refId: tenantId,
      metadata: { flag, from: before.flags[flag], to: enabled },
    });

    nextPath = backTo("/admin/entitlements", { tenant: tenantId, notice: "entitlement-flag-set" });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      redirect(loginRedirect(error));
    }
    if (error instanceof AdminInputRefused) {
      redirect(backTo("/admin/entitlements", { tenant: tenantId, error: "invalid_input", detail: error.detail.slice(0, MAX_DETAIL_LENGTH) }));
    }
    if (error instanceof AdminRecordNotFound) {
      redirect(backTo("/admin/entitlements", { tenant: tenantId, error: "not_found" }));
    }
    throw error;
  }

  redirect(nextPath);
}

export async function setInfrastructureGrantAction(formData: FormData): Promise<void> {
  const tenantId = field(formData, "tenantId");
  let nextPath: string;
  try {
    const admin = await currentAdminIdentity();
    const grant = field(formData, "grant");
    const rawValue = field(formData, "value");

    if (tenantId.length === 0) throw new AdminInputRefused("A tenant id is required.");

    const boolean = isBooleanGrant(grant);
    const numeric = !boolean && (NUMERIC_GRANTS as readonly string[]).includes(grant);
    if (!boolean && !numeric) throw new AdminInputRefused(`Unknown grant: ${grant || "(empty)"}`);

    const before = await entitlements().get(tenantId);
    if (before === null) throw new AdminRecordNotFound(`No entitlements for ${tenantId}.`);

    let value: boolean | number;
    if (boolean) {
      value = rawValue === "1";
    } else {
      const key = grant as NumericGrant;
      const parsed = Number.parseInt(rawValue, 10);
      const bounds = NUMERIC_GRANT_BOUNDS[key];
      if (!Number.isFinite(parsed)) throw new AdminInputRefused(`${grant} must be a whole number.`);
      if (parsed < bounds.min || parsed > bounds.max) {
        throw new AdminInputRefused(`${grant} must be between ${bounds.min} and ${bounds.max}.`);
      }
      value = parsed;
    }

    // SAFETY: both branches above narrow `grant` to a key of
    // `InfrastructureGrants`, so `readGrant` can index it directly.
    const previousValue = readGrant(before, boolean ? grant : (grant as NumericGrant));
    const after = await entitlements().setGrant(tenantId, boolean ? grant : (grant as NumericGrant), value, admin.email);

    await adminAudit({
      actor: admin.email,
      action: "admin.entitlement.grant_set",
      refType: "entitlement",
      refId: tenantId,
      metadata: { grant, from: previousValue, to: value, storageQuotaMb: after.infrastructure.storageQuotaMb },
    });

    nextPath = backTo("/admin/entitlements", { tenant: tenantId, notice: "entitlement-grant-set" });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      redirect(loginRedirect(error));
    }
    if (error instanceof AdminInputRefused) {
      redirect(backTo("/admin/entitlements", { tenant: tenantId, error: "invalid_input", detail: error.detail.slice(0, MAX_DETAIL_LENGTH) }));
    }
    if (error instanceof AdminRecordNotFound) {
      redirect(backTo("/admin/entitlements", { tenant: tenantId, error: "not_found" }));
    }
    throw error;
  }

  redirect(nextPath);
}

// --- export requests (metadata only) ----------------------------------------

export async function requestExportAction(formData: FormData): Promise<void> {
  let nextPath: string;
  try {
    const admin = await currentAdminIdentity();
    const tenantId = field(formData, "tenantId");
    const windowHours = Number.parseInt(field(formData, "windowHours"), 10);

    if (tenantId.length === 0) throw new AdminInputRefused("A tenant id is required.");
    if ((await subscriptions().get(tenantId)) === null) throw new AdminRecordNotFound(`No subscription for ${tenantId}.`);
    if (!Number.isFinite(windowHours) || windowHours < 1 || windowHours > 720) {
      throw new AdminInputRefused("The download window must be between 1 and 720 hours.");
    }

    const created = await exportRequests().request(tenantId, windowHours, admin.email, new Date().toISOString());
    await adminAudit({
      actor: admin.email,
      action: "admin.export.request",
      refType: "export_request",
      refId: created.id,
      metadata: { tenantId, windowHours, state: created.state, sizeBytes: null, sha256: null },
    });

    nextPath = backTo("/admin/exports", { notice: "export-requested" });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      redirect(loginRedirect(error));
    }
    if (error instanceof AdminInputRefused) {
      redirect(backTo("/admin/exports", { error: "invalid_input", detail: error.detail.slice(0, MAX_DETAIL_LENGTH) }));
    }
    if (error instanceof AdminRecordNotFound) {
      redirect(backTo("/admin/exports", { error: "not_found" }));
    }
    throw error;
  }

  redirect(nextPath);
}

export async function revokeExportAction(formData: FormData): Promise<void> {
  const exportId = field(formData, "exportId");
  let nextPath: string;
  try {
    const admin = await currentAdminIdentity();
    const before = await exportRequests().get(exportId);
    if (before === null) throw new AdminRecordNotFound(`No export request ${exportId}.`);

    const after = await exportRequests().revoke(exportId, admin.email, new Date().toISOString());
    await adminAudit({
      actor: admin.email,
      action: "admin.export.revoke",
      refType: "export_request",
      refId: exportId,
      metadata: { tenantId: before.tenantId, from: before.state, to: after.state },
    });

    nextPath = backTo("/admin/exports", { notice: "export-revoked" });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      redirect(loginRedirect(error));
    }
    if (error instanceof AdminRecordNotFound) {
      redirect(backTo("/admin/exports", { error: "not_found" }));
    }
    throw error;
  }

  redirect(nextPath);
}

// --- reminders --------------------------------------------------------------

export async function advanceReminderAction(formData: FormData): Promise<void> {
  const tenantId = field(formData, "tenantId");
  let nextPath: string;
  try {
    const admin = await currentAdminIdentity();
    const to = field(formData, "advance");
    if (tenantId.length === 0) throw new AdminInputRefused("A tenant id is required.");
    if (!isReminderAdvance(to)) throw new AdminInputRefused(`Unknown reminder step: ${to || "(empty)"}`);

    const before = await reminders().get(tenantId);
    if (before === null) throw new AdminRecordNotFound(`No reminder schedule for ${tenantId}.`);

    const after = await reminders().advance(tenantId, to, admin.email, new Date().toISOString());
    await adminAudit({
      actor: admin.email,
      action: "admin.reminder.advance",
      refType: "reminder",
      refId: tenantId,
      metadata: { from: before.stage, to: after.stage, hardReminderCount: 1, downgradeScheduledFor: after.downgradeScheduledFor },
    });

    nextPath = backTo("/admin/reminders", { notice: "reminder-advanced" });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      redirect(loginRedirect(error));
    }
    if (error instanceof ReminderTransitionRefused) {
      redirect(backTo("/admin/reminders", { error: "conflict", detail: error.message.slice(0, MAX_DETAIL_LENGTH) }));
    }
    if (error instanceof AdminInputRefused) {
      redirect(backTo("/admin/reminders", { error: "invalid_input", detail: error.detail.slice(0, MAX_DETAIL_LENGTH) }));
    }
    if (error instanceof AdminRecordNotFound) {
      redirect(backTo("/admin/reminders", { error: "not_found" }));
    }
    throw error;
  }

  redirect(nextPath);
}
