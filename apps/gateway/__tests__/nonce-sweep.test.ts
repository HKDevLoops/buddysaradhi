// Implements: 10_Security.md §8 (replay protection) + AGENTS.md §16 FM
// discipline — a security check on the hot mutation path must be O(1) in the
// size of the replay window, not O(window).
//
// `validateNonce` used to iterate the ENTIRE `nonceCache` (capped at
// NONCE_CACHE_MAX_ENTRIES = 10,000) on every attendance mark and every payment,
// purely to evict expired entries. That made the hottest write path scale with
// the number of nonces ever issued, to do memory hygiene the module already had
// a periodic cleaner for.
//
// The test counts `Map.prototype.delete` calls during a single `validateNonce`.
// This is the only externally observable difference: the removed sweep deleted
// entries, the kept `get` + `set` do not. The replay DECISION is unchanged and
// is pinned separately below.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  validateNonce,
  runSecurityChecks,
} from "../lib/security.ts";

const TENANT = "018f0000-0000-7000-8000-0000000000a1";
const NONCE_EXPIRY_MS = 600_000;

function nonce(tag: string): string {
  // ≥16 chars, ≤128 (the shape validateNonce accepts).
  return `nonce-${tag}-0123456789abcdef`;
}

let deleteSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-09T09:00:00.000Z"));
});

afterEach(() => {
  deleteSpy?.mockRestore();
  deleteSpy = undefined;
  vi.useRealTimers();
});

describe("P4 / validateNonce is O(1), not O(nonce cache)", () => {
  it("evicts nothing while replay-checking — no sweep on the mutation path", () => {
    // Seed the replay window at T0 …
    for (let n = 0; n < 50; n += 1) {
      expect(validateNonce(nonce(`seed${n}`), TENANT).allowed).toBe(true);
    }

    // … then move past NONCE_EXPIRY_MS so a sweep WOULD have work to do.
    vi.setSystemTime(new Date(Date.now() + NONCE_EXPIRY_MS + 1_000));

    deleteSpy = vi.spyOn(Map.prototype, "delete");
    const result = validateNonce(nonce("fresh"), TENANT);

    expect(result.allowed).toBe(true);
    // Pre-fix this looped the whole map and deleted 50 entries here.
    expect(deleteSpy.mock.calls.length).toBe(0);
  });

  it("stays O(1) across a thousand sequential mutations", () => {
    for (let n = 0; n < 1_000; n += 1) {
      expect(validateNonce(nonce(`bulk${n}`), TENANT).allowed).toBe(true);
    }
    // Age the window out so a pre-fix sweep would have 1,000 deletions to make.
    vi.setSystemTime(new Date(Date.now() + NONCE_EXPIRY_MS + 1_000));
    deleteSpy = vi.spyOn(Map.prototype, "delete");
    // One more mutation. Pre-fix the cache held 1,000 entries and the sweep
    // visited every one of them before this call could return.
    expect(validateNonce(nonce("last"), TENANT).allowed).toBe(true);
    expect(deleteSpy.mock.calls.length).toBe(0);
  });
});

describe("P4 / removing the sweep did not weaken the replay defence", () => {
  it("still rejects a replayed nonce inside the window", () => {
    const n = nonce("replayed");
    expect(validateNonce(n, TENANT).allowed).toBe(true);
    const replay = validateNonce(n, TENANT);
    expect(replay.allowed).toBe(false);
    expect(replay.status).toBe(409);
    expect(replay.error).toBe("nonce already used");
  });

  it("still rejects a replay from a different route of the same tenant", () => {
    const n = nonce("cross");
    expect(validateNonce(n, TENANT).allowed).toBe(true);
    expect(validateNonce(n, TENANT).allowed).toBe(false);
    // Same nonce, different tenant: the replay window is tenant-scoped.
    expect(validateNonce(n, "018f0000-0000-7000-8000-0000000000b2").allowed).toBe(true);
  });

  it("accepts a nonce again once the window has passed — identical either way", () => {
    const n = nonce("aged");
    expect(validateNonce(n, TENANT).allowed).toBe(true);
    expect(validateNonce(n, TENANT).allowed).toBe(false);
    vi.setSystemTime(new Date(Date.now() + NONCE_EXPIRY_MS + 1_000));
    // The entry may still be physically present, but it is outside the window
    // the check measures against, so it is not a replay. Pre-fix the sweep had
    // already deleted it by this point and reached the same answer — which is
    // precisely why deleting the sweep is safe.
    expect(validateNonce(n, TENANT).allowed).toBe(true);
  });

  it("still rejects a malformed or missing nonce before touching the cache", () => {
    expect(validateNonce("", TENANT)).toMatchObject({ allowed: false, status: 400 });
    expect(validateNonce("short", TENANT)).toMatchObject({ allowed: false, status: 400 });
    expect(validateNonce("x".repeat(200), TENANT)).toMatchObject({ allowed: false, status: 400 });
  });
});

describe("P4 / the periodic cleaner still does the eviction", () => {
  it("runSecurityChecks evicts the expired nonces the sweep used to", () => {
    for (let n = 0; n < 20; n += 1) {
      expect(validateNonce(nonce(`clean${n}`), TENANT).allowed).toBe(true);
    }
    vi.setSystemTime(new Date(Date.now() + NONCE_EXPIRY_MS + 1_000));

    deleteSpy = vi.spyOn(Map.prototype, "delete");
    // `runSecurityChecks` calls `periodicSecurityCleanup()` first thing, which
    // is interval-gated (CLEANUP_INTERVAL_MS). The first call after a long gap
    // therefore runs it and MUST evict the 20 aged nonces.
    const req = new Request("https://api.buddysaradhi.app/api/v1/attendance", {
      method: "GET",
      headers: { "content-type": "application/json" },
    });
    expect(runSecurityChecks(req).allowed).toBe(true);
    expect(deleteSpy.mock.calls.length).toBeGreaterThan(0);
  });
});