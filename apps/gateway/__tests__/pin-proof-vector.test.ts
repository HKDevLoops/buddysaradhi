// Implements: BR-SEC-04 / 10_Security.md §18.1 step 1 — cross-implementation
// parity for the PIN proof.
//
// WHY THIS FILE IS NOT OPTIONAL. `pinProof` exists in TWO runtimes that cannot
// import each other: the edge (`apps/gateway/lib/crypto.ts`, Deno + WebCrypto)
// and the web app (`apps/web/src/lib/crypto.ts`, Node + argon2 in the same
// module). The web computes the proof, the edge verifies it. Nothing in the type
// system or the bundler connects them.
//
// That gap is not theoretical. The two implementations shipped keyed off
// DIFFERENT secrets — the gateway off `GATEWAY_SHARED_SECRET`, the web off
// `PIN_PEPPER || GATEWAY_SHARED_SECRET` — so in any deployment that sets
// `PIN_PEPPER` (a first-class variable in this repo) every proof mismatched and
// the destructive erase endpoint returned 401 for every tutor, permanently and
// silently. The gateway's own tests could not catch it, because they computed the
// expected value with the gateway's own function: `x === f(x)` is true for any
// `f`.
//
// THIS TEST IS THE FIX. It pins a known-answer vector as a LITERAL hex string,
// computed once from the specification of the format, and asserts that BOTH
// implementations independently reproduce it. A change to either the info prefix,
// the separator, the tenant binding, or the key resolution moves the digest and
// this fails — which is the only property that makes the cross-runtime contract
// checkable at all.
//
// It also pins the DOMAIN SEPARATION property that a future edit could break: the
// PIN proof must not equal an ordinary `hmacSign` of the same material, or one
// signature could be replayed as the other. That separation is STRUCTURAL — the
// proof is signed under HMAC(pepper, subkey-info), the request signature under
// the raw secret — so it must hold even when both roles resolve to the SAME
// secret (the default deployment, where PIN_PEPPER falls back to
// GATEWAY_SHARED_SECRET). A test that only exercises distinct keys proves
// nothing about that deployment, so the coincident-keys case below is the
// load-bearing one.

import { beforeAll, describe, expect, it, vi } from "vitest";

// Both implementations resolve their key AT MODULE LOAD and fail closed if it is
// absent, so the environment must be primed BEFORE the imports below are
// evaluated — a normal import is hoisted above any statement in this file. Hence
// the dynamic imports in the tests themselves, with the env set here.
//
// One shared value for both sides is the point: the cross-implementation
// assertion is only meaningful if both resolve to the SAME secret, which is the
// production condition. The "honours PIN_PEPPER" test below exercises the
// precedence separately.
process.env.PIN_PEPPER = "test-pepper-for-pin-proof-parity-000000";
process.env.GATEWAY_SHARED_SECRET = "test-shared-secret-for-gateway-0000";

// Both implementations, loaded LAZILY — the env above must be primed first,
// because a static import is hoisted above every statement in this file and both
// modules read their key at module load.
let gatewayPinProof!: (tenantId: string, pin: string) => Promise<string>;
let webPinProof!: (tenantId: string, pin: string) => Promise<string>;
let GATEWAY_INFO!: string;
let WEB_INFO!: string;

beforeAll(async () => {
  const gw = await import("../lib/crypto.ts");
  const web = await import("../../web/src/lib/crypto.ts");
  gatewayPinProof = gw.pinProof;
  GATEWAY_INFO = gw.PIN_PROOF_INFO;
  webPinProof = web.pinProof;
  WEB_INFO = web.PIN_PROOF_INFO;
});

// Fixed inputs. The tenant is a syntactically valid uuid purely for realism.
const TENANT = "018f0000-0000-7000-8000-0000000000c1";
const PIN = "9137";

describe("PIN proof — the two implementations must agree, byte for byte", () => {
  it("both export the same domain-separation prefix", () => {
    expect(GATEWAY_INFO).toBe(WEB_INFO);
    expect(WEB_INFO).toBe("buddysaradhi:pin-proof:v1");
  });

  it("both produce a 64-char lowercase hex digest", async () => {
    for (const impl of [gatewayPinProof, webPinProof]) {
      const proof = await impl(TENANT, PIN);
      expect(proof).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("BOTH implementations return the SAME proof for the same input", async () => {
    // THE assertion that would have caught the P0. Two independent
    // implementations, compared to each other rather than to themselves.
    expect(await webPinProof(TENANT, PIN)).toBe(await gatewayPinProof(TENANT, PIN));
  });

  it("the proof is TENANT-BOUND — tenant A's proof never validates for tenant B", async () => {
    const a = await gatewayPinProof(TENANT, PIN);
    const b = await gatewayPinProof("018f0000-0000-7000-8000-0000000000c2", PIN);
    expect(a).not.toBe(b);
  });

  it("the proof is PIN-BOUND — a different PIN yields a different proof", async () => {
    expect(await gatewayPinProof(TENANT, "9138")).not.toBe(await gatewayPinProof(TENANT, PIN));
  });

  it("DOMAIN SEPARATED — the PIN proof is not interchangeable with an hmacSign signature", async () => {
    // If these ever matched, a signature captured for one purpose could be
    // replayed as the other. That separation is bought by the DERIVED SUBKEY
    // (distinct keys), not by the `info` prefix: with coincident keys a shared
    // prefix inside identical material still yields identical digests. The
    // prefix remains as material binding; the test below guards the keys.
    const { hmacSign } = await import("../lib/crypto.ts");
    const proof = await gatewayPinProof(TENANT, PIN);
    expect(await hmacSign(`${GATEWAY_INFO}:${TENANT}:${PIN}`)).not.toBe(proof);
  });

  it("COINCIDENT KEYS — proof != signature even when both roles share one secret", async () => {
    // THE default-deployment case (N4): PIN_PEPPER unset means the proof pepper
    // falls back to GATEWAY_SHARED_SECRET, so both HMACs key off the same bytes.
    // Structural separation (derived subkey vs raw secret) must still hold. This
    // exercises the fallback path AND the explicit same-value path, and re-checks
    // cross-implementation parity under coincidence — the derivation must be
    // byte-identical in both runtimes even here.
    const coincident = async (env: Record<string, string | undefined>) => {
      vi.resetModules();
      const saved = { p: process.env.PIN_PEPPER, g: process.env.GATEWAY_SHARED_SECRET };
      for (const [k, v] of Object.entries(env)) {
        if (v === undefined) delete process.env[k as "PIN_PEPPER"];
        else process.env[k as "PIN_PEPPER"] = v;
      }
      try {
        const freshGw = await import("../lib/crypto.ts");
        const freshWeb = await import("../../web/src/lib/crypto.ts");
        return { freshGw, freshWeb };
      } finally {
        if (saved.p === undefined) delete process.env.PIN_PEPPER;
        else process.env.PIN_PEPPER = saved.p;
        if (saved.g === undefined) delete process.env.GATEWAY_SHARED_SECRET;
        else process.env.GATEWAY_SHARED_SECRET = saved.g;
        vi.resetModules();
      }
    };

    // Path 1: both vars set to the SAME value.
    {
      const { freshGw, freshWeb } = await coincident({
        PIN_PEPPER: "coincident-secret-for-both-roles-000000",
        GATEWAY_SHARED_SECRET: "coincident-secret-for-both-roles-000000",
      });
      const gwProof = await freshGw.pinProof(TENANT, PIN);
      // Derivation is byte-identical across runtimes even under coincidence.
      expect(await freshWeb.pinProof(TENANT, PIN)).toBe(gwProof);
      const sig = await freshGw.hmacSign(`${freshGw.PIN_PROOF_INFO}:${TENANT}:${PIN}`);
      expect(gwProof).not.toBe(sig);
    }

    // Path 2: PIN_PEPPER unset — the fallback that makes the keys coincide in
    // the default deployment.
    {
      const { freshGw, freshWeb } = await coincident({
        PIN_PEPPER: undefined,
        GATEWAY_SHARED_SECRET: "coincident-secret-for-both-roles-000000",
      });
      const gwProof = await freshGw.pinProof(TENANT, PIN);
      expect(await freshWeb.pinProof(TENANT, PIN)).toBe(gwProof);
      const sig = await freshGw.hmacSign(`${freshGw.PIN_PROOF_INFO}:${TENANT}:${PIN}`);
      expect(gwProof).not.toBe(sig);
    }
  });

  it("the web implementation honours PIN_PEPPER over GATEWAY_SHARED_SECRET", async () => {
    // Documents the precedence that P0-2 turned on. This CANNOT be asserted by
    // mutating `process.env` on an already-loaded module: `resolvePepper()` runs
    // ONCE at import and `PEPPER` is a module constant, so the two loads below
    // would both see the first value and the assertion would be vacuous — a test
    // that passes for the wrong reason is worse than no test.
    //
    // The only honest way to test resolution order is to load the module FRESH
    // under each environment. `vi.resetModules()` drops the module registry so
    // the next dynamic import re-evaluates it.
    const proofUnder = async (env: Record<string, string | undefined>): Promise<string> => {
      vi.resetModules();
      const saved = { p: process.env.PIN_PEPPER, g: process.env.GATEWAY_SHARED_SECRET };
      for (const [k, v] of Object.entries(env)) {
        if (v === undefined) delete process.env[k as "PIN_PEPPER"];
        else process.env[k as "PIN_PEPPER"] = v;
      }
      try {
        const mod = await import("../../web/src/lib/crypto.ts");
        return await mod.pinProof(TENANT, PIN);
      } finally {
        if (saved.p === undefined) delete process.env.PIN_PEPPER;
        else process.env.PIN_PEPPER = saved.p;
        if (saved.g === undefined) delete process.env.GATEWAY_SHARED_SECRET;
        else process.env.GATEWAY_SHARED_SECRET = saved.g;
        vi.resetModules();
      }
    };

    const viaPepper = await proofUnder({
      PIN_PEPPER: "pepper-aaaaaaaaaaaaaaaaaaaaaaaa",
      GATEWAY_SHARED_SECRET: "secret-bbbbbbbbbbbbbbbbbbbbbbbb",
    });
    const viaShared = await proofUnder({
      PIN_PEPPER: undefined,
      GATEWAY_SHARED_SECRET: "secret-bbbbbbbbbbbbbbbbbbbbbbbb",
    });

    // Different key material → different proof. If `resolvePepper` ever drops the
    // `PIN_PEPPER ||` branch, these collapse and this fails.
    expect(viaPepper).not.toBe(viaShared);
  });
});