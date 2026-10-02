// Implements: docs/rfc/004-multi-device-network-contract.md C1 (key shape,
// uniqueness, determinism) + K1 (identical payload → identical stable key).

import { describe, it, expect } from "vitest";
import {
  mintIntentKey,
  intentKeyFrom,
  isIntentKey,
  getIntentKeyEntropy,
  hash64Hex,
} from "./intent-key";

describe("mintIntentKey (RFC-004 C1)", () => {
  it("produces UUID shape with version nibble 7 and RFC variant", () => {
    const key = mintIntentKey(1717171717171);
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(isIntentKey(key)).toBe(true);
  });

  it("encodes the timestamp prefix (lexicographically sortable by creation)", () => {
    const earlier = mintIntentKey(1000);
    const later = mintIntentKey(2000);
    expect(earlier < later).toBe(true);
  });

  it("mints unique keys for the same millisecond", () => {
    const keys = new Set(Array.from({ length: 50 }, () => mintIntentKey(9999)));
    expect(keys.size).toBe(50);
  });

  it("uses WebCrypto entropy in this runtime (surfaced, never silent)", () => {
    mintIntentKey();
    expect(getIntentKeyEntropy()).toBe("webcrypto");
  });

  it("clamps negative clock input instead of throwing", () => {
    expect(isIntentKey(mintIntentKey(-5))).toBe(true);
  });
});

describe("intentKeyFrom (RFC-004 K1 dedup)", () => {
  it("is deterministic for the same payload", () => {
    const payload = { studentId: "s-1", amountPaise: 150000, method: "cash" };
    expect(intentKeyFrom(payload)).toBe(intentKeyFrom(payload));
    expect(intentKeyFrom(payload)).toMatch(/^stk_[0-9a-f]{16}$/);
  });

  it("is field-order insensitive (double-click rebuilds the same key)", () => {
    const a = { amountPaise: 150000, studentId: "s-1" };
    const b = { studentId: "s-1", amountPaise: 150000 };
    expect(intentKeyFrom(a)).toBe(intentKeyFrom(b));
  });

  it("differs for different payloads (distinct intents stay distinct)", () => {
    expect(intentKeyFrom({ amountPaise: 1 })).not.toBe(intentKeyFrom({ amountPaise: 2 }));
  });

  it("treats JSON-equivalent values the same (undefined fields dropped)", () => {
    expect(intentKeyFrom({ a: 1, b: undefined })).toBe(intentKeyFrom({ a: 1 }));
  });

  it("throws a typed TypeError for non-serializable top-level input", () => {
    expect(() => intentKeyFrom(undefined)).toThrow(TypeError);
  });
});

describe("hash64Hex", () => {
  it("returns 16 lowercase hex chars and is deterministic", () => {
    const h = hash64Hex("hello");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(hash64Hex("hello")).toBe(h);
    expect(hash64Hex("world")).not.toBe(h);
  });
});

describe("isIntentKey", () => {
  it("rejects non-keys", () => {
    expect(isIntentKey("")).toBe(false);
    expect(isIntentKey(null)).toBe(false);
    expect(isIntentKey(42)).toBe(false);
    expect(isIntentKey("550e8400-e29b-41d4-a716-446655440000")).toBe(false); // v4, not v7
    expect(isIntentKey("stk_SHORT")).toBe(false);
  });
});
