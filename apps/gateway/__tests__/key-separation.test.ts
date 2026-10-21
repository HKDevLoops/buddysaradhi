// Implements: docs/rfc/gated-review-packet-phases-1-3-4.md Phase 3 (key
// separation) + docs/adr/0006-data-signing-key-separation.md + AGENTS.md
// Rule 9 (fail-closed, loud).
//
// crypto.ts resolves its secrets at MODULE LOAD, so each case below resets the
// module registry and re-imports with its own env — a beforeEach would run too
// late. `vi.mock` on ../lib/log.ts is file-scoped (hoisted), so the warn
// assertions observe the real boot path, not a stub. Each file in this suite
// runs in its own worker (vitest `isolate`), so mutating process.env here
// cannot move another file's already-captured module constants.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../lib/log.ts", () => ({
  logWarn: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

import { logWarn } from "../lib/log.ts";

const SHARED = "gateway-shared-secret-that-is-at-least-32-chars";
const DATA = "gateway-data-key-that-is-at-least-32-chars-000";
const PEPPER = "gateway-pin-pepper-that-is-at-least-32-chars";
const saved = new Map<string, string | undefined>();

function setEnv(name: string, value: string | undefined): void {
  if (!saved.has(name)) saved.set(name, process.env[name]);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** Dev context: strength gates warn instead of throwing, so key MODE is isolated. */
function devContext(): void {
  setEnv("DENO_DEPLOYMENT_ID", undefined);
  setEnv("DENO_ENV", undefined);
}

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
  vi.mocked(logWarn).mockClear();
});

function freshCrypto(): Promise<typeof import("../lib/crypto.ts")> {
  vi.resetModules();
  return import("../lib/crypto.ts");
}

function fallbackWarnCalls(): Array<Record<string, unknown>> {
  return vi.mocked(logWarn).mock.calls
    .filter(([event]) => event === "crypto.data_key_fallback")
    .map(([, data]) => (data ?? {}) as Record<string, unknown>);
}

describe("key separation — fallback engages LOUD, never silent (Rule 9)", () => {
  it("emits crypto.data_key_fallback naming the missing var when DATA is unset", async () => {
    devContext();
    setEnv("GATEWAY_SHARED_SECRET", SHARED);
    setEnv("DATA_ENCRYPTION_KEY", undefined);
    setEnv("STRICT_KEY_SEPARATION", undefined);
    const crypto = await freshCrypto();
    expect(crypto.isDataKeyFallback()).toBe(true);
    const warns = fallbackWarnCalls();
    expect(warns).toHaveLength(1);
    expect(warns[0]?.["missing"]).toBe("DATA_ENCRYPTION_KEY");
    // The warn names variables, never values (10_Security.md §8).
    const raw = JSON.stringify(warns);
    expect(raw).not.toContain(SHARED);
    expect(raw).not.toContain(DATA);
  });

  it("stays silent (no fallback warn) when DATA is explicitly set", async () => {
    devContext();
    setEnv("GATEWAY_SHARED_SECRET", SHARED);
    setEnv("DATA_ENCRYPTION_KEY", DATA);
    setEnv("STRICT_KEY_SEPARATION", undefined);
    const crypto = await freshCrypto();
    expect(crypto.isDataKeyFallback()).toBe(false);
    expect(fallbackWarnCalls()).toHaveLength(0);
  });
});

describe("key separation — STRICT_KEY_SEPARATION refuses the coupled mode", () => {
  it("STRICT on + DATA unset refuses boot (fail-closed, every environment)", async () => {
    devContext();
    setEnv("GATEWAY_SHARED_SECRET", SHARED);
    setEnv("DATA_ENCRYPTION_KEY", undefined);
    setEnv("STRICT_KEY_SEPARATION", "true");
    setEnv("PIN_PEPPER", PEPPER);
    await expect(freshCrypto()).rejects.toThrow(
      /STRICT_KEY_SEPARATION is on but DATA_ENCRYPTION_KEY is not set/,
    );
  });

  it("STRICT on + DATA unset refuses boot even when deployed", async () => {
    setEnv("DENO_DEPLOYMENT_ID", "dep-abc123");
    setEnv("DENO_ENV", undefined);
    setEnv("GATEWAY_SHARED_SECRET", SHARED);
    setEnv("DATA_ENCRYPTION_KEY", undefined);
    setEnv("STRICT_KEY_SEPARATION", "true");
    setEnv("PIN_PEPPER", PEPPER);
    await expect(freshCrypto()).rejects.toThrow(/STRICT_KEY_SEPARATION is on/);
  });

  it("STRICT on + DATA set boots separated, round-trips, and differs from the signing key", async () => {
    devContext();
    setEnv("GATEWAY_SHARED_SECRET", SHARED);
    setEnv("DATA_ENCRYPTION_KEY", DATA);
    setEnv("STRICT_KEY_SEPARATION", "true");
    setEnv("PIN_PEPPER", PEPPER);
    const crypto = await freshCrypto();
    expect(crypto.isStrictKeySeparation()).toBe(true);
    expect(crypto.isDataKeyFallback()).toBe(false);
    // hmacSign wire values untouched: still keyed off the raw shared secret.
    expect(crypto.getHmacSecret()).toBe(SHARED);
    const plaintext = "separated-transport-body";
    const ciphertext = await crypto.encryptResponse(plaintext);
    expect(await crypto.decryptRequest(ciphertext)).toBe(plaintext);
    // The data key is NOT the signing key: a module fallen back to the HMAC
    // secret cannot read what the separated key wrote.
    setEnv("DATA_ENCRYPTION_KEY", undefined);
    setEnv("STRICT_KEY_SEPARATION", undefined);
    const coupled = await freshCrypto();
    expect(coupled.isDataKeyFallback()).toBe(true);
    await expect(coupled.decryptRequest(ciphertext)).rejects.toThrow();
  });
});

describe("key separation — STRICT off + DATA unset behaves exactly as today", () => {
  it("falls back to the HMAC bytes: an explicitly-set identical key reads fallback ciphertext", async () => {
    devContext();
    setEnv("GATEWAY_SHARED_SECRET", SHARED);
    setEnv("DATA_ENCRYPTION_KEY", undefined);
    setEnv("STRICT_KEY_SEPARATION", undefined);
    const fallback = await freshCrypto();
    expect(fallback.isStrictKeySeparation()).toBe(false);
    expect(fallback.isDataKeyFallback()).toBe(true);
    expect(fallback.getHmacSecret()).toBe(SHARED);
    const plaintext = "byte-identical-default-behaviour";
    const ciphertext = await fallback.encryptResponse(plaintext);
    // Same bytes, stated explicitly: decrypts what the fallback wrote.
    setEnv("DATA_ENCRYPTION_KEY", SHARED);
    const explicit = await freshCrypto();
    expect(explicit.isDataKeyFallback()).toBe(false);
    expect(await explicit.decryptRequest(ciphertext)).toBe(plaintext);
    expect(await fallback.decryptRequest(ciphertext)).toBe(plaintext);
  });
});

describe("key separation — the PIN pepper must be its own secret in strict mode", () => {
  it("STRICT on + PIN_PEPPER unset refuses boot (the pepper is the signing key otherwise)", async () => {
    devContext();
    setEnv("GATEWAY_SHARED_SECRET", SHARED);
    setEnv("DATA_ENCRYPTION_KEY", DATA);
    setEnv("STRICT_KEY_SEPARATION", "true");
    setEnv("PIN_PEPPER", undefined);
    await expect(freshCrypto()).rejects.toThrow(
      /PIN_PEPPER is not set to a value distinct from GATEWAY_SHARED_SECRET/,
    );
  });

  it("STRICT on + PIN_PEPPER equal to the shared secret refuses boot", async () => {
    devContext();
    setEnv("GATEWAY_SHARED_SECRET", SHARED);
    setEnv("DATA_ENCRYPTION_KEY", DATA);
    setEnv("STRICT_KEY_SEPARATION", "true");
    setEnv("PIN_PEPPER", SHARED);
    await expect(freshCrypto()).rejects.toThrow(/PIN_PEPPER is not set to a value distinct/);
  });

  it("STRICT off + PIN_PEPPER unset boots (the default deployment, unchanged)", async () => {
    devContext();
    setEnv("GATEWAY_SHARED_SECRET", SHARED);
    setEnv("DATA_ENCRYPTION_KEY", DATA);
    setEnv("STRICT_KEY_SEPARATION", undefined);
    setEnv("PIN_PEPPER", undefined);
    const crypto = await freshCrypto();
    expect(crypto.isStrictKeySeparation()).toBe(false);
  });
});
