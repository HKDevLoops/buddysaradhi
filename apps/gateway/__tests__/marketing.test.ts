import { describe, expect, it } from "vitest";
import { handleMarketingPublic } from "../routes/marketing.ts";

const CTX: Record<string, unknown> = {
  path: "/api/v1/marketing/stats",
  method: "GET",
  requestId: "test",
};

describe("handleMarketingPublic()", () => {
  it("returns null for other paths", () => {
    expect(handleMarketingPublic("/api/v1/students", "GET", CTX)).toBeNull();
  });

  it("rejects non-GET with 405", () => {
    const res = handleMarketingPublic("/api/v1/marketing/stats", "POST", CTX);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(405);
  });

  it("returns 200 verifiable facts with 1h public cache", async () => {
    const res = handleMarketingPublic("/api/v1/marketing/stats", "GET", CTX);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get("Cache-Control")).toContain("max-age=3600");
    const body = await res!.json();
    expect(body.success).toBe(true);
    expect(body.data.screens).toBe(5);
    expect(body.data.engines).toBe(7);
    expect(body.data.pricing.inrPaisePerMonth).toBe(0);
    expect(Array.isArray(body.data.guarantees)).toBe(true);
    // R-17: no unverifiable numbers may ever appear here.
    expect("rating" in body.data).toBe(false);
    expect("tutorCount" in body.data).toBe(false);
  });
});
