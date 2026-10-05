// Implements: 01_Product_Principles.md P5 (offline-first) — storage-persist
// paths: granted / denied / unsupported / no-API, with no DB and no network.
import { describe, expect, it, afterEach, vi } from "vitest";
import {
  estimateStorage,
  formatBytes,
  isPersistenceSupported,
  persistedState,
  requestPersistence,
} from "./storage-persist";

function setNavigatorStorage(mock: unknown): void {
  vi.stubGlobal("navigator", { storage: mock });
}

function setNavigatorWithoutStorage(): void {
  vi.stubGlobal("navigator", {});
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isPersistenceSupported", () => {
  it("returns false when navigator.storage is missing", () => {
    setNavigatorWithoutStorage();
    expect(isPersistenceSupported()).toBe(false);
  });

  it("returns false when persist is not a function", () => {
    setNavigatorStorage({ persisted: () => Promise.resolve(false) });
    expect(isPersistenceSupported()).toBe(false);
  });

  it("returns true when persist and persisted are functions", () => {
    setNavigatorStorage({
      persist: () => Promise.resolve(true),
      persisted: () => Promise.resolve(false),
    });
    expect(isPersistenceSupported()).toBe(true);
  });

  it("returns false when navigator itself is missing (SSR)", () => {
    vi.stubGlobal("navigator", undefined);
    expect(isPersistenceSupported()).toBe(false);
  });
});

describe("persistedState", () => {
  it("returns unsupported when the API is missing", async () => {
    setNavigatorWithoutStorage();
    await expect(persistedState()).resolves.toBe("unsupported");
  });

  it("returns persisted when the browser confirms it", async () => {
    setNavigatorStorage({
      persist: () => Promise.resolve(true),
      persisted: () => Promise.resolve(true),
    });
    await expect(persistedState()).resolves.toBe("persisted");
  });

  it("returns not-persisted when the browser reports false", async () => {
    setNavigatorStorage({
      persist: () => Promise.resolve(true),
      persisted: () => Promise.resolve(false),
    });
    await expect(persistedState()).resolves.toBe("not-persisted");
  });

  it("returns not-persisted instead of throwing when the read rejects", async () => {
    setNavigatorStorage({
      persist: () => Promise.resolve(true),
      persisted: () => Promise.reject(new Error("read failed")),
    });
    await expect(persistedState()).resolves.toBe("not-persisted");
  });
});

describe("requestPersistence", () => {
  it("returns unavailable with a code when the API is missing", async () => {
    setNavigatorWithoutStorage();
    const result = await requestPersistence();
    expect(result).toEqual({
      success: false,
      outcome: "unavailable",
      code: "UNKNOWN",
      message: expect.any(String),
    });
    if (!result.success) {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("returns granted when the browser accepts", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    setNavigatorStorage({ persist, persisted: () => Promise.resolve(false) });
    await expect(requestPersistence()).resolves.toEqual({ success: true, outcome: "granted" });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("returns denied (still success) when the browser refuses", async () => {
    setNavigatorStorage({
      persist: () => Promise.resolve(false),
      persisted: () => Promise.resolve(false),
    });
    await expect(requestPersistence()).resolves.toEqual({ success: true, outcome: "denied" });
  });

  it("returns a classified error without echoing raw text when persist throws", async () => {
    const raw = "persist blew up secret-token-abc123";
    setNavigatorStorage({
      persist: () => Promise.reject(new Error(raw)),
      persisted: () => Promise.resolve(false),
    });
    const result = await requestPersistence();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.outcome).toBe("error");
      expect(typeof result.code).toBe("string");
      expect(result.message).not.toContain("secret-token-abc123");
    }
  });
});

describe("estimateStorage", () => {
  it("returns null when the API is missing", async () => {
    setNavigatorWithoutStorage();
    await expect(estimateStorage()).resolves.toBeNull();
  });

  it("returns usage and quota in bytes when the browser reports them", async () => {
    setNavigatorStorage({ estimate: () => Promise.resolve({ usage: 4404019, quota: 1073741824 }) });
    await expect(estimateStorage()).resolves.toEqual({ usageBytes: 4404019, quotaBytes: 1073741824 });
  });

  it("returns a null quota when the browser hides it", async () => {
    setNavigatorStorage({ estimate: () => Promise.resolve({ usage: 512 }) });
    await expect(estimateStorage()).resolves.toEqual({ usageBytes: 512, quotaBytes: null });
  });

  it("returns null instead of throwing when the read rejects", async () => {
    setNavigatorStorage({ estimate: () => Promise.reject(new Error("no estimate")) });
    await expect(estimateStorage()).resolves.toBeNull();
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1023, "1023 B"],
    [1024, "1 KB"],
    [1536, "1.5 KB"],
    [1048576, "1 MB"],
    [4404019, "4.2 MB"],
    [1073741824, "1 GB"],
  ])("formats %i bytes as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("falls back to 0 B for %s", (bytes) => {
    expect(formatBytes(bytes)).toBe("0 B");
  });
});
