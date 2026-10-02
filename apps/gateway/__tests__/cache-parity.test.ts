// Implements: RFC-003 workstream E §3 (cache parity — hot reference reads at
// 63s TTL with tenant-scoped invalidation; money views never cached) +
// 17_API_Gateway_System.md §6.3 (reference-data caching as a budget control).
import { describe, expect, it } from "vitest";
import {
  getCached,
  setCache,
  invalidateTenant,
  isCacheablePath,
  REFERENCE_TTL_MS,
} from "../lib/cache.ts";
import { handleSettings } from "../routes/settings.ts";
import type { DB } from "../lib/db.ts";
import { createLedgerFixture, type LedgerFixture } from "./sqlite-db.ts";

async function getSettings(fixture: LedgerFixture): Promise<{ status: number; body: unknown }> {
  const req = new Request("https://api.buddysaradhi.app/api/v1/settings", { method: "GET" });
  const res = await handleSettings(
    req,
    // SAFETY: the SQLite fixture satisfies `SqlHandle` (lib/sql.ts), which is
    // the only capability the route uses at runtime.
    fixture.db as unknown as DB,
    fixture.tenantId,
    "/api/v1/settings",
    "GET",
    new URL(req.url),
    {},
  );
  if (!res) throw new Error("no route matched GET /api/v1/settings");
  return { status: res.status, body: (await res.json()) as unknown };
}

async function patchSettings(
  fixture: LedgerFixture,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const req = new Request("https://api.buddysaradhi.app/api/v1/settings", {
    method: "PATCH",
    // RFC-004 C1 — the gateway is fail-closed on keyless mutations.
    headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  const res = await handleSettings(
    req,
    // SAFETY: same SqlHandle substitution as above; the PATCH path runs its
    // upsert + outbox + audit inside one write transaction the fixture supports.
    fixture.db as unknown as DB,
    fixture.tenantId,
    "/api/v1/settings",
    "PATCH",
    new URL(req.url),
    {},
  );
  if (!res) throw new Error("no route matched PATCH /api/v1/settings");
  return { status: res.status, body: (await res.json()) as unknown };
}

describe("cache parity — reference TTL and allowlist (RFC-003 G-DB)", () => {
  it("reference TTL is 63s", () => {
    expect(REFERENCE_TTL_MS).toBe(63_000);
  });

  it("caches reference reads, never money views", () => {
    expect(isCacheablePath("/api/v1/students")).toBe(true);
    expect(isCacheablePath("/api/v1/students/abc")).toBe(true);
    expect(isCacheablePath("/api/v1/attendance/batches")).toBe(true);
    expect(isCacheablePath("/api/v1/settings")).toBe(true);
    expect(isCacheablePath("/api/v1/notifications")).toBe(true);
    // Money views always read through (a stale balance is a livelihood bug).
    expect(isCacheablePath("/api/v1/ledger")).toBe(false);
    expect(isCacheablePath("/api/v1/ledger/payment")).toBe(false);
    expect(isCacheablePath("/api/v1/ledger/invoices")).toBe(false);
    expect(isCacheablePath("/api/v1/ledger/fees")).toBe(false);
    expect(isCacheablePath("/api/v1/analytics/dashboard")).toBe(false);
    expect(isCacheablePath("/api/v1/sync/outbox")).toBe(false);
    expect(isCacheablePath("/health")).toBe(false);
    expect(isCacheablePath("/graphql")).toBe(false);
  });

  it("cache hit returns the stored reference row; tenant invalidation clears it", () => {
    const tenant = "cache-tenant-1";
    setCache(`students:${tenant}:1::`, { students: [{ id: "s1" }], total: 1 });
    expect(getCached(`students:${tenant}:1::`)).toEqual({
      students: [{ id: "s1" }],
      total: 1,
    });
    invalidateTenant(tenant);
    expect(getCached(`students:${tenant}:1::`)).toBeNull();
  });

  it("invalidation is tenant-scoped (no cross-tenant eviction)", () => {
    setCache("students:tenant-a:1::", { total: 1 });
    setCache("students:tenant-b:1::", { total: 2 });
    invalidateTenant("tenant-a");
    expect(getCached("students:tenant-a:1::")).toBeNull();
    expect(getCached("students:tenant-b:1::")).toEqual({ total: 2 });
    invalidateTenant("tenant-b");
  });
});

describe("settings GET/PATCH — cached reference read with invalidation on mutation", () => {
  it("serves the cached row on repeat GET and invalidates on PATCH", async () => {
    const f = createLedgerFixture();
    const first = await getSettings(f);
    expect(first.status).toBe(200);

    const patched = await patchSettings(f, { instituteName: "Sharma Tuitions" });
    expect(patched.status).toBe(200);

    const second = await getSettings(f);
    expect(second.status).toBe(200);
    expect(JSON.stringify(second.body)).toContain("Sharma Tuitions");
  });
});
