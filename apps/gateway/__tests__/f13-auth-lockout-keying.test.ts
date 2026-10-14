// Implements: F-13 (15-attempt auth lockout keyed by the pre-identity stable
// key) + 10_Security.md §3.5 (cumulative count resets on success, server-side
// analogue). `index.ts` wires these primitives: failures call
// `trackFailedAuth(secCheck.clientIp)` on the AuthError path, success calls
// `clearFailedAuth(secCheck.clientIp)` — `index.ts` itself cannot run under
// vitest (it calls `Deno.serve` at import), so this file pins the mechanism
// it depends on: per-key accumulation to 15, reset on success, isolation
// between keys, stability of the key across credential changes, and the
// credential-failure policy that keeps server errors out of the lockout.
import { describe, expect, it, beforeEach } from "vitest";
import {
  trackFailedAuth,
  clearFailedAuth,
  getClientIp,
  isCredentialFailure,
} from "../lib/security.ts";

let keySeq = 0;
function freshKey(prefix: string): string {
  keySeq += 1;
  return `${prefix}-f13-${keySeq}-${Date.now()}`;
}

function ipReq(headers: Record<string, string>): Request {
  return new Request("https://example.com/api/v1/students", { headers });
}

describe("F-13 — isCredentialFailure names which failures feed the lockout", () => {
  it("counts missing/wrong credentials", () => {
    expect(isCredentialFailure("UNAUTHENTICATED")).toBe(true);
    expect(isCredentialFailure("AUTH_REQUIRED")).toBe(true);
  });

  it("does NOT count server misconfiguration or existing throttling", () => {
    expect(isCredentialFailure("INTERNAL")).toBe(false);
    expect(isCredentialFailure("RATE_LIMITED")).toBe(false);
  });

  it("is closed to unknown codes (fail-closed, exact match)", () => {
    expect(isCredentialFailure("")).toBe(false);
    expect(isCredentialFailure("unauthenticated")).toBe(false);
    expect(isCredentialFailure("UNAUTHENTICATED ")).toBe(false);
  });
});

describe("F-13 — N failures from one key lock (threshold is 15)", () => {
  let key = "";
  beforeEach(() => {
    key = freshKey("203.0.113.7");
  });

  it("locks on the 15th consecutive failure, not before", () => {
    for (let i = 1; i <= 14; i++) {
      const result = trackFailedAuth(key);
      expect(result.locked).toBe(false);
      expect(result.attempts).toBe(i);
    }
    const locked = trackFailedAuth(key);
    expect(locked.locked).toBe(true);
    expect(locked.attempts).toBe(15);
  });

  it("stays locked past 15 while failures continue", () => {
    for (let i = 0; i < 15; i++) trackFailedAuth(key);
    const again = trackFailedAuth(key);
    expect(again.locked).toBe(true);
    expect(again.attempts).toBe(16);
  });

  it("success resets the count (what index.ts does via clearFailedAuth)", () => {
    for (let i = 0; i < 5; i++) trackFailedAuth(key);
    clearFailedAuth(key);
    const after = trackFailedAuth(key);
    expect(after.attempts).toBe(1);
    expect(after.locked).toBe(false);
  });
});

describe("F-13 — keys are isolated per client identity", () => {
  it("a locked key does not affect another key", () => {
    const attacker = freshKey("198.51.100.7");
    const tutor = freshKey("203.0.113.9");
    for (let i = 0; i < 15; i++) trackFailedAuth(attacker);
    expect(trackFailedAuth(attacker).locked).toBe(true);
    const innocent = trackFailedAuth(tutor);
    expect(innocent.attempts).toBe(1);
    expect(innocent.locked).toBe(false);
  });

  it("distinct keys never accumulate toward each other", () => {
    const keys = [freshKey("a"), freshKey("b"), freshKey("c")];
    for (const k of keys) {
      expect(trackFailedAuth(k).attempts).toBe(1);
    }
  });
});

describe("F-13 — the lockout key is stable across credential changes", () => {
  it("same transport identity, different credentials → same key", () => {
    const attemptA = ipReq({
      "x-forwarded-for": "198.51.100.7",
      authorization: "Bearer wrong-token-one",
    });
    const attemptB = ipReq({
      "x-forwarded-for": "198.51.100.7",
      authorization: "Bearer wrong-token-two",
    });
    // Rotating the presented credential (or dropping it) must not rotate the
    // bucket: the key comes from the transport identity, which the caller
    // cannot change per request.
    expect(getClientIp(attemptA)).toBe(getClientIp(attemptB));
  });

  it("accumulating under the derived key locks; a different identity starts fresh", () => {
    const attackerIp = `198.51.100.${100 + (keySeq % 100)}`;
    keySeq += 1;
    for (let i = 0; i < 15; i++) {
      const req = ipReq({ "x-forwarded-for": attackerIp });
      trackFailedAuth(getClientIp(req));
    }
    const lockedReq = ipReq({ "x-forwarded-for": attackerIp });
    expect(trackFailedAuth(getClientIp(lockedReq)).locked).toBe(true);
    const otherReq = ipReq({ "x-forwarded-for": `203.0.113.${100 + (keySeq % 100)}` });
    const fresh = trackFailedAuth(getClientIp(otherReq));
    expect(fresh.attempts).toBe(1);
    expect(fresh.locked).toBe(false);
  });
});
