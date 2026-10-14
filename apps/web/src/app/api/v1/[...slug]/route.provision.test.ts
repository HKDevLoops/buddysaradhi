// Implements: RFC-009 §3.1 (delete the shared-DB fallback) + §5 test gate 3.
//
// THE DEFECT. When Turso provisioning errored, the provision route handed
// EVERY tutor the SAME database (`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`)
// and recorded it in their `user_metadata` as if provisioned. A Turso outage
// became a full cross-tenant roster, ledger and settings read — with
// `tenant_id` as the only boundary left, on a web path that did not enforce
// it (Finding A). The branch looked fail-safe (it fired when infrastructure
// was unhealthy) and was the opposite.
//
// THE FIX. The branch is deleted: unprovisionable sign-up returns 503 and
// writes NOTHING. A tutor who cannot provision retries; they are never
// silently merged (11_Data_Model.md §1).
//
// WHAT THIS PINS. With the OLD shared credentials present in the environment
// (the exact trigger), the route MUST still 503 and MUST NOT call
// `updateUserById` — no credentials may reach `user_metadata`. A test that
// merely omits the env vars would pass with the fallback intact and guard
// nothing.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { updateUserById } = vi.hoisted(() => ({ updateUserById: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async (_jwt: string) => ({
        data: { user: { id: "tenant-provision-1", user_metadata: {} } },
        error: null,
      })),
      admin: { updateUserById },
    },
  })),
}));

vi.mock("@/lib/logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), audit: vi.fn() },
  auditAction: vi.fn(),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

function ctx(...slug: string[]) {
  return { params: Promise.resolve({ slug }) };
}

describe("RFC-009 §3.1 / no shared-database fallback", () => {
  const savedUrl = process.env.TURSO_DATABASE_URL;
  const savedToken = process.env.TURSO_AUTH_TOKEN;
  const savedApiToken = process.env.TURSO_API_TOKEN;

  beforeEach(() => {
    updateUserById.mockClear();
    // The OLD trigger: shared credentials present, Turso API unreachable.
    process.env.TURSO_DATABASE_URL = "libsql://shared-everything.turso.io";
    process.env.TURSO_AUTH_TOKEN = "shared-token-value-that-is-long-enough";
    delete process.env.TURSO_API_TOKEN;
  });

  afterEach(() => {
    if (savedUrl === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = savedUrl;
    if (savedToken === undefined) delete process.env.TURSO_AUTH_TOKEN;
    else process.env.TURSO_AUTH_TOKEN = savedToken;
    if (savedApiToken === undefined) delete process.env.TURSO_API_TOKEN;
    else process.env.TURSO_API_TOKEN = savedApiToken;
  });

  it("returns 503 when Turso provisioning is unavailable, even with shared credentials configured", async () => {
    const req = new NextRequest("https://app.invalid/api/v1/provision", {
      method: "POST",
      headers: { Authorization: "Bearer valid-session-jwt" },
    });
    const res = await POST(req, ctx("provision"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
  });

  it("writes NO credentials to user_metadata on the 503 path", async () => {
    const req = new NextRequest("https://app.invalid/api/v1/provision", {
      method: "POST",
      headers: { Authorization: "Bearer valid-session-jwt" },
    });
    await POST(req, ctx("provision"));
    // The whole point: no `db_url`/`db_token` may reach the session, or the
    // tutor is merged onto the shared database with a "provisioned" record.
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("still refuses unauthenticated provision attempts before touching anything", async () => {
    const req = new NextRequest("https://app.invalid/api/v1/provision", { method: "POST" });
    const res = await POST(req, ctx("provision"));
    expect(res.status).toBe(401);
    expect(updateUserById).not.toHaveBeenCalled();
  });
});
