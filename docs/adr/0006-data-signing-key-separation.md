# 0006. Data/signing key separation via loud fallback + opt-in strict mode

- **Status:** PROPOSED
- **Date:** 2026-10-12
- **Deciders:** owner (approval pending)

## Context

`apps/gateway/lib/crypto.ts:25` resolves the transport-encryption key as

```ts
const DATA_KEY = readSecret("DATA_ENCRYPTION_KEY") || HMAC_SECRET;
```

and `apps/web/src/lib/crypto.ts:132` resolves the legacy-backup key as
`DATA_ENCRYPTION_KEY || GATEWAY_SHARED_SECRET`. One secret therefore serves
two unrelated purposes — request authentication/signing and data encryption —
with three consequences (`docs/rfc/gated-review-packet-phases-1-3-4.md`
Phase 3): no domain separation, a single point of compromise (leaking
`GATEWAY_SHARED_SECRET` yields decryption as well as forgery), and coupled
rotation (rotating to fix a signing problem forces a data-encryption rotation
that cannot be applied retroactively to already-encrypted data).

The packet's recommended option — require both secrets at boot and remove the
fallback — is a **breaking change**: `DATA_ENCRYPTION_KEY` is absent in every
deployment on record (the worklog rotation note confirms both sides running on
the documented HMAC fallback), so deleting the `||` refuses boot fleet-wide on
upgrade, and legacy backup files in tutors' hands decrypt only through the
current resolution. This record decides the safe-deploy shape instead.

## Decision

Fallback-not-removal, in three parts, applied identically on both runtimes
(gateway `apps/gateway/lib/crypto.ts`, web `apps/web/src/lib/crypto.ts`):

1. **LOUD fallback.** When the `DATA_*` fallback engages, boot emits
   `crypto.data_key_fallback` naming the missing variable
   (`DATA_ENCRYPTION_KEY`) — never either secret's value. The silent `||` is
   what made this coupling invisible for months; it must never be silent
   again (Rule 9).
2. **`STRICT_KEY_SEPARATION` flag (env, default OFF).** Exactly `"true"` arms
   it, matching the `ALLOW_DEV_AUTH` convention. When ON and
   `DATA_ENCRYPTION_KEY` is unset, boot THROWS — fail-closed in every
   environment, not only when deployed, because the flag is an explicit
   operator declaration that the coupled mode is unacceptable. When OFF,
   behaviour is byte-identical to today (same key bytes, same wire values,
   same error strings).
3. **Manifest version OUTSIDE the envelope.** `backupKeyManifest()`
   (`apps/web/src/lib/crypto.ts`) records `{ envelopeVersion, kdf,
   keyDomain, dataKeyFallback, strictSeparation }` as plaintext JSON
   ALONGSIDE the blob — in the `createBackupAction` response
   `data.manifest` and in the `backup_create` audit metadata — never inside
   the Rule 8 bytes. The envelope is opaque ciphertext by design: a rotation
   tool must learn the KDF/key-domain WITHOUT the passphrase, which it cannot
   do by decrypting first; and the `BSR1 | 0x01 | salt | nonce | tag | ct`
   layout is pinned by byte-exact tests and parsed by offset in every restore
   path. Old files without a manifest are the v1/passphrase form by
   construction.

Enforcement is by test, not by comment:
`apps/gateway/__tests__/key-separation.test.ts` (warn fires on fallback,
STRICT+unset refuses boot in dev AND deployed, STRICT+set round-trips and
proves the data key differs from the signing key, STRICT-off fallback key
bytes equal the HMAC bytes) and
`apps/web/src/__tests__/key-separation.test.ts` (same, plus the legacy-key
separation proof and the manifest shape). The Rule 8 byte-exact suites
(`backup-crypto.test.ts`, `crypto.test.ts`) run unchanged and green —
separation touched key SELECTION, never key USE.

## Consequences

**Positive:**

- Default deploys are byte-identical: same ciphertext capability, same
  `hmacSign` wire values, same fail-closed error when both vars are unset.
  Upgrade-then-arm is a rollout, not a flag day.
- The coupled mode is now observable (`crypto.data_key_fallback` in boot
  logs; `isDataKeyFallback()` / `isStrictKeySeparation()` booleans — never
  secret bytes — for probes) and forbidden on demand.
- A future rotation is migratable: the manifest names the KDF and key domain
  per file, and `dataKeyFallback`/`strictSeparation` record the fleet's
  posture at backup time.

**Negative:**

- Until an operator arms the flag, the coupling persists — loudly, but it
  persists. This record accepts that residual risk deliberately; see the
  arming procedure below.
- One more env var to provision, document (`.env.example`), and rotate. A
  `DATA_ENCRYPTION_KEY` rotation does NOT re-encrypt existing
  transport/legacy ciphertext — it only separates future writes, which the
  manifest makes auditable.
- STRICT mode has no per-file migration: legacy files sealed under the old
  coupled key still need that key to open. Arming STRICT without keeping the
  old value available for restores strands old files — the runbook forbids it.

**Arming procedure (owner runbook):**

1. Mint `DATA_ENCRYPTION_KEY` distinct from `GATEWAY_SHARED_SECRET`
   (≥32 chars, same floor) in every environment — edge secrets, Vercel, local
   `.env.local`.
2. Deploy. Default behaviour is byte-identical; verify the
   `crypto.data_key_fallback` warn DISAPPEARS from boot logs on both runtimes.
3. Flip `STRICT_KEY_SEPARATION=true` and redeploy.
4. Verify: boot succeeds, `backupKeyManifest()` reports
   `{ dataKeyFallback: false, strictSeparation: true }`, backup round-trip
   and legacy-restore smoke tests pass.
5. Only now is the old shared secret independently rotatable for the signing
   domain. NEVER rotate-then-arm in one step: a STRICT boot with the new
   DATA var unset is a self-inflicted outage.

## Alternatives Considered

1. **Remove the fallback; require both secrets at boot** (packet Phase 3
   option 1, originally recommended). Rejected FOR NOW: every running
   deployment lacks `DATA_ENCRYPTION_KEY`, so this refuses boot fleet-wide on
   upgrade with no migration window. It remains the correct END STATE once
   the fleet is armed — a follow-up record flips the default when
   `dataKeyFallback: false` is the observed norm.
2. **HKDF both domains from the one shared secret** (`HKDF(S,
   info="sign"|"data")`, packet option 2). REJECTED for now, two reasons.
   First, it changes fallback-mode wire bytes (a different key feeds the
   PBKDF2/AES path), violating the byte-identical-default requirement this
   phase was authorised under — every existing transport ciphertext and
   legacy backup would need the new derivation to open. Second, rotation
   stays coupled through the shared input, so it buys domain separation
   without buying independent rotation — half the goal. HKDF remains
   ACCEPTED as a future option for single-secret deployments AFTER strict
   mode is the norm, via WebCrypto HKDF only (no new algorithms per §8 #4);
   the `kdf` manifest field is the version point it would key off.
3. **Document the coupling as accepted risk** (packet option 3). Rejected:
   the fix costs one flag and zero wire changes; leaving a known single
   point of compromise unaddressed to save one env var is the wrong trade.
4. **Put `kdf_version` INSIDE the envelope bytes.** Rejected: Rule 8's layout
   is untouchable (byte-exact tests, offset parsing, opaque-ciphertext
   design). The alongside-manifest records the same facts without moving a
   single crypto byte.
