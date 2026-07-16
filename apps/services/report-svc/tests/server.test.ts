import { describe, it, expect } from "bun:test";
import { app } from "../src/index";

describe("report-svc /api/v1/reports/dashboard", () => {
  it("should require X-Tutor-Id auth header for KPIs", async () => {
    const res = await app.handle(new Request("http://localhost/api/v1/reports/dashboard/kpis?periodStartIso=2026-07-01T00:00:00.000Z"));
    expect(res.status).toBe(401);
  });

  it("should require X-Tutor-Id auth header for Feed", async () => {
    const res = await app.handle(new Request("http://localhost/api/v1/reports/dashboard/feed"));
    expect(res.status).toBe(401);
  });

  it("should require X-Tutor-Id auth header for Due Today", async () => {
    const res = await app.handle(new Request("http://localhost/api/v1/reports/dashboard/due-today"));
    expect(res.status).toBe(401);
  });

  it("should require X-Tutor-Id auth header for Heatmaps", async () => {
    const res = await app.handle(new Request("http://localhost/api/v1/reports/dashboard/heatmaps?periodStartIso=2026-07-01T00:00:00.000Z&periodEndIso=2026-07-31T23:59:59.000Z"));
    expect(res.status).toBe(401);
  });

  // Skip deep DB tests for now as we don't have mock data
  // But we can verify it reaches the logic and doesn't crash on simple validation
  it("should require periodStartIso for KPIs", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/reports/dashboard/kpis", {
        headers: { "X-Tutor-Id": "tutor-123" }
      })
    );
    expect(res.status).toBe(400);
  });

  it("should require periodStartIso and periodEndIso for Heatmaps", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/reports/dashboard/heatmaps?periodStartIso=2026-07-01T00:00:00.000Z", {
        headers: { "X-Tutor-Id": "tutor-123" }
      })
    );
    expect(res.status).toBe(400);
  });
});
