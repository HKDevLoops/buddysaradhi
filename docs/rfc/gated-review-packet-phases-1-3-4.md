# GATED REVIEW PACKET — Phases 1, 3, 4 (NOT EXECUTED)

> **Status: awaiting human sign-off. Nothing in this document has been implemented.**
> Per `AGENTS.md` §8, each phase below trips a stop-and-ask trigger. This packet
> exists so the decision is a review, not a re-investigation: every claim is
> `file:line` verifiable, and each phase states the options with a recommendation.
>
> Phases 2, 5 and 6 were ungated and ARE shipped (see the commit for this change).

---

## Phase 1 — Spec numbering / documentation integrity

**Trigger:** §8 #6 — any change to the spec corpus or `AGENTS.md`.
**Risk:** renaming spec files breaks every `§N` cross-reference in the codebase,
the worklog and the RFCs. A wrong rename silently invalidates citations.

### Finding (verified)

Six files, three numbers, two files each. `00`–`20` are unique; `21`, `22`, `23`
each collide:

| Number | File A | File B |
|---|---|---|
| 21 | `21_Automation_Testing.md` (80,890 B) | `21_Redis_Caching_Layer.md` (38,275 B) |
| 22 | `22_Redundancy_Audit.md` (78,267 B) | `22_Vector_Search_System.md` (35,536 B) |
| 23 | `23_Complexity_Guarantees.md` (23,937 B) | `23_Security_Harness_Plan.md` (130,801 B) |

### Why it matters

`AGENTS.md` §0.3 and §17 cite these by number (`23_Security_Harness_Plan.md §5`,
`22_Redundancy_Audit.md`). With two `23_*` files, "`23 §5`" is ambiguous, and
`git log --follow` on a number is ambiguous. Two readers can cite the same
section reference meaning different documents.

### Options

1. **Renumber to 24–26** (recommended). Assign the six files 21, 22, 23, 24, 25, 26
   and update every cross-reference repo-wide.
   - Pro: restores the invariant "one number = one document"; matches `§17`.
   - Con: a large mechanical diff touching `AGENTS.md` and many specs — needs the
     two-reviewer gate §5.4 requires for `AGENTS.md` edits.
2. **Namespace by domain** — e.g. `platform/21_*` vs `systems/23_*`.
   - Pro: no renumbering churn.
   - Con: `§17`'s flat index no longer works; more structural change for the same
     problem.
3. **Leave as-is, document the collision in `22_Redundancy_Audit.md`.**
   - Pro: zero churn.
   - Con: ambiguity is preserved and must be remembered by every future agent.

**Recommendation:** Option 1, as a dedicated PR with a mechanical
find-and-replace pass and a verification script that fails if any `§NN` reference
is ambiguous. Not started.

### Separate Phase 1 finding — `ALLOW_DEV_AUTH`

`ALLOW_DEV_AUTH` is referenced in the spec corpus and honoured in code, but it is
not documented in `AGENTS.md` as a required env var. A dev-only authentication
bypass that bypasses authentication is a security-relevant switch; it needs an
explicit, auditable home. **Not changed** — see Phase 4, which owns it.

---

## Phase 3 — Cryptographic key separation

**Trigger:** §8 #4 — changing the crypto envelope or key derivation.
**Risk:** a mistake here either bricks every existing backup or silently weakens
key separation. This is a **one-way door**: existing envelopes cannot be
re-encrypted without the old passphrase.

### Finding (verified)

`apps/gateway/lib/crypto.ts:25`

```ts
const DATA_KEY = readSecret("DATA_ENCRYPTION_KEY") || HMAC_SECRET;
```

One secret serves two unrelated purposes: request authentication/signing and
field-level data encryption. Consequences:

- **No domain separation.** A signature produced for one purpose is
  indistinguishable from one produced for the other.
- **Single point of compromise.** Leaking `GATEWAY_SHARED_SECRET` yields data
  decryption as well as forgery.
- **Rotation couples two purposes.** Rotating to fix a signing problem forces a
  data-encryption rotation too, which cannot be done retroactively for already
  encrypted data.

`apps/web/src/lib/crypto.ts:222` additionally exposes
`hmacSign(secret, data)` taking a **caller-supplied** secret, while the gateway
equivalent (`gateway/lib/crypto.ts:61`) uses a server-held key. Two HMAC paths
with different trust models.

### Options

1. **Separate keys + a versioned envelope** (recommended).
   - `GATEWAY_SIGNING_SECRET` and `GATEWAY_DATA_KEY` both required at boot; the
     fallback to one is removed.
   - Add an envelope `kdf_version` field so a future key swap is migratable.
   - Pro: real domain separation; rotation becomes possible.
   - Con: **breaking change** — every running deployment must set both env vars
     before deploying, or the edge refuses to boot. Needs a migration window.
2. **Keep one secret; add explicit derivation.**
   - `HKDF(GATEWAY_SHARED_SECRET, info="gateway-data" | "gateway-sign")`.
   - Pro: no deployment break; real domain separation from one input secret.
   - Con: rotation still couples the two, because they share an input.
3. **Document the coupling as accepted risk.**
   - Pro: zero change.
   - Con: leaves a known single point of compromise unaddressed.

**Recommendation:** Option 2 now (no deployment break, genuine separation),
Option 1 as a follow-up once a key-rotation path exists. Both need a
security-crypto reviewer per §5.4. **Not started.**

---

## Phase 4 — Admin surface and tenant isolation

**Trigger:** §8 #1 (ledger/`packages/core` adjacent) and §8 #4 (auth/tenant).
**Risk:** cross-tenant data access. Highest-severity item in this packet.

### Finding 4a — the web ORM shim enforces no tenant scoping (verified)

`apps/web/src/lib/libsql-proxy.ts:289`

```ts
export function createLibsqlProxy(client: SqlHandle): LibsqlProxy
```

There is **no `tenantId` parameter**, and the proxy body contains **zero**
occurrences of `tenant_id` (verified by search). Isolation therefore rests
entirely on every call site remembering to filter by tenant. ~80 call sites.

`AGENTS.md` §3.4 states `tenant_id` is "defence-in-depth". Today it is neither
defence nor depth — it is a convention.

### Finding 4b — the destructive admin surface

`apps/gateway/index.ts` gates the admin surface on `GATEWAY_ADMIN_TOKEN` and
**refuses to boot** when unset or left at the `.env.example` placeholder. That
is the correct fail-closed posture (BR-SEC-03) and should be preserved. RFC 009
and RFC 010 are unratified, so the admin surface's final shape is undecided.

### Options for 4a

1. **Inject `tenantId` into `createLibsqlProxy` and auto-scope every `where`**
   (recommended). Single-tenant-per-DB makes this belt-and-braces, but it makes
   the guarantee structural instead of conventional.
   - Con: touches ~80 call sites; needs a real migration and the §5.4 two-reviewer
     gate. High effort, high value.
2. **Add a startup assertion + a lint rule** requiring `tenantId` in every
   `where` that touches a tenant table.
   - Pro: far cheaper; catches the realistic failure (a forgotten filter).
   - Con: does not guarantee it; a dynamic filter could still slip through.
3. **Accept single-tenant-per-DB as sufficient.**
   - Pro: matches the current architecture (one Turso DB per tutor).
   - Con: leaves any DB-connection mix-up unrecoverable.

**Recommendation:** Option 2 as an immediate cheap guard, Option 1 as the real fix
scheduled properly. **Not started** — this is a large, review-gated change.

### Also requires a decision

`ALLOW_DEV_AUTH` (Phase 1) and the RFC 009/010 ratification both belong to this
phase. Neither can be closed without an owner decision.

---

## What is NOT in this packet

- Phases 2, 5, 6 — shipped, ungated, verified (lint + typecheck + 1,281 unit
  tests + production build all green).
- Anything touching `apps/mobile` or `apps/desktop` — LOCKED until WEB-PROD-GATE
  (`AGENTS.md` §9.3). This packet proposes no mobile or desktop work.