# RFC: Edge-Verifiable PIN Proof (`pin_proof`) — Retroactive Spec Amendment

**Status:** PROPOSED — Awaiting Ratification (nothing in this RFC changes code; the code already shipped, see §1)
**Author:** [Agent]
**Created:** 2026-10-12
**Last Updated:** 2026-10-12
**Spec Owners:** Orchestrator, Ledger-Crypto Reviewer, Security Reviewer
**Related Specs:** `10_Security.md` (§3.4, §4, §18.1), `11_Data_Model.md` (§4.1), `12_Business_Rules.md` (BR-SEC-04, BR-SEC-05, BR-SEC-07), `01_Product_Principles.md`, `14_Edge_Cases.md`, `contracts/openapi.yaml` (`/security/erase`)

**RFC style note:** structure follows `docs/rfc/pin-recovery-v1.md` (header block → problem → design → data model → threat model → plan → open questions → acceptance criteria → sign-off), with verified-findings + options-with-recommendation per `docs/rfc/gated-review-packet-phases-1-3-4.md`. Every `file:line` below was read during drafting; no citation is from memory.

---

## 1. Retroactivity Disclosure (read first)

Per `AGENTS.md` §0.1 (`AGENTS.md:25-42`), the loop is Spec → Code → Test, in order: *"If the implementation diverges from the spec, the spec wins — unless the spec is wrong, in which case you update the spec first, get the amendment reviewed, and only then change the code."* That order was not followed here. The edge-verifiable PIN proof — `settings.pin_proof` column, `pinProof()` in two runtimes, proof verification in the gateway erase route, the `pinProof` contract field — is **already implemented and shipped**. This RFC is therefore **retroactive**: it asks reviewers to ratify, amend, or reject behaviour that already exists on disk, and §2 documents the gaps honestly rather than back-fitting the spec to the code.

The prime directive (`AGENTS.md:12-14` — *"Before writing or modifying any code, read the relevant spec section. If no spec covers it, write the spec first"*) is the reason this RFC exists at all: until it is ratified, every `BR-SEC-04` / `10_Security.md §18.1` citation in the proof code points at spec text that does not describe the proof.

---

## 2. Problem Statement

The gateway destructive-erase endpoint (`POST /api/v1/security/erase`, `apps/gateway/routes/security.ts:69-70`) used to verify only that a PIN **existed**:

- `apps/gateway/routes/security.ts:42-51` concedes this directly: the old gate checked `pin_hash` presence, *"which is not re-authentication. It proves a PIN was once set, not that the caller knows it, so ANY authenticated session could erase a tutor's entire institute."*
- The blocker was real: `pin_hash` is argon2id (`10_Security.md:73-74`), and the Deno edge has no argon2 (`apps/gateway/lib/schema.ts:383-386`). The conclusion drawn from it — substitute presence for proof — was the defect (`docs/security/SECURITY-AUDIT-2026-10.md:65-68`, `:78`, `:84`).
- The audit's recommended fix (`docs/security/SECURITY-AUDIT-2026-10.md:88`) was a **PIN-proof, not a PIN**: `pinProof = HMAC-SHA256(...)` computed by the web app, recomputed/compared by the edge. That is what shipped, with two evolutions the audit text predates: a domain-separation `info` prefix and `PIN_PEPPER || GATEWAY_SHARED_SECRET` key precedence (see §5).

The implementation is sound engineering. It is orphan code by `AGENTS.md` §0.2's definition until this amendment gives it a spec home — §3 lists exactly where the spec is silent or contradictory.

---

## 3. Known Gaps (documented, not hidden)

### Gap A — BR-SEC-04 does not list secure erase, yet the code cites it

Current text (`12_Business_Rules.md:203`):

> `**BR-SEC-04** [CRITICAL]| The following require PIN/biometric even when app is unlocked: void receipt/ledger, unlock/edit locked attendance, backdated ledger, bulk delete, fee waiver. | …`

That is **five** actions. Secure erase is not among them — yet the erase route cites BR-SEC-04 in its gate-order comment (`apps/gateway/routes/security.ts:26`), its knowledge-verification comment (`apps/gateway/routes/security.ts:41`), and the presence-gate error string (`apps/gateway/routes/security.ts:108-115`); the Zod body cites it (`packages/shared/zod/index.ts:57`); the contract cites it (`contracts/openapi.yaml:193`); the SQL builder cites it (`apps/gateway/lib/sql.ts:1088`); the schema heal cites it (`apps/gateway/lib/schema.ts:383`); the parity test cites it (`apps/gateway/__tests__/pin-proof-vector.test.ts:1`); the Prisma model cites it (`prisma/schema.prisma:47`).

Neither horn of "extend BR-SEC-04 or cite the correct rule" has been taken. §4.1 takes the first horn (recommended): erase belongs on the sensitive-action list — `10_Security.md:119-135` already says the §4 matrix *"implements … **BR-SEC-04** (typed confirm for full export)"*, so the corpus half-believes erase is covered. Making it explicit is a one-line change, not a redesign.

### Gap B — Freshness: the spec demands ≤ 30 s; the proof is deterministic and non-expiring

Current text (`10_Security.md:410`, §18.1 step 1):

> `1. Re-confirm: PIN ≤ 30s + typed "ERASE"`

The implemented proof has **no nonce, no timestamp, no challenge**. Both runtimes derive identically (`apps/gateway/lib/crypto.ts:187`, `apps/web/src/lib/crypto.ts:63`):

```ts
const material = `${PIN_PROOF_INFO}:${tenantId}:${pin}`;
```

A stored proof verifies identically today, tomorrow, and after a PIN re-entry — it is a *knowledge* factor with no *freshness* axis. Against §18.1 step 1 this is honestly a **weakening on the freshness axis** (no ≤ 30 s property at the edge) paired with a **strengthening on the knowledge axis** (presence → knowledge, closing the stolen-session erase). §6 chooses a posture and records the rejected alternatives.

### Gap C — `pin_proof` has no home in the numbered spec corpus

A full-corpus `*.md` search for `pin_proof|pinProof|PIN_PROOF_INFO|pin-proof` returns exactly one hit: `docs/security/SECURITY-AUDIT-2026-10.md:88` (the pre-implementation recommendation). **Zero files in the numbered spec corpus** (`00`–`23` + `web/` + `product/` + `deployment/` + `mobile/` + `desktop/`) mention the column, the derivation, or the verification. Meanwhile the column exists in four DDL authorities: `11_Data_Model.md` does *not* list it (`11_Data_Model.md:134` shows `pin_hash` with no `pin_proof` line beneath), while `prisma/schema.prisma:50`, `apps/gateway/lib/schema.ts:44-45`, and `schema.sql:23` all carry it. §4.3 gives it a home.

### Gap D — The web accepts 4-digit PINs; BR-SEC-05 mandates ≥ 6

- Code: `apps/web/src/server/actions/settings.ts:1210-1211` — `if (newPin.length < 4 || newPin.length > 8)` → `"PIN must be 4-8 digits"`.
- Spec: `12_Business_Rules.md:204` (BR-SEC-05) — *"PIN ≥ 6 digits. Setup rejects shorter with inline error."*; `10_Security.md:62` — *"**PIN** (6-digit)"*.

A 4- or 5-digit PIN accepted at setup violates BR-SEC-05 as written and weakens the proof exactly as much as it weakens the hash (the HMAC is over the same short PIN). §4.4 resolves it without locking anyone out.

### Gap E (editorial, found while verifying) — stale cross-reference in the shipped code

`apps/gateway/routes/security.ts:33-38` claims *"The web already refuses in that state (`deleteAccountAction`, apps/web/src/server/actions/settings.ts:638-640)"*. Lines 638-640 of that file are `SettingsCasOptionsSchema` / `SettingsCasOptions` (`apps/web/src/server/actions/settings.ts:633-640`), not the erase action. The actual PIN-unset refusal lives in `deleteAccountAction` at `apps/web/src/server/actions/settings.ts:1100-1104`. The amendment corrects the citation target; the code comment should be fixed in a follow-up commit (not in this RFC — §8 discipline: this file only).

### Gap F (integration, found while verifying) — no shipped web sender for the edge proof

A search of `apps/web` for `security/erase|secureErase` (including gateway-routed variants) returns **no caller**: the web derives and stores the proof on every PIN set (`apps/web/src/server/actions/settings.ts:1253-1276`) and the edge verifies it (`apps/gateway/routes/security.ts:119-155`), but no shipped web UI computes `pinProof(tenantId, pin)` at erase time and POSTs it to the edge. The web's own destructive path (`deleteAccountAction`, `apps/web/src/server/actions/settings.ts:1087-1206`) re-verifies the PIN server-side with argon2 (`apps/web/src/server/actions/settings.ts:1105-1108`) and erases locally — fresh by construction, but a different path from the proof-gated edge route. Ratifying the proof must not imply end-to-end coverage that does not exist; §9 records wiring the sender as follow-up work.

---

## 4. Exact Rule-Text Changes

Each item quotes current spec text verbatim, then shows the replacement. Nothing else in the cited sections changes.

### 4.1 `12_Business_Rules.md` BR-SEC-04 — add secure erase (takes the "extend" horn of Gap A)

**Current** (`12_Business_Rules.md:203`):

> `**BR-SEC-04** [CRITICAL]| The following require PIN/biometric even when app is unlocked: void receipt/ledger, unlock/edit locked attendance, backdated ledger, bulk delete, fee waiver. | App-unlocked ≠ authorised-for-everything. | `SecurityEngine.challenge`; CI lint that every action is wrapped | Sensitive mutation without challenge; P0 bug | `BR-LED-04`, `BR-ATT-08`, `BR-FEE-13` |`

**Replacement** (one action appended; rationale/enforcement/related extended):

> `**BR-SEC-04** [CRITICAL]| The following require PIN/biometric even when app is unlocked: void receipt/ledger, unlock/edit locked attendance, backdated ledger, bulk delete, fee waiver, secure erase (local account erase AND edge `POST /api/v1/security/erase`). | App-unlocked ≠ authorised-for-everything. | `SecurityEngine.challenge`; CI lint that every action is wrapped; edge proof verification per `10_Security.md` §18.1 | Sensitive mutation without challenge; P0 bug | `BR-LED-04`, `BR-ATT-08`, `BR-FEE-13`, `10_Security.md` §18 |`

### 4.2 `10_Security.md` §18.1 step 1 — describe the proof gate (resolves Gap B's silence)

**Current** (`10_Security.md:410`):

> `1. Re-confirm: PIN ≤ 30s + typed "ERASE"`

**Replacement**:

> `1. Re-confirm: fresh PIN (≤ 30s, argon2id-verified on the web path per §3.4) + typed "ERASE" + edge PIN-proof match. The edge cannot evaluate argon2id, so the request also carries `pinProof` (HMAC-SHA256 over the PIN under the server PIN pepper, §3.4a), compared in constant time against `settings.pin_proof`; a missing proof is refused with a re-confirm instruction, never downgraded to a presence check. The proof is deterministic (no expiry — see §3.4a freshness note); request freshness on the edge path comes from the per-tenant erase rate limit (5 attempts / 15 min) and the typed confirmation, and on the web path from the request-time argon2id re-verification.`

### 4.3 `11_Data_Model.md` §4.1 + `10_Security.md` §3.4 — give `pin_proof` a home (resolves Gap C)

**Current** (`11_Data_Model.md:134`, inside the `settings` DDL at `11_Data_Model.md:112-140`):

> `  pin_hash                TEXT,                          -- argon2id; NULL if unset`

**Replacement** (one line added; purpose/invariants sentence at `11_Data_Model.md:142` extended):

> `  pin_hash                TEXT,                          -- argon2id; NULL if unset`
> `  pin_proof               TEXT,                          -- HMAC-SHA256 PIN-knowledge proof for the edge (BR-SEC-04, §18.1 step 1); NULL until PIN (re-)confirmed`

> Purpose/invariants append: *"`pin_proof` is a derived verifier, not a credential of record: `pin_hash` (argon2id) remains what the web verifies at sign-in; the proof exists only so a non-argon2 runtime can check PIN knowledge on the destructive path. It is excluded from sync payloads and settings projections like `pin_hash`."*

And in `10_Security.md` §3.4 (after the unlock pseudo at `10_Security.md:69-80`), add subsection **§3.4a "Edge-verifiable PIN proof"** whose normative content is §5 of this RFC (algorithm, `PIN_PROOF_INFO`, key resolution, encoding), plus the freshness note from §4.2 and the exclusion rules verified in §7 (sync payload carries only `pin_updated_at`; `toSafeSettings` / `SETTINGS_SECRET_KEYS` strip the proof).

### 4.4 PIN-length contradiction — align code to spec, grandfather existing PINs (resolves Gap D)

**No spec text changes.** BR-SEC-05 (`12_Business_Rules.md:204`) and `10_Security.md:62` stand as written (≥ 6). The follow-up code change (not in this RFC) narrows `apps/web/src/server/actions/settings.ts:1210-1211` to reject PINs shorter than 6 at **setup/change** time. Grandfathering is mandatory: existing 4–5-digit PINs must continue to **verify** (the codebase already honours this direction — the obvious-PIN refusal is *"NEVER applied to verification"* at `apps/web/src/server/actions/settings.ts:1221-1222`, so a tutor is never locked out of their own books by a policy tightening). The follow-up must also prompt sub-6 PIN holders to upgrade at next unlock, and must re-derive `pin_proof` at that upgrade (proof derivation already rides the same transaction as the hash store, §7).

### 4.5 BR-SEC-07 — ratify the key precedence the code depends on

The gateway comment (`apps/gateway/lib/crypto.ts:27-48`) claims *"BR-SEC-07 already binds the PIN pepper to the argon2id `pin_hash`"*. As written, BR-SEC-07 (`12_Business_Rules.md:206`) says only *"No plaintext secret ever written to the DB. PIN stored as `argon2id(pin)`…"* — it mentions no pepper. The implementation's actual rule is stricter and must be ratified explicitly:

**Append to BR-SEC-07's Statement cell** (`12_Business_Rules.md:206`): *" The PIN pepper resolves `PIN_PEPPER || GATEWAY_SHARED_SECRET`, identically in every runtime that derives or verifies PIN material (argon2id `pin_hash` and HMAC `pin_proof` alike); a runtime that resolves differently fails closed at boot."*

This writes down what `apps/web/src/lib/crypto.ts:6-13` (`resolvePepper`) and `apps/gateway/lib/crypto.ts:48` (`PIN_PEPPER`) already do — and what the parity test guards (`apps/gateway/__tests__/pin-proof-vector.test.ts:103-144`, the test that would have caught the shipped key-divergence described at `apps/gateway/lib/crypto.ts:33-42`).

---

## 5. Proof Derivation Spec (normative — the §3.4a content)

Verified byte-for-byte against both implementations (`apps/gateway/lib/crypto.ts:175-192`, `apps/web/src/lib/crypto.ts:52-68`) and the contract (`contracts/openapi.yaml:192-212`).

| Property | Value |
|---|---|
| Algorithm | HMAC-SHA256 via WebCrypto (`crypto.subtle.sign("HMAC", …)`), both runtimes |
| Domain-separation string | `PIN_PROOF_INFO = "buddysaradhi:pin-proof:v1"` (`apps/gateway/lib/crypto.ts:175`, `apps/web/src/lib/crypto.ts:52`) |
| Signed material | `` `${PIN_PROOF_INFO}:${tenantId}:${pin}` `` — ASCII colon separators; `tenantId` inside the material so tenant A's proof never validates for tenant B (`apps/gateway/lib/crypto.ts:162-163`; tenant-binding asserted at `apps/gateway/__tests__/pin-proof-vector.test.ts:84-88`) |
| Key resolution | `PIN_PEPPER \|\| GATEWAY_SHARED_SECRET`, byte-identical on both sides (`apps/gateway/lib/crypto.ts:48`, `apps/web/src/lib/crypto.ts:6-13`); mismatch is a fail-closed boot error on both sides (`apps/gateway/lib/crypto.ts:178`, `apps/web/src/lib/crypto.ts:8-10`) |
| Encoding | Lowercase hex, 64 chars (`[0-9a-f]{64}`); enforced at the contract (`contracts/openapi.yaml:204-207` `minLength`/`maxLength`/`pattern`) and in Zod (`packages/shared/zod/index.ts:58-64`) |
| Comparison | `constantTimeCompare` (`apps/gateway/lib/crypto.ts:125-140`); the route additionally bounds input length *before* comparing so an unbounded POST cannot burn CPU in the comparison (`apps/gateway/routes/security.ts:129-141`) |
| Domain separation vs other HMACs | The proof string must never equal an ordinary `hmacSign` of the same material; asserted, not just commented (`apps/gateway/__tests__/pin-proof-vector.test.ts:94-101`). Note the two HMAC paths have different trust models — gateway `hmacSign` uses a server-held key (`apps/gateway/lib/crypto.ts:88-102`), web `hmacSign` takes a caller-supplied secret (`apps/web/src/lib/crypto.ts:266-279`) — which is why the `info` prefix does load-bearing work (`apps/gateway/lib/crypto.ts:156-161`) |
| Cross-runtime parity | Known-answer parity between the Deno/edge and Node/web implementations is asserted by `apps/gateway/__tests__/pin-proof-vector.test.ts:78-82` (*"BOTH implementations return the SAME proof"*), with `PIN_PROOF_INFO` equality pinned at `:66-69`. Any change to prefix, separator, tenant binding, or key resolution fails this test by design (`apps/gateway/__tests__/pin-proof-vector.test.ts:19-24`) |

**Evolution note (audit → implementation):** the audit proposed `HMAC(GATEWAY_SHARED_SECRET, tenant:pin)` (`docs/security/SECURITY-AUDIT-2026-10.md:88`). The implementation added the `info` prefix and upgraded key resolution to `PIN_PEPPER || GATEWAY_SHARED_SECRET`. Both changes are strict improvements (domain separation; one PIN credential bound to one secret, `apps/gateway/lib/crypto.ts:43-47`); this RFC ratifies the as-shipped form, not the audit sketch.

---

## 6. Freshness Mechanism

### Chosen: accept-and-record (Option 1)

Ratify the deterministic, non-expiring proof **as a knowledge factor only**, with freshness supplied by the surrounding gates rather than the proof itself:

- **Web path:** fresh by construction — `deleteAccountAction` re-verifies the entered PIN against argon2id at request time (`apps/web/src/server/actions/settings.ts:1105-1108`), then erases. A replayed proof is useless here because the web path never reads the proof.
- **Edge path:** freshness approximated by (a) per-tenant rate limit — 5 attempts / 15 min (`apps/gateway/routes/security.ts:91-94`); (b) typed `confirm: "ERASE"` (`apps/gateway/routes/security.ts:85-87`); (c) wrong/missing proofs return an indistinguishable `401` (`"PIN confirmation failed; erase blocked"`, `apps/gateway/routes/security.ts:148-155`) so the endpoint is not a PIN oracle; (d) `erase_initiated` is audited before any deletion, fail-closed (`apps/gateway/routes/security.ts:157-173`).
- **Recorded residual risk:** a proof captured from a live session (XSS, compromised browser, shoulder-surfed DevTools) replays until the PIN changes — there is no expiry to outrun it. Mitigations as-shipped: session scoping (`tutorId` must equal the JWT tenant, `apps/gateway/routes/security.ts:82-84`), tenant binding (§5), rate limit, no-oracle responses. Changing the PIN re-derives the proof and kills captured copies (derivation rides the PIN-write transaction, §7).

### Rejected alternatives

- **Option 2 — short-lived edge challenge (nonce/timestamp).** The edge issues a single-use challenge; the client proves over `challenge:tenant:pin`. *Rejected for now, not forever:* it is the correct long-term design (restores the ≤ 30 s property at the edge), but it needs a challenge-issuance round-trip, server-side nonce store with expiry, and clock-discipline on the edge — a new protocol, not an amendment. Requires its own RFC; §10 lists it as the designated follow-up.
- **Option 3 — proof rotation on every use.** *Rejected:* the only successful "use" of an erase proof destroys the tenant (nothing left to rotate into), and rotation on *failed* attempts turns the rate limiter into a proof-invalidation oracle (an attacker could burn a tutor's valid proof by spamming wrong guesses — a denial-of-erase primitive). Rotation already happens exactly where it should: every PIN set/change re-derives proof + hash atomically (`apps/web/src/server/actions/settings.ts:1253-1276`).

---

## 7. Recovery Path for Proof-Less Tenants

The column is nullable on purpose. Back-compat behaviour, as shipped (`apps/gateway/routes/security.ts:119-128`, `apps/gateway/lib/schema.ts:392-397`):

1. Tenant with **no PIN at all** → refused: `"No PIN configured. Set a security PIN in Settings → Security…"` (`apps/gateway/routes/security.ts:108-115`). A tutor who never set a PIN cannot wipe their institute from a stolen session — the gate the nullability protects.
2. Tenant with **PIN set but no proof** (set before the proof shipped, never re-confirmed) → refused with a re-confirm instruction: `"Re-confirm your security PIN in Settings → Security before erasing…"` (`apps/gateway/routes/security.ts:120-128`). There is **no fallback to the old presence gate** (`apps/gateway/lib/schema.ts:392-397` — *"there is NO fallback… an earlier version of this comment claimed a presence fallback existed. It never did"*).
3. **Recovery step:** the tutor re-confirms/sets their PIN in the app; `setPinAction` derives hash + proof and upserts both with `sync_outbox` + `audit_log` rows in one transaction (`apps/web/src/server/actions/settings.ts:1262-1301`, Rule 7). From that moment the edge path is available. No support intervention, no migration script, no backfill job — deliberate tightening of an already-broken gate, not a regression (`apps/gateway/routes/security.ts:63-68`).

---

## 8. Migration / Back-Compat Statement

- **DDL is additive and idempotent.** `pin_proof TEXT` nullable added to the gateway-managed `settings` table (`apps/gateway/lib/schema.ts:44-45`) via `ensureColumn` heal at boot (`apps/gateway/lib/schema.ts:401`) — *"Adding the column is backwards-compatible: no existing tenant's rows are rewritten and no backup is invalidated"* (`apps/gateway/lib/schema.ts:399-400`). Per `AGENTS.md` §3.4 this heal path is one of exactly two runtime schema authorities; no other module may execute DDL.
- **Spec DDL follows code here (retroactive).** `11_Data_Model.md` §4.1 gains the `pin_proof` line (§4.3); `schema.sql:23` and `prisma/schema.prisma:50` already carry it. No migration renumbering: the gateway heal covers edge DBs; Prisma-managed flows pick up the model field normally.
- **No silent downgrade.** Proof-less tenants are refused (fail-closed, §7), never passed through a weaker gate. `pin_hash` presence is still read, but only to distinguish "no PIN" from "PIN without proof" (`apps/gateway/lib/sql.ts:1088-1109`, `apps/gateway/routes/security.ts:107-128`).
- **Secrecy posture is `pin_hash`-equivalent.** The proof is stripped from settings reads on both sides — gateway `toSafeSettings` (`apps/gateway/routes/settings.ts:211-216`) and web `SETTINGS_SECRET_KEYS` (`apps/web/src/server/actions/settings.ts:671-678`) — and excluded from sync payloads: the PIN-change outbox row carries only `{ pin_updated_at }` (`apps/web/src/server/actions/settings.ts:1278-1287`). The data-model amendment (§4.3) writes this exclusion down next to SR-12's `pin_hash` exclusion (`08_Settings.md:694` pattern).
- **Pepper rotation invalidates proofs.** Because the proof is an HMAC under the server pepper, rotating `PIN_PEPPER`/`GATEWAY_SHARED_SECRET` makes every stored proof mismatch: all edge erases return 401 until each tutor re-confirms their PIN (§7 step 3). This is fail-closed (no wrongful erase) but must be an announced operation with in-app guidance — record it in the rotation runbook when one exists.

---

## 9. Edge Cases

| # | Case | Behaviour (as shipped / as amended) | Verified against |
|---|---|---|---|
| EC-P1 | Proof-less tenant attempts edge erase | Refused with re-confirm instruction; no presence fallback | `apps/gateway/routes/security.ts:119-128` |
| EC-P2 | No PIN configured at all | Refused with set-a-PIN instruction | `apps/gateway/routes/security.ts:107-115` |
| EC-P3 | Wrong proof vs missing proof | Indistinguishable 401, same message; rate-limited — no oracle | `apps/gateway/routes/security.ts:142-155` |
| EC-P4 | Oversized `pinProof` input | Length-mismatch refused before constant-time compare; Zod + contract bound to 64 hex | `apps/gateway/routes/security.ts:129-141`, `packages/shared/zod/index.ts:58-64`, `contracts/openapi.yaml:204-207` |
| EC-P5 | Cross-tenant replay (A's proof for B) | Fails: tenant inside signed material; `tutorId` must equal JWT tenant | `apps/gateway/lib/crypto.ts:162-163`, `apps/gateway/routes/security.ts:82-84`, parity test `:84-88` |
| EC-P6 | Wrong PIN, right tenant | Different proof; 401; counts against 5/15-min budget | parity test `:90-92`, `apps/gateway/routes/security.ts:91-94` |
| EC-P7 | PIN changed | Proof re-derived in the same transaction as the hash; old captured proofs die | `apps/web/src/server/actions/settings.ts:1253-1276` |
| EC-P8 | Sub-6-digit existing PIN | Continues to verify (grandfathered); setup/change must require ≥ 6 post-follow-up | `apps/web/src/server/actions/settings.ts:1210-1211` vs `12_Business_Rules.md:204`; grandfathering per `:1221-1222` |
| EC-P9 | Pepper/secret rotation | All stored proofs mismatch → 401 until re-confirm; fail-closed, announce it | `apps/gateway/lib/crypto.ts:177-192` key resolution |
| EC-P10 | Key unconfigured at boot | Fail-closed throw (gateway) / throw (web `resolvePepper`); no dev fallback | `apps/gateway/lib/crypto.ts:178`, `apps/web/src/lib/crypto.ts:8-10` |
| EC-P11 | Proof confused with another HMAC (replay across purposes) | `info` prefix separates; asserted by test, not just comment | `apps/gateway/__tests__/pin-proof-vector.test.ts:94-101` |
| EC-P12 | Implementation drift (one runtime changes format/key) | Parity test fails on prefix, separator, binding, or key change | `apps/gateway/__tests__/pin-proof-vector.test.ts:19-24`, `:78-82` |
| EC-P13 | Proof leaks via settings read / sync | Stripped from projections both sides; outbox carries timestamp only | `apps/gateway/routes/settings.ts:211-216`, `apps/web/src/server/actions/settings.ts:671-678`, `:1278-1287` |
| EC-P14 | No shipped web sender (Gap F) | Edge endpoint proof-gated but unreachable from web UI today; web erase uses argon2 path | §3 Gap F; `apps/web/src/server/actions/settings.ts:1087-1108` |
| EC-P15 | Backup/restore carries `pin_proof` | Settings row restores with its proof; proof remains valid iff pepper unchanged — restoration across a pepper rotation lands in EC-P1 recovery (re-confirm) | `schema.sql:23` nullability; §7 |

---

## 10. Open Questions (for reviewers, not blockers)

1. **Challenge-based freshness (Option 2, §6):** commission as a follow-up RFC now, or defer until a second edge consumer needs freshness? Recommendation: defer the protocol, but record the requirement here so the deterministic proof is never mistaken for a fresh authenticator.
2. **BR-SEC-04's sixth action vs a new BR-SEC rule:** §4.1 extends BR-SEC-04. If reviewers prefer erase to stand alone (it destroys the ledger under the LEDGER-4 exception, `apps/gateway/routes/security.ts:175-179` — categorically unlike a void), a `BR-SEC-11` for destructive actions is the alternative. Either is preferable to the current miscitation.
3. **4-digit installed base:** are there production tutors with 4–5-digit PINs? If yes, the §4.4 follow-up needs an in-app upgrade nudge, not just a setup-time gate.
4. **Web sender for the edge route (Gap F / EC-P14):** which surface should POST the proof — Settings → Security erase driving the edge, or is the edge route mobile/desktop's future and the web stays local? Answer determines whether wiring work is web, gateway-client, or both.
5. **Pepper-rotation runbook:** EC-P9 needs an owner and an announcement template before any rotation is ever attempted.

---

## 11. Acceptance Criteria (for ratification, not code)

| Criterion | Check |
|---|---|
| Retroactivity acknowledged | §1 states code-shipped-first; reviewers accept a retroactive amendment per `AGENTS.md` §0.1 |
| BR-SEC-04 miscitation resolved | §4.1 (or BR-SEC-11 alternative per §10 Q2) ratified |
| Freshness weakening recorded | §4.2 + §6 ratified as the documented posture; Option 2 filed as follow-up |
| `pin_proof` homed | §4.3 DDL line + §5 derivation + §3.4a insertion ratified |
| PIN-length contradiction resolved | §4.4 direction (code → spec, grandfathered) accepted; follow-up tasked |
| Key precedence written down | §4.5 BR-SEC-07 appendage ratified |
| Proof-less recovery agreed | §7 three-step behaviour ratified as fail-closed |
| Migration safety agreed | §8 additive-DDL + no-downgrade + secrecy-parity ratified |
| Edge cases reviewed | §9 table walked; EC-P9 runbook owner named (§10 Q5) |
| No scope creep | This RFC creates/amends spec text only; the §4.4 code narrowing, the §E comment fix, the EC-P14 sender wiring, and the Option-2 protocol are tasked follow-ups, not part of ratification |

---

## 12. Dependencies

None. This RFC is spec-text-only by construction (per the tasking: one new file, no edits to code or existing specs). All follow-ups are sequenced after ratification: (1) spec edits per §4, (2) `setPinAction` length narrowing per §4.4, (3) stale-citation comment fix per Gap E, (4) edge-route sender wiring per Gap F, (5) optional challenge-protocol RFC per §6 Option 2.

---

## 13. Rollback Plan

If ratification is rejected: the code remains but its spec citations stay orphaned — file a counter-RFC choosing between (a) removing the proof path and restoring presence-gated erase behind an admin-token precondition (`docs/security/SECURITY-AUDIT-2026-10.md:89`), or (b) deleting the edge erase route outright (`docs/security/SECURITY-AUDIT-2026-10.md:90`, `AGENTS.md` §0.2). If ratification succeeds with amendments, revise this RFC's §4 replacement texts and re-seek sign-off; the shipped code already matches §5, so no code rollback is involved either way.

---

## 14. Sign-Off Required

| Role | Name | Signature | Date |
|------|------|-----------|------|
| **Orchestrator** | | | |
| **Ledger-Crypto Reviewer** | | | |
| **Security Reviewer** | | | |

---

*Retroactive amendment per `AGENTS.md` §0.1: the implementation preceded the spec, so the spec change is reviewed first and the code is judged against it after. Code without a spec is tech debt — including code that shipped before its RFC.*
