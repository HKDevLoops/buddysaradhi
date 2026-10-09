// Implements: 10_Security.md §3 (AUTH-1 fail-closed) — the single definition of
// "are we deployed?".
//
// Implements: AGENTS.md §8 — stop-and-ask; this predicate decides whether the
// mock-token auth bypass and the secret-strength gates are active, so getting it
// wrong is an authentication bypass rather than a lint failure.
//
// WHY THIS FILE EXISTS. The predicate had FOUR copies with two different
// semantics:
//
//   lib/auth.ts    DENO_DEPLOYMENT_ID                              (loose)
//   lib/errors.ts  DENO_DEPLOYMENT_ID || DENO_ENV==="production"   (strict)
//   lib/crypto.ts  DENO_DEPLOYMENT_ID || DENO_ENV==="production"   (strict)
//   index.ts       DENO_DEPLOYMENT_ID || DENO_ENV==="production"   (strict)
//
// The loose one gated the `mock-token-*` bypass. `DENO_DEPLOYMENT_ID` is set by
// the Supabase/Deno Deploy edge specifically, so ANY self-hosted deployment —
// including one explicitly running with `DENO_ENV=production` — evaluated it
// false and served the mock-token path, which authenticates by trusting a header
// the caller chooses. That is an unauthenticated read of a real tenant's books
// in exactly the deployment an operator is most likely to stand up themselves.
//
// Strictness is the safe direction to err: the cost of a false positive is that a
// developer must set DENO_ENV=production to see the mock path; the cost of a false
// negative is an open auth bypass. So the strict form wins, and this module
// exists so the next caller cannot pick the other one by accident.

/** True when running on any real deployment, edge or self-hosted. */
export function isDeployed(): boolean {
  if (typeof Deno === "undefined") return false;
  return Boolean(Deno.env.get("DENO_DEPLOYMENT_ID")) ||
    Deno.env.get("DENO_ENV") === "production";
}

/** Local development only. The inverse of {@link isDeployed}. */
export function isLocalDev(): boolean {
  return !isDeployed();
}

/**
 * Is the caller-CONTROLLED dev-auth path (`mock-token-<tenant>`) permitted?
 *
 * WHY OPT-IN RATHER THAN OPT-OUT. That path authenticates by trusting an
 * `x-tutor-id` header the caller chooses — it is authentication that trusts the
 * caller, which is the definition of a bypass. It used to be gated by
 * `if (!isDeployed())`, i.e. OPEN unless the environment looked production. That
 * fails OPEN: a real deployment with `DENO_ENV` unset and no
 * `DENO_DEPLOYMENT_ID` served it. The web app independently gates its own
 * `mock-token` minting on `NODE_ENV === "production"`, so the same mistake in a
 * third variable on the other side of the wire reopened it.
 *
 * The only safe shape is CLOSED unless an operator deliberately turns it on.
 * Forgetting the variable must fail safe (dev auth off); setting it must be a
 * conscious act. The deployment signal is re-checked as well, so a stray flag in
 * a real deployment still cannot open it — belt and braces, because this is the
 * one code path in the gateway where the request itself supplies the identity.
 *
 * 10_Security.md §3 (AUTH-1), fail-closed. AGENTS.md §2 Rule 9.
 */
export function isDevAuthEnabled(): boolean {
  if (typeof Deno === "undefined") return false;
  if (Deno.env.get("ALLOW_DEV_AUTH") !== "true") return false;
  // Belt and braces: never serve caller-supplied identity on a real deployment,
  // even if the flag is set there.
  return !isDeployed();
}