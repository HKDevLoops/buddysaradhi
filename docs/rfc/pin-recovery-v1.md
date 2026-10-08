# RFC: PIN Recovery via Authenticator/Passkey — Sovereignty-Preserving Design

**Status:** Draft — Awaiting Principle Amendment
**Author:** [Agent]
**Created:** 2026-10-08
**Last Updated:** 2026-10-08
**Spec Owners:** Orchestrator, Ledger-Crypto Reviewer
**Related Specs:** `08_Settings.md`, `10_Security.md`, `14_Edge_Cases.md`, `01_Product_Principles.md`

---

## 1. Problem Statement

Tutors who forget their 6-digit PIN have **no self-service recovery path** today. The only recovery options are:
1. **Backup passphrase + account recreation** (current path)
2. **Support-guided account recreation** (manual data re-entry)

This causes support load and tutor frustration when PIN is lost. The request is to add a **sovereignty-preserving PIN recovery path** using:
- **TOTP authenticator apps** (Google Authenticator, Authy, 1Password, etc.)
- **WebAuthn passkeys** (platform authenticators, security keys)

---

## 2. Current Recovery Path (Per Spec)

| Path | Requires | Tutor Effort | Data Loss Risk |
|------|----------|--------------|----------------|
| **Backup passphrase** | `.buddysaradhi` file + passphrase | Low (if backup exists) | None if backup current |
| **Account recreation** | Manual data entry | High (re-enter all students) | None (fresh start) |
| **Support intervention** | Identity verification | Medium | None |

**Gap:** No recovery when tutor has **no backup** and **forgot PIN** and **forgot passphrase**.

---

## 3. Sovereignty Constraints (Non-Negotiable)

Per existing specs, any new recovery method MUST satisfy:

| Constraint | Source | Requirement |
|------------|--------|-------------|
| **No escrow** | `10_Security.md` §15 BACKUP-1 | No master key, no plaintext fallback |
| **No telemetry** | `01_Product_Principles.md` AP-10 | No SDK that exfiltrates data |
| **Offline-first** | `01_Product_Principles.md` P5 | Works without network |
| **Five screens only** | `01_Product_Principles.md` P2 | No new top-level screen |
| **Integer paise** | `12_Business_Rules.md` BR-M-01 | No float in money logic (metaphor) |
| **Append-only ledger** | `10_Security.md` §9 LEDGER-1 | No mutability implications |

---

## 4. Proposed Design: Sovereignty-Preserving Recovery

### 4.1 TOTP Authenticator Recovery (Primary)

**Mechanism:** Tutor enrolls a TOTP authenticator app during PIN setup. Recovery uses TOTP code + passphrase.

```
┌─────────────────────────────────────────────────────────────┐
│ ENROLLMENT (during PIN setup or Settings → Security)        │
├─────────────────────────────────────────────────────────────┤
│ 1. Tutor scans QR code / enters secret into authenticator   │
│ 2. Tutor enters current TOTP code to verify                 │
│ 3. Secret is encrypted with PIN-derived key + stored        │
│ 4. Secret NEVER synced, never logged, never in plaintext    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ RECOVERY (Settings → Security → "Forgot PIN")               │
├─────────────────────────────────────────────────────────────┤
│ 1. Tutor enters authenticator 6-digit TOTP code             │
│ 2. Tutor enters backup passphrase (decrypts envelope)       │
│ 3. System decrypts backup envelope using passphrase         │
│ 4. Tutor sets new PIN (verified against current hash)       │
│ 5. New PIN hash stored; old PIN hash invalidated            │
│ 6. TOTP secret re-encrypted with new PIN-derived key        │
└─────────────────────────────────────────────────────────────┘
```

**Sovereignty Properties:**
- ✅ TOTP secret encrypted with PIN-derived key (no plaintext)
- ✅ Recovery requires **both** TOTP + passphrase (two factors)
- ✅ No network call — works offline
- ✅ No telemetry — no SDK, no analytics
- ✅ No escrow — no master key stored anywhere
- ✅ Offline-first — works without internet

### 4.2 WebAuthn Passkey Recovery (Secondary)

**Mechanism:** Tutor registers a passkey (platform authenticator / security key). Recovery uses passkey + passphrase.

```
┌─────────────────────────────────────────────────────────────┐
│ ENROLLMENT (Settings → Security → "Add Passkey")            │
├─────────────────────────────────────────────────────────────┤
│ 1. Tutor triggers passkey registration (WebAuthn)           │
│ 2. Browser/OS prompts for biometric/PIN                    │
│ 3. Public key stored in `settings.passkey_credential_id`    │
│ 4. Private key NEVER leaves authenticator                   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ RECOVERY (Settings → Security → "Forgot PIN")               │
├─────────────────────────────────────────────────────────────┤
│ 1. Tutor selects "Use passkey"                              │
│ 2. Browser/OS prompts for biometric/PIN                    │
│ 3. Tutor enters backup passphrase                           │
│ 3. System verifies passkey assertion + passphrase           │
│ 4. Tutor sets new PIN                                       │
│ 5. New PIN hash stored                                      │
└─────────────────────────────────────────────────────────────┘
```

**Sovereignty Properties:**
- ✅ Private key never leaves authenticator
- ✅ Recovery requires **both** passkey + passphrase
- ✅ No network call for verification (WebAuthn is local)
- ✅ No telemetry — standard WebAuthn API
- ✅ No escrow — private key never in app memory

---

## 5. Data Model Changes

### 5.1 Settings Table Additions

```sql
ALTER TABLE settings ADD COLUMN totp_secret_encrypted TEXT;    -- TOTP secret, encrypted with PIN-derived key
ALTER TABLE settings ADD COLUMN totp_secret_iv TEXT;           -- IV for TOTP secret encryption
ALTER TABLE settings ADD COLUMN passkey_credential_id TEXT;    -- WebAuthn credential ID (public)
ALTER TABLE settings ADD COLUMN passkey_public_key TEXT;       -- WebAuthn public key (public)
```

### 5.2 Encryption Scheme

| Field | Encryption | Key Derivation |
|-------|------------|----------------|
| `totp_secret_encrypted` | AES-256-GCM | Argon2id(PIN \|\| pepper, salt, m=64MiB, t=3, p=2) |
| `totp_secret_iv` | AES-256-GCM | Same as above (different IV) |

**Key Separation:** TOTP secret uses **separate key derivation** from backup passphrase — different `salt` and `pepper` to prevent cross-protocol attacks.

---

## 6. UI Integration (Within 5 Screens)

**Location:** Settings → Security section (existing screen, no new route)

```
Settings → Security
├── PIN (Change / Reset) ← NEW: "Forgot PIN?" link
├── Biometric
├── Passkeys (NEW subsection)
│   ├── Add Passkey (WebAuthn registration)
│   └── Manage Passkeys
├── TOTP Authenticator (NEW subsection)
│   ├── Set up Authenticator (QR code + TOTP verification)
│   └── Remove Authenticator
└── Backup / Restore (unchanged)
```

**No new screen** — integrates into existing Settings → Security (per P2: five screens only).

---

## 7. Threat Model & Mitigations

| Threat | Mitigation |
|--------|------------|
| **TOTP secret stolen from device** | Encrypted with PIN-derived key; useless without PIN |
| **Passkey private key extracted** | Never leaves authenticator; WebAuthn guarantees this |
| **Recovery flow phishing** | Requires both TOTP/passkey **AND** passphrase |
| **TOTP secret in sync_outbox** | Excluded from sync payload (like `pin_hash`) |
| **Passkey private key in backup** | Never stored — only public key in backup manifest |
| **Malicious recovery attempt** | Requires both TOTP/passkey **AND** passphrase |
| **Supply chain attack on authenticator** | TOTP is RFC 6238 standard; no vendor dependency |

---

## 8. Recovery Flow Comparison

| Factor | Current (Backup) | Proposed (TOTP) | Proposed (Passkey) |
|--------|------------------|-----------------|-------------------|
| **Requires backup file** | Yes | No (if TOTP enrolled) | No (if passkey enrolled) |
| **Requires passphrase** | Yes | Yes | Yes |
| **Requires network** | No | No | No (WebAuthn local) |
| **Works on new device** | Yes (with backup file) | Yes (if TOTP app synced) | Yes (if passkey synced) |
| **Sovereignty preserved** | ✅ | ✅ | ✅ |
| **New dependencies** | None | `otplib` (RFC 6238) | `@simplewebauthn/browser` |

---

## 9. Security Review Requirements

Before implementation, the following reviews are required:

1. **Crypto Review** — KDF separation, IV uniqueness, GCM nonce reuse prevention
2. **Threat Model Review** — Passkey/TOTP secret handling, memory zeroing
3. **Supply Chain Audit** — `otplib` and `@simplewebauthn/browser` provenance (SLSA)
3. **Penetration Test** — Recovery flow fuzzing, side-channel analysis
4. **Supply Chain** — `bun audit` / `npm audit` pass on new deps

---

## 9. Implementation Plan (Post-Amendment)

### Phase 1: Core Crypto (Week 1)
- [ ] `packages/shared/crypto.ts` — TOTP encryption/decryption
- [ ] `packages/shared/crypto.ts` — Passkey verification helpers
- [ ] Unit tests: encryption round-trip, wrong PIN rejection

### Phase 2: Server Actions (Week 2)
- [ ] `apps/web/src/server/actions/pin-recovery-action.ts`
- [ ] TOTP verification action
- [ ] Passkey verification action
- [ ] Integration tests with real DB

### Phase 3: UI Components (Week 3)
- [ ] `apps/web/src/components/settings/TotpSetupSheet.tsx`
- [ ] `apps/web/src/components/settings/PasskeySetupSheet.tsx`
- [ ] `apps/web/src/components/settings/ForgotPinSheet.tsx`
- [ ] Accessibility review (WCAG 2.1 AA)

### Phase 4: Integration (Week 4)
- [ ] Settings → Security section updates
- [ ] Sync outbox exclusion for TOTP secret
- [ ] E2E tests: recovery flow, wrong code rejection, passphrase requirement
- [ ] Agent Browser verification

---

## 10. Open Questions

1. **TOTP secret rotation?** Should secret rotate on PIN change? (Current design: yes, re-encrypted with new PIN)
2. **Multiple passkeys?** Allow multiple passkeys per account? (Yes, array of credential IDs)
3. **TOTP algorithm?** RFC 6238 (SHA-1) or RFC 6238-SHA256? (Default SHA-1 for compatibility; SHA256 optional)
4. **Recovery rate limiting?** Max 3 TOTP attempts before 5min lockout? (Match PIN lockout)
5. **Passkey platform authenticator only?** Or security keys too? (Both — WebAuthn supports both)

---

## 11. Acceptance Criteria

| Criterion | Test |
|-----------|------|
| TOTP enrollment works offline | Unit: QR generation, TOTP verification |
| TOTP recovery requires passphrase | Integration: wrong passphrase → reject |
| Passkey enrollment works | Integration: WebAuthn registration + verification |
| Passkey recovery requires passphrase | Integration: wrong passphrase → reject |
| No plaintext secrets in DB | Unit: `totp_secret_encrypted` not plaintext |
| No secrets in sync_outbox | Integration: sync payload excludes TOTP secret |
| No secrets in backup | Unit: backup manifest excludes private keys |
| No network calls in recovery | Integration: recovery flow works with network disabled |
| All existing tests pass | CI: full test matrix green |

---

## 12. Dependencies

| Package | Purpose | Version Constraint |
|---------|---------|-------------------|
| `otplib` | RFC 6238 TOTP | `^12.x` (no native deps) |
| `@simplewebauthn/browser` | WebAuthn registration/assertion | `^9.x` |
| `@simplewebauthn/server` | WebAuthn server-side verification | `^9.x` |

All packages: no native dependencies, SLSA provenance, MIT/BSD license.

---

## 13. Rollback Plan

If issues discovered post-deployment:
1. **Feature flag** `pin_recovery_enabled` defaults to `false`
2. Settings → Security shows recovery options only when flag is `true`
3. Rollback = flip flag to `false` — no data migration needed
4. TOTP/passkey data remains encrypted but inert

---

## 14. Appendix: ASCII Recovery Flow

```
┌─────────────────────────────────────────────────────────────┐
│ FORGOT PIN RECOVERY FLOW                                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
│  │ Enter email │───▶│ Select      │───▶│ Enter 6-digit │      │
│  │ (optional)  │    │ method      │    │ TOTP code     │      │
│  └─────────────┘    └─────────────┘    └──────┬────────┘      │
│                                                │              │
│                                                ▼              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
│  │ Enter       │◀───│ Verify      │◀───│ Enter backup  │      │
│  │ new PIN     │    │ TOTP +      │    │ passphrase    │      │
│  └──────┬──────┘    │ passphrase  │    └─────────────┘      │
│         │           └─────────────┘                          │
│         ▼                                                     │
│  ┌─────────────┐                                             │
│  │ Re-encrypt  │                                             │
│  │ TOTP secret │                                             │
│  │ with new PIN│                                             │
│  └─────────────┘                                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 15. Sign-Off Required

| Role | Name | Signature | Date |
|------|------|-----------|------|
| **Orchestrator** | | | |
| **Ledger-Crypto Reviewer** | | | |
| **Security Reviewer** | | | |

---

*This RFC is a draft for principle amendment consideration. Implementation will only proceed after orchestrator + ledger-crypto reviewer sign-off per AGENTS.md §0.1 Amendment Process.*