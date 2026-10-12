# 0001. Edge verifies an HMAC PIN proof instead of argon2id

- **Status:** PROPOSED
- **Date:** 2026-10-12
- **Deciders:** owner (approval pending)

## Context

The secure-erase endpoint (`POST /api/v1/security/erase`) is the most
destructive operation in the product. Its gate used to check only that a PIN
was *configured* (`pin_hash` present), which proves nothing about the caller —
any stolen session could erase a tutor's entire institute
(`apps/gateway/routes/security.ts:41-58`).

The blocker to a real check: `settings.pin_hash` is
argon2id (m=64 MiB, t=3, p=2) plus a secret pepper
(`apps/web/src/lib/crypto.ts:15-24`), and the Deno edge runtime has no argon2.
WebCrypto offers PBKDF2/SPHKDF-family primitives only, and the npm `argon2`
package is a native Node addon that will not bundle into an edge isolate
(`apps/gateway/lib/schema.ts:383-390`,
`apps/gateway/routes/attendance.ts:720-724`).

## Decision

The edge verifies knowledge of the PIN with an HMAC proof it *can* compute,
instead of the argon2id hash it cannot:

- The web app computes `pinProof(tenantId, pin) =
  HMAC-SHA256(pepper, "buddysaradhi:pin-proof:v1" : tenantId : pin)` and stores
  it in `settings.pin_proof` (`apps/web/src/lib/crypto.ts:52-68`).
- The edge holds the same derivation (`pinProof` in
  `apps/gateway/lib/crypto.ts:175-192`) and the erase route compares the
  stored proof against the offered proof in constant time
  (`apps/gateway/routes/security.ts:117-155`).
- The proof is domain-separated (fixed `info` prefix, so it can never replay
  as any other HMAC the system produces) and tenant-bound (tenantId inside
  the signed material). Cross-implementation parity is pinned by a
  known-answer vector both runtimes must reproduce
  (`apps/gateway/__tests__/pin-proof-vector.test.ts:19-28`).

## Consequences

**Positive:**

- The erase gate becomes real re-authentication: a stolen session without the
  PIN can no longer destroy a tutor's data (BR-SEC-04, `10_Security.md`
  §18.1).
- The edge stays dependency-free — WebCrypto only, no native addon, no new
  supply-chain surface.
- The stored proof gives an attacker no offline brute-force advantage beyond
  what `pin_hash` already gives; the key never leaves the server
  (`apps/gateway/lib/crypto.ts:163-165`).

**Negative:**

- Two implementations of one derivation must stay byte-identical across
  runtimes nothing connects (format, separator, key resolution). Any silent
  drift locks every tutor out of erase with a 401. Mitigated by the
  known-answer vector test, not eliminated.
- `pin_proof` is nullable and healed at boot; tenants who have not
  re-confirmed their PIN cannot erase until they do — a deliberate
  tightening, but a support-visible behaviour change
  (`apps/gateway/routes/security.ts:63-68`).
- The proof is only as strong as HMAC-SHA256 under a server-side key; it is a
  derived verifier for one destructive path, not a replacement for the
  argon2id credential of record.

## Alternatives Considered

1. **Evaluate argon2id at the edge via a WASM build.** Rejected: a WASM
   argon2 ships a large binary into every edge isolate (cold-start and bundle
   cost on the hottest security path), adds an unaudited crypto
   implementation to the trust boundary, and every upstream WASM release
   becomes a review burden for a gate that must fail closed. HMAC via
   WebCrypto is already in the platform. (UNVERIFIED: no WASM prototype was
   built or measured in-repo; the rejection rests on the above engineering
   judgement, not on a benchmark.)
2. **Keep the presence check and document the risk.** Rejected: a documented
   hole in the most destructive endpoint is still a hole; "erase with no PIN
   at all" was the behaviour being removed, not preserved.
3. **Forward the PIN to the edge and compare against nothing (decorative
   re-auth).** Rejected: a check that cannot fail is worse than no check —
   it reads as coverage that does not exist (AGENTS.md Rule 9).
