// Implements: docs/design/overhaul-plan.md §4.2 — admin sign-in.
//
// The form posts to `signInAction` and nothing runs in the browser: there is no
// client component, no fetch, no client-side role check. Rule 2 holds because
// there is no outbound call to make.
//
// Fail closed, visibly. When ADMIN_EMAILS, ADMIN_SESSION_SECRET or
// ADMIN_SIGNIN_PASSPHRASE is missing the page says so and refuses, rather than
// rendering a form that cannot succeed.

import type { Metadata } from "next";
import Link from "next/link";
import { signInAction } from "../../actions";
import { requireAdminConsole } from "../../_lib/auth";
import { adminLogEnabled } from "../../_lib/log";
import { ADMIN_ERROR_TEXT } from "../../_lib/types";
import type { AdminErrorCode } from "../../_lib/types";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

function isErrorCode(value: string | undefined): value is AdminErrorCode {
  return value !== undefined && value in ADMIN_ERROR_TEXT;
}

export default async function AdminLoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly error?: string; readonly email?: string; readonly ["signed-out"]?: string }>;
}) {
  const guard = await requireAdminConsole();
  const params = await searchParams;

  if (guard.kind === "ok") {
    return (
      <main className="adm-main">
        <p className="adm-lede">
          You are signed in as {guard.admin.email}.{" "}
          <Link className="action" href="/admin/subscriptions">
            Open the subscription list
          </Link>
          .
        </p>
      </main>
    );
  }

  if (guard.kind === "unconfigured") {
    return (
      <main className="adm-main adm-standalone adm-signin">
        <div className="adm-signin-card">
          <h1 className="adm-title">Console not configured</h1>
          <p className="adm-notice adm-notice-bad" role="alert" style={{ marginTop: "0.75rem" }}>
            <strong className="adm-notice-title">Refusing service</strong>
            <span className="adm-notice-body">{guard.message}</span>
          </p>
          <p className="adm-signin-foot">{guard.recovery}</p>
          <p className="adm-signin-foot">
            No admin data is served on this deployment while these are unset. This is the intended fail-closed
            behaviour, not a bug.
          </p>
        </div>
      </main>
    );
  }

  const errorCode = isErrorCode(params.error) ? params.error : null;
  const error = errorCode === null ? null : ADMIN_ERROR_TEXT[errorCode];

  return (
    <main className="adm-main adm-standalone adm-signin">
      <div className="adm-signin-card">
        <h1 className="adm-title">Operations console</h1>
        <p className="adm-lede">Signed in by hand against an environment allowlist. Access is refused when the allowlist or the session secret is missing.</p>

        {params["signed-out"] === "1" ? (
          <p className="adm-notice" role="status" style={{ marginTop: "0.875rem" }}>
            Signed out. The session cookie was cleared and the sign-out was audited.
          </p>
        ) : null}

        {error === null ? null : (
          <p className="adm-notice adm-notice-bad" role="alert" style={{ marginTop: "0.875rem" }}>
            <strong className="adm-notice-title">{error.title}</strong>
            <span className="adm-notice-body">{error.recovery}</span>
          </p>
        )}

        <form className="adm-signin-form" action={signInAction} method="post">
          <div>
            <label className="field-label" htmlFor="admin-email">
              Admin address
            </label>
            <input
              className="input"
              id="admin-email"
              name="email"
              type="email"
              autoComplete="username"
              required
              defaultValue={params.email ?? ""}
            />
            <p className="field-hint">Must appear in ADMIN_EMAILS on this deployment.</p>
          </div>
          <div>
            <label className="field-label" htmlFor="admin-passphrase">
              Passphrase
            </label>
            <input className="input" id="admin-passphrase" name="passphrase" type="password" autoComplete="current-password" required />
          </div>
          <button className="btn btn-primary" type="submit">
            Sign in
          </button>
        </form>

        <p className="adm-signin-foot">
          Every sign-in, every list read and every change is written to the audit log.
          {adminLogEnabled() ? " Structured logging is on for this deployment." : " Structured logging is off on this deployment."}
        </p>
      </div>
    </main>
  );
}