"use client";

// Implements: docs/design/overhaul-plan.md §4.2 — the console's error boundary,
// and the fix for docs/design/marketing-claims-audit.md §2 finding 5: `app/layout.tsx`
// is the root and `app/admin/layout.tsx` is a nested layout (a `.adm-root` <div>,
// not a second <html>), so the ROOT `app/error.tsx` used to wrap `/admin` too. An
// operator hitting a console failure was shown "This page did not load… try again
// / back to the product story" — marketing recovery copy, with a link back to the
// plans page an operator has no reason to visit.
//
// WHY IT IS IN THE CONSOLE'S OWN VOCABULARY. Nothing here imports the marketing
// surface (`@/components/site-state`): the console is pinned to an opaque material
// and its own palette (admin/layout.tsx:29-30), its own 14px type scale and its
// own `.adm-*` vocabulary, and its own rule about what it may say — an admin can
// control infrastructure but can never read a customer's data
// (docs/design/admin-console.md §2). So this file renders metadata and a digest,
// and there is no code path from it to a tenant's rows.
//
// NEXT.js 16 shape, read from the bundled docs
// (next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md):
//   · error boundaries are Client Components;
//   · the retry prop is `unstable_retry` since v16.2.0 (`reset` only clears the
//     boundary without re-fetching, which is wrong for a transient failure);
//   · it wraps `page.js` and every nested layout BELOW it, so the console's own
//     `(console)/layout.tsx` nav is replaced too — hence `adm-standalone`, which
//     spans the full grid instead of landing in the 13rem nav column, exactly as
//     the fail-closed refusal does;
//   · it does NOT wrap `app/admin/layout.tsx` itself, so a throw in the palette or
//     token import still reaches Next's built-in page. That is a config-level
//     failure, not an operator-recoverable one.
//
// NO LOGGING HERE, on purpose. `console.*` is forbidden (AGENTS.md §2 Rule 9), the
// console's logger is gated behind `ADMIN_LOG` and scoped to audited operator
// events, and this is neither. Next already reported the throw to the platform's
// logs; `error.digest` is the operator's half of that pairing, and `error.message`
// is a generic string in production — so the message is never rendered, only the
// digest. This is the only client component the console gains, and it exists only
// because Next requires one: a class component would be worse (Function Components
// only, AGENTS.md §6.1), and the boundary has no way to be a Server Component.

interface AdminErrorProps {
  readonly error: Error & { digest?: string };
  readonly unstable_retry: () => void;
}

export default function AdminError({ error, unstable_retry }: AdminErrorProps) {
  return (
    <main className="adm-main adm-standalone" id="adm-main">
      <div className="adm-state">
        <h1 className="adm-title">The console could not load this view</h1>

        {/* `role="alert"` + a visible label, so the state is not carried by the
            red alone (AGENTS.md §2 Rule 10). Same construction as the fail-closed
            refusal in (console)/layout.tsx:35-39. */}
        <p className="adm-notice adm-notice-bad" role="alert" style={{ marginTop: "0.75rem" }}>
          <strong className="adm-notice-title">Request failed</strong>
          <span className="adm-notice-body">
            Something threw while building this console view. No plan, subscription, entitlement or
            export state was changed, and no customer data was read.
          </span>
        </p>

        <p className="adm-state-body" style={{ marginTop: "0.75rem" }}>
          Retry first: most failures here are a cold start or a dropped connection, and retrying
          re-runs the read. If it keeps failing, the two things worth checking are the console
          environment — <code>ADMIN_EMAILS</code> and <code>ADMIN_SESSION_SECRET</code>, which
          without both refuse every console route rather than letting it open — and the reference
          below.
        </p>

        {error.digest ? (
          <p className="adm-inline-note" style={{ marginTop: "0.5rem" }}>
            Reference: <span className="adm-mono">{error.digest}</span>
          </p>
        ) : null}

        <div className="adm-state-actions">
          <button type="button" className="adm-btn-quiet" onClick={unstable_retry}>
            Retry this view
          </button>
          {/* A real link, not a router call: the console already ships zero
              JavaScript outside this boundary, and one more would be a regression
              of its own. `/admin/login` is where an operator whose session expired
              mid-read goes, and it renders without a session by design. */}
          <a className="adm-btn-quiet" href="/admin/login">
            Sign in again
          </a>
        </div>

        <p className="adm-inline-note" style={{ marginTop: "1rem" }}>
          Admin never sees a tenant&apos;s students, ledger or files. Metadata only.
        </p>
      </div>
    </main>
  );
}