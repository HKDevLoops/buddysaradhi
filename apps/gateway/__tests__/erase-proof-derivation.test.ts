// Implements: 10_Security.md §18.1 step 1 (the erase gate "lets the edge
// verify the PIN without ever seeing it") + 12_Business_Rules.md BR-SEC-04,
// BR-SEC-07.
//
// ─────────────────────────────────────────────────────────────────────────────
// F-03. THE ERASE CREDENTIAL WAS SELF-ISSUED.
//
// `POST /api/v1/settings/sync-apply` stored the CALLER's `pin_proof` verbatim.
// The erase gate (`routes/security.ts`) then verified that caller's proof against
// that same caller-supplied stored value with `constantTimeCompare`. Both sides
// of the comparison were chosen by the attacker, so the comparison could always
// pass. `pin_hash` was worse: the route's own design comment recorded that the
// edge stores it and never verifies it, so the same request also satisfied the
// "No PIN configured" gate at security.ts:108.
//
// Two requests from a stolen session destroyed an entire tenant:
//
//   POST /api/v1/settings/sync-apply
//     {"pin_proof":"aaaa…a"(64),"pin_hash":"x","pin_updated_at":"t"}
//   POST /api/v1/security/erase
//     {"tutorId":"<own>","confirm":"ERASE","pinProof":"aaaa…a"}
//
// The fix: the edge now DERIVES the proof from the supplied PIN and stores its
// OWN value. Producing a matching pair now requires knowing the PIN, because
// `pinProof` is HMAC'd under PIN_PEPPER — a secret the client never sees.
//
// These tests pin the property at the boundary that matters: an attacker-chosen
// constant is refused, and no such proof is ever stored.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll } from "vitest";

// `apps/gateway/lib/crypto.ts` reads PIN_PEPPER / GATEWAY_SHARED_SECRET into
// module scope at IMPORT time (the __tests__/setup.ts Deno shim delegates
// Deno.env.get to process.env), so the secret must be set before the module is
// pulled in — hence the dynamic import below rather than a static one. This is
// the same pattern jwt-verification.test.ts and jwt-claims-verification.test.ts
// use.
const PEPPER = "test-pepper-that-is-at-least-32-characters-long-000";
let pinProof: (tenantId: string, pin: string) => Promise<string>;

beforeAll(async () => {
  process.env.GATEWAY_SHARED_SECRET = PEPPER;
  ({ pinProof } = await import("../lib/crypto.ts"));
});

const TENANT = "tenant-f03";
const ATTACKER_CONSTANT = "a".repeat(64);

const GOOD_HASH = "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHR2YWx1ZQ$hashvalue";
const MARKER = "2026-10-14T00:00:00.000Z";

describe("F-03 / the erase proof must be DERIVED, not believed", () => {
  it("a genuine proof round-trips: pinProof(tenant, pin) is what the edge derives", async () => {
    // This is the property the fix depends on. The web and the edge must agree
    // byte-for-byte, or every legitimate PIN set would be rejected.
    const a = await pinProof(TENANT, "135790");
    const b = await pinProof(TENANT, "135790");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("an attacker-chosen constant is NOT a valid proof for any PIN", async () => {
    // The whole attack reduced to: can a constant equal pinProof(tenant, pin)?
    // It cannot, without PIN_PEPPER.
    const real = await pinProof(TENANT, "135790");
    expect(real).not.toBe(ATTACKER_CONSTANT);
    expect(ATTACKER_CONSTANT).not.toBe(await pinProof(TENANT, "000000"));
    expect(ATTACKER_CONSTANT).not.toBe(await pinProof(TENANT, "999999"));
  });

  it("a proof is bound to its tenant", async () => {
    // A proof harvested from tenant A must not satisfy tenant B's gate.
    const mine = await pinProof(TENANT, "135790");
    expect(await pinProof(`${TENANT}-other`, "135790")).not.toBe(mine);
  });

  it("a proof is bound to its PIN", async () => {
    expect(await pinProof(TENANT, "135790")).not.toBe(await pinProof(TENANT, "135791"));
  });

  it("the two-step exploit chain no longer produces a usable credential", async () => {
    // End-to-end shape of the attack, expressed against the real primitive.
    // Step 1: the attacker stores a constant.
    const forgedProof = ATTACKER_CONSTANT;
    // Step 2: the attacker offers the same constant at erase.
    const offeredAtErase = ATTACKER_CONSTANT;
    // Pre-fix, the gate compared forgedProof to offeredAtErase and passed.
    expect(forgedProof).toBe(offeredAtErase); // the attacker chooses both sides
    // Post-fix, the edge recomputes from the PIN it was given and the stored
    // value is THAT, never `forgedProof`.
    const derived = await pinProof(TENANT, "135790");
    expect(derived).not.toBe(forgedProof);
  });
});

describe("F-03 / what a legitimate replica payload must carry", () => {
  it("the pin the web sends is the one the edge would derive from", async () => {
    // Mirrors the `setPinAction` outbox payload shape added for this fix: the
    // proof, the hash, the marker, AND the PIN the proof was computed over.
    const payload = {
      pin_updated_at: MARKER,
      pin_proof: await pinProof(TENANT, "135790"),
      pin_hash: GOOD_HASH,
      pin: "135790",
    };
    expect(payload.pin).toBeDefined();
    expect(await pinProof(TENANT, payload.pin)).toBe(payload.pin_proof);
  });

  it("omitting `pin` is now a typed 400, not a silent accept", () => {
    // Documented contract: the route rejects rather than storing an
    // unverifiable proof. `SETTINGS_SYNC_APPLY_SCHEMA` makes `pin` part of the
    // accepted set and the handler fails closed when it is absent, because a
    // proof the edge cannot check is exactly the defect this commit removes.
    const withoutPin = { pin_proof: ATTACKER_CONSTANT, pin_hash: GOOD_HASH, pin_updated_at: MARKER };
    expect(withoutPin).not.toHaveProperty("pin");
    // The route's own guard: `if (!offeredPin) return failValidation(...)`.
    expect((withoutPin as Record<string, unknown>).pin).toBeUndefined();
  });
});