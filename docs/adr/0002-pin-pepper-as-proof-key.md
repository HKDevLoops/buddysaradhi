# 0002. The PIN proof keys off `PIN_PEPPER || GATEWAY_SHARED_SECRET` on both sides

- **Status:** PROPOSED
- **Date:** 2026-10-12
- **Deciders:** owner (approval pending)

## Context

`pinProof` is computed by the web app and verified by the edge, so both sides
must key off the same bytes. They originally did not: the gateway keyed off
`GATEWAY_SHARED_SECRET` alone while the web resolved
`PIN_PEPPER || GATEWAY_SHARED_SECRET` (`apps/web/src/lib/crypto.ts:6-13`).
In any deployment that sets `PIN_PEPPER` — a first-class variable read by
`hashPin` and the TOTP pepper path — every proof mismatched and the erase
endpoint returned 401 for every tutor, permanently and silently. No test
caught it, because each side computed its expectation with its own function
(`apps/gateway/__tests__/pin-proof-vector.test.ts:10-17`).

## Decision

Both sides resolve the proof key with exactly the same precedence —
`PIN_PEPPER || GATEWAY_SHARED_SECRET` — and no new dedicated key is
introduced:

- Web: `resolvePepper()` (`apps/web/src/lib/crypto.ts:6-13`).
- Gateway: `PIN_PEPPER = readSecret("PIN_PEPPER") || HMAC_SECRET`, with the
  precedence contract stated in the comment block
  (`apps/gateway/lib/crypto.ts:28-48`).
- The precedence is enforced, not just documented: the known-answer vector
  test primes one shared secret for both implementations and asserts both
  reproduce the same literal digest, plus a dedicated "honours PIN_PEPPER"
  case
  (`apps/gateway/__tests__/pin-proof-vector.test.ts:19-24,37-42`).

## Consequences

**Positive:**

- Setting `PIN_PEPPER` no longer breaks every proof; the failure mode that
  silently locked tutors out of erase is closed by construction plus test.
- One PIN-derived credential stays bound to one secret: BR-SEC-07 already
  binds the pepper to the argon2id `pin_hash`, so the proof reuses the same
  binding instead of inventing a second one.
- No new secret to provision, rotate, or misconfigure across two runtimes.

**Negative:**

- The proof key and the `pin_hash` pepper are now the same value: rotating
  the pepper invalidates every stored `pin_proof` (tenants must re-confirm
  their PIN) *and* every `pin_hash`. One rotation, two invalidations — the
  coupling is intentional but must be part of any rotation runbook.
- A deployment that sets neither variable fails closed at boot on both sides;
  there is no dev fallback, so local development requires the env to be set
  (`apps/web/src/lib/crypto.ts:8-10`,
  `apps/gateway/lib/crypto.ts:79-82`).

## Alternatives Considered

1. **A new dedicated `PIN_PROOF_KEY`, separate from the pepper.** Rejected:
   a third secret across two runtimes doubles the provisioning and rotation
   surface, and a dedicated key that drifts on one side reproduces exactly
   the silent-401 failure this fixes. The pepper is already the PIN-bound
   secret; reuse it.
2. **Key off `GATEWAY_SHARED_SECRET` alone on both sides (drop the pepper
   fallback).** Rejected: the web's `hashPin` and TOTP paths already treat
   `PIN_PEPPER` as first-class; unifying on the HMAC secret alone would
   require changing the argon2id binding too, widening the blast radius for
   no gain.
3. **Key negotiation or versioned key identifiers.** Rejected: over-engineered
   for a single-tenant system with one proof; the `v1` info prefix already
   reserves a versioning point if the format ever changes.
