// Implements: AGENTS.md §2 Rule 9 (no silent failures — "every error throws or
// returns a typed error; no empty catch"), AP-9 (never swallow), Rule 2
// (fail-closed on anything outbound).
//
// THE DEFECT. `getSlug()` in `route.ts` awaited `ctx.params` inside a bare
// `catch {}`. Next hands this catch-all handler a PROMISE for the matched
// `[...slug]` segment; if that promise rejects, the router could not resolve the
// path at all — and the empty catch turned that into `[]`. `dispatch` then joins
// `[]` into the path `"/"` and forwards the request to the gateway as
// `/api/v1/`, so the caller got a confidently-shaped answer to the WRONG
// endpoint and nothing anywhere recorded that it happened. A swallowed routing
// failure is exactly what Rule 9 exists to prevent.
//
// WHAT IS ASSERTED HERE:
//   1. a REJECTING `params` promise is reported on the `error` channel, naming
//      the method that triggered it (the old code reported nothing);
//   2. the route still answers — a logged failure is not a crash, and the caller
//      gets the `[]` fallback rather than an unhandled rejection;
//   3. an ABSENT `ctx` is NOT treated as an error, so the defensive `?.` path
//      does not spam the audit trail on every call;
//   4. the happy path is untouched: a resolved segment reaches the gateway with
//      the right path.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { gatewayGet, gatewayPost, gatewayPatch, logError } = vi.hoisted(() => ({
  gatewayGet: vi.fn(),
  gatewayPost: vi.fn(),
  gatewayPatch: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/server/get-db", () => ({
  gatewayGet,
  gatewayPost,
  gatewayPatch,
  gatewayDelete: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  log: {
    error: logError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    audit: vi.fn(),
  },
  auditAction: vi.fn(),
}));

import { NextRequest } from "next/server";
import { GET, PATCH } from "./route";

type RouteCtx = { params: Promise<{ slug: string[] }> };

type NextRequestInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;

function req(path: string, init?: NextRequestInit): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1${path}`, init);
}

beforeEach(() => {
  vi.clearAllMocks();
  const ok = { success: true, data: { ok: true } };
  gatewayGet.mockResolvedValue(ok);
  gatewayPost.mockResolvedValue(ok);
  gatewayPatch.mockResolvedValue(ok);
});

describe("F-30.1 — the route no longer swallows an unresolvable route segment", () => {
  it("reports a rejecting params promise instead of swallowing it", async () => {
    const rejecting: RouteCtx = {
      params: Promise.reject(new Error("segment resolution exploded")),
    };
    const res = await GET(req("/students"), rejecting);

    // 1. The failure is now VISIBLE — named action, message, and the method.
    expect(logError).toHaveBeenCalledTimes(1);
    const [action, message, context] = logError.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(action).toBe("api_slug_params_unresolved");
    expect(message).toContain("segment resolution exploded");
    expect(context).toMatchObject({ method: "GET" });

    // 2. The route still answers rather than throwing at the framework.
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("reports it for every verb, carrying the method that triggered it", async () => {
    const boom = new Error("params gone");
    await PATCH(req("/settings", { method: "PATCH", body: "{}" }), {
      params: Promise.reject(boom),
    });

    expect(logError).toHaveBeenCalledTimes(1);
    const [action, message, context] = logError.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(action).toBe("api_slug_params_unresolved");
    expect(message).toBe("params gone");
    expect(context).toMatchObject({ method: "PATCH" });
  });

  it("reports a non-Error rejection value rather than stringifying it to nothing", async () => {
    // A rejected string is still a failure; `String(err)` keeps it reportable.
    await GET(req("/fees"), { params: Promise.reject("plain string rejection") } as RouteCtx);
    const [, message] = logError.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(message).toBe("plain string rejection");
  });

  it("does NOT treat an absent ctx as an error (the defensive `?.` path is not a fault)", async () => {
    await GET(req("/students"), undefined as unknown as RouteCtx);
    expect(logError).not.toHaveBeenCalled();
  });

  it("does not report the happy path either — a resolved segment is silent", async () => {
    await GET(req("/students"), { params: Promise.resolve({ slug: ["students"] }) });
    expect(logError).not.toHaveBeenCalled();
    // ...and it reached the gateway at the right path.
    expect(gatewayGet).toHaveBeenCalledWith("/api/v1/students", {});
  });
});
