import { describe, it, expect, vi } from "vitest";

// Set env vars BEFORE crypto.ts is imported.
// vi.hoisted runs before module imports in vitest.
vi.hoisted(() => {
  process.env.GATEWAY_SHARED_SECRET = "test-secret-that-is-at-least-32-chars-long-ok";
  process.env.DATA_ENCRYPTION_KEY = "test-encryption-key-that-is-at-least-32-characters";
});

// Mock logWarn/logError — crypto.ts imports ./log.ts at module level
vi.mock("../lib/log.ts", () => ({
  logWarn: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

import {
  hmacSign,
  hmacVerify,
  encryptResponse,
  decryptRequest,
  getHmacSecret,
  checkRateLimit,
} from "../lib/crypto.ts";

describe("hmacSign / hmacVerify", () => {
  it("produces a hex signature", async () => {
    const sig = await hmacSign("hello");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", async () => {
    const a = await hmacSign("data");
    const b = await hmacSign("data");
    expect(a).toBe(b);
  });

  it("produces different signatures for different inputs", async () => {
    const a = await hmacSign("data-1");
    const b = await hmacSign("data-2");
    expect(a).not.toBe(b);
  });

  it("verify accepts a valid signature", async () => {
    const sig = await hmacSign("payload");
    expect(await hmacVerify("payload", sig)).toBe(true);
  });

  it("verify rejects a tampered signature", async () => {
    const sig = await hmacSign("payload");
    const tampered = sig.slice(0, -2) + (sig.endsWith("ff") ? "00" : "ff");
    expect(await hmacVerify("payload", tampered)).toBe(false);
  });

  it("verify rejects a wrong-length signature", async () => {
    expect(await hmacVerify("payload", "abc")).toBe(false);
  });

  it("verify rejects an empty signature", async () => {
    expect(await hmacVerify("payload", "")).toBe(false);
  });
});

describe("getHmacSecret", () => {
  it("returns the configured secret", () => {
    expect(getHmacSecret()).toBe("test-secret-that-is-at-least-32-chars-long-ok");
  });
});

describe("encryptResponse / decryptRequest round-trip", () => {
  it("encrypts and decrypts back to original", async () => {
    const plaintext = "Hello, encrypted world!";
    const encrypted = await encryptResponse(plaintext);
    expect(encrypted).not.toBe(plaintext);
    const decrypted = await decryptRequest(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertexts for the same plaintext (random salt/iv)", async () => {
    const a = await encryptResponse("same");
    const b = await encryptResponse("same");
    expect(a).not.toBe(b);
  });

  it("handles empty string", async () => {
    const encrypted = await encryptResponse("");
    const decrypted = await decryptRequest(encrypted);
    expect(decrypted).toBe("");
  });

  it("handles large payloads", async () => {
    const large = "x".repeat(10_000);
    const encrypted = await encryptResponse(large);
    const decrypted = await decryptRequest(encrypted);
    expect(decrypted).toBe(large);
  });

  it("throws on too-short ciphertext", async () => {
    await expect(decryptRequest("AAAA")).rejects.toThrow("invalid ciphertext: too short");
  });

  it("throws on corrupted ciphertext", async () => {
    const enc = await encryptResponse("test");
    const corrupted = enc.slice(0, 10) + "AAAA" + enc.slice(14);
    await expect(decryptRequest(corrupted)).rejects.toThrow();
  });
});

describe("checkRateLimit", () => {
  it("allows first request", () => {
    expect(checkRateLimit("rl-test-1", 5, 60_000)).toBe(true);
  });

  it("allows requests under limit", () => {
    const tenant = "rl-test-under";
    for (let i = 0; i < 4; i++) {
      checkRateLimit(tenant, 5, 60_000);
    }
    expect(checkRateLimit(tenant, 5, 60_000)).toBe(true);
  });

  it("rejects requests over limit", () => {
    const tenant = "rl-test-over";
    for (let i = 0; i < 6; i++) {
      checkRateLimit(tenant, 5, 60_000);
    }
    expect(checkRateLimit(tenant, 5, 60_000)).toBe(false);
  });

  it("uses unique keys per tenant", () => {
    expect(checkRateLimit("rl-tenant-a", 1, 60_000)).toBe(true);
    expect(checkRateLimit("rl-tenant-b", 1, 60_000)).toBe(true);
  });
});
