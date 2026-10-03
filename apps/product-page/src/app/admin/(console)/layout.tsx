// Implements: docs/design/overhaul-plan.md §4.2 — the auth-gated console shell.
//
// This layout is the guard for every console view. Nothing under `(console)/`
// renders data unless `requireAdminConsole()` returned an identity, and that
// identity has already been re-checked against the live ADMIN_EMAILS allowlist,
// so removing an address from the env revokes the session on the next navigation
// with no revocation table.
//
// Fail closed in both directions:
//   unconfigured -> renders a refusal screen and serves no data. It does NOT
//                   redirect: redirecting to a login that cannot work is how a
//                   broken console gets mistaken for an open one.
//   anonymous    -> redirected to /admin/login.
//
// The only client component in the whole console is `NavLinks`, because
// `aria-current` needs the pathname and a Server Component cannot read its own
// URL. Everything else is server-rendered HTML, native forms and real links, so
// the console works from the keyboard with scripts disabled.

import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { signOutAction } from "../actions";
import { requireAdminConsole } from "../_lib/auth";
import { adminLogEnabled } from "../_lib/log";
import { NavLinks } from "./nav-links";

export default async function AdminConsoleLayout({ children }: { readonly children: ReactNode }) {
  const guard = await requireAdminConsole();

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
            Condition {guard.code}. The expected status for this condition is 503. The status code is emitted by the
            route layer rather than by this layout; see docs/design/admin-console.md.
          </p>
        </div>
      </main>
    );
  }

  if (guard.kind === "anonymous") {
    redirect("/admin/login");
  }

  return (
    <>
      <nav className="adm-nav" aria-label="Console">
        <div className="adm-nav-brand">
          <span className="adm-nav-title">Buddysaradhi ops</span>
          <span className="adm-nav-sub">Prepaid plans, contracted by hand</span>
        </div>
        <NavLinks />
        <div className="adm-nav-foot">
          <p className="adm-who">
            <strong>Signed in</strong>
            <span>{guard.admin.email}</span>
            <span>{adminLogEnabled() ? "Admin logging on" : "Admin logging off"}</span>
          </p>
          <form action={signOutAction} method="post">
            <button className="adm-btn-quiet" type="submit">
              Sign out
            </button>
          </form>
          <p className="adm-inline-note">
            Admin never sees a tenant&apos;s students, ledger or files. Metadata only.
          </p>
        </div>
      </nav>

      <a className="adm-skip" href="#adm-main">
        Skip to content
      </a>

      <main className="adm-main" id="adm-main">
        {children}
      </main>
    </>
  );
}