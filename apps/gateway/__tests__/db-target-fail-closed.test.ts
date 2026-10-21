// Implements: GW-07 (docs/audit/AUDIT-2026-10-21.md §AUD-005 — "resolveTursoUrl
// / resolveToken silently substituted a different database and credential than
// the HMAC signed") + 10_Security.md §7 (request binding, fail-closed) +
// 10_Security.md §8 (a log line names VARIABLES, never their values) +
// AGENTS.md §2 Rule 9.
//
// THE DEFECT. The gateway takes the tenant database's location and credential
// from the request (`x-db-url` / `x-db-token`), and the request's HMAC
// signature covers exactly those two values. But the resolvers were not
// validators — they were RE-TARGETERS:
//
//   resolveTursoUrl(url)  → returns the DEPLOYMENT's TURSO_DATABASE_URL when
//                            the url is one it does not accept (a `supabase.co`
//                            host, the local project ref, an unknown scheme)
//   resolveToken(token)   → returns the DEPLOYMENT's TURSO_AUTH_TOKEN when
//                            the presented token is 20 characters or fewer
//
// So a request could SIGN one target and RUN against another. The audit proved
// it with `TURSO_DATABASE_URL=libsql://SHARED-ENV-DB.turso.io`: a `x-db-url`
// containing `supabase.co` resolved to the shared deployment database — and
// the schema heal would have installed the append-only ledger triggers on it.
//
// THE FIX. The resolution is total and non-substituting: the target the
// request named is used verbatim, or the request is REFUSED. These tests pin
// every refusal and the two shapes that must still work (the deployment's own
// database, and a caller's own database with its own credential).
//
// The negative control for this file: against the pre-fix `lib/db.ts` — which
// resolved with `resolveTursoUrl`/`resolveToken` and never compared the result
// with what was asked for — the refusal cases below did not refuse, so the
// file fails.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTurso, tursoCacheStats } from "../lib/db.ts";
import { resolveTenantTarget } from "../lib/db-url-policy.ts";
import { AuthError } from "../lib/auth.ts";

const ENV_KEYS = ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "TURSO_TOKEN"] as const;

const DEPLOYMENT_DB = "libsql://shared-env-db.turso.io";
const DEPLOYMENT_CREDENTIAL = "deployment-shared-credential-0123456789";
const TENANT_DB = "https://tenant-db.turso.io";
const TENANT_CREDENTIAL = "tenant-scoped-credential-0123456789";

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("GW-07 — the gateway runs against the target the request signed, or refuses", () => {
  it("REFUSES a database location the resolver would have substituted", () => {
    process.env.TURSO_DATABASE_URL = DEPLOYMENT_DB;
    process.env.TURSO_AUTH_TOKEN = DEPLOYMENT_CREDENTIAL;

    // A `supabase.co` host is exactly the case the audit measured: the
    // resolver used to answer it with the deployment's own database.
    const before = tursoCacheStats().size;
    const err = (() => {
      try {
        getTurso("https://tenant.supabase.co/db", TENANT_CREDENTIAL);
        return null;
      } catch (e) {
        return e;
      }
    })();

    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).status).toBe(400);
    expect((err as AuthError).code).toBe("DB_TARGET_MISMATCH");
    // Nothing was dialled: no client was created for the substituted target.
    expect(tursoCacheStats().size).toBe(before);
  });

  it("REFUSES a credential the resolver would have substituted", () => {
    process.env.TURSO_DATABASE_URL = DEPLOYMENT_DB;
    process.env.TURSO_AUTH_TOKEN = DEPLOYMENT_CREDENTIAL;

    // 20 characters or fewer is what `resolveToken` replaces with the
    // deployment's own credential.
    const before = tursoCacheStats().size;
    expect(() => getTurso(TENANT_DB, "short")).toThrow(/DB_TARGET_MISMATCH/);
    expect(tursoCacheStats().size).toBe(before);
  });

  it("REFUSES the deployment's shared credential against a database the request named", () => {
    // The third case: `index.ts` fills a MISSING `x-db-token` from the
    // environment before the request reaches the resolver, so the resolver's
    // own substitution check cannot see it. The consequence is the same — the
    // deployment's shared credential would be presented to a host the request
    // chose, and the signature never covered that credential.
    process.env.TURSO_DATABASE_URL = DEPLOYMENT_DB;
    process.env.TURSO_AUTH_TOKEN = DEPLOYMENT_CREDENTIAL;

    const before = tursoCacheStats().size;
    expect(() => getTurso(TENANT_DB, DEPLOYMENT_CREDENTIAL)).toThrow(
      /DB_TARGET_MISMATCH/,
    );
    expect(tursoCacheStats().size).toBe(before);
  });

  it("ACCEPTS the deployment's own database and credential (the self-hosted mode)", () => {
    process.env.TURSO_DATABASE_URL = DEPLOYMENT_DB;
    process.env.TURSO_AUTH_TOKEN = DEPLOYMENT_CREDENTIAL;

    const before = tursoCacheStats().size;
    const client = getTurso(DEPLOYMENT_DB, DEPLOYMENT_CREDENTIAL);
    expect(client).toBeTruthy();
    expect(tursoCacheStats().size).toBe(before + 1);
  });

  it("ACCEPTS a caller's own database and credential", () => {
    const before = tursoCacheStats().size;
    const client = getTurso(TENANT_DB, TENANT_CREDENTIAL);
    expect(client).toBeTruthy();
    expect(tursoCacheStats().size).toBe(before + 1);
  });

  it("ACCEPTS the same database named with a different scheme", () => {
    // A Turso database IS its host, so `libsql://x.turso.io` and
    // `https://x.turso.io` are the same database — the deployment's own
    // credential against it is not a substitution.
    process.env.TURSO_DATABASE_URL = DEPLOYMENT_DB;
    process.env.TURSO_AUTH_TOKEN = DEPLOYMENT_CREDENTIAL;

    const decision = resolveTenantTarget(
      "https://shared-env-db.turso.io",
      DEPLOYMENT_CREDENTIAL,
    );
    expect(decision.allowed).toBe(true);
  });

  it("the refusal names the VARIABLES and never their values (10_Security.md §8)", () => {
    process.env.TURSO_DATABASE_URL = DEPLOYMENT_DB;
    process.env.TURSO_AUTH_TOKEN = DEPLOYMENT_CREDENTIAL;

    const decision = resolveTenantTarget(
      "https://tenant.supabase.co/db",
      TENANT_CREDENTIAL,
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("unreachable");
    expect(decision.refusal.requestedVariable).toBe("x-db-url");
    expect(decision.refusal.resolvedVariable).toBe("TURSO_DATABASE_URL");
    // No value of either variable appears in the refusal.
    const rendered = JSON.stringify(decision.refusal);
    expect(rendered).not.toContain("tenant.supabase.co");
    expect(rendered).not.toContain(DEPLOYMENT_DB);
    expect(rendered).not.toContain(TENANT_CREDENTIAL);
    expect(rendered).not.toContain(DEPLOYMENT_CREDENTIAL);
  });
});
