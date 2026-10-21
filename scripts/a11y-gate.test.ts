// Implements: AGENTS.md §2 Rule 10 + 21_Automation_Testing.md §6 — the
// credential-free accessibility gate's own regression test.
//
// The point of these tests is the failure modes, not the happy path: audit
// AUD-024's finding was that the a11y gate SKIPPED, so the negative controls
// below prove that a gate which cannot reach the page, cannot read the page,
// or finds a critical violation FAILS — it never degrades into a pass.
import { describe, expect, it } from "vitest";
import {
  ROUTES,
  classifyViolations,
  decideExitCode,
  resolveAxeSource,
  type AxeViolation,
  type RouteResult,
} from "./a11y-gate";

function violation(id: string, impact: string | null): AxeViolation {
  return { id, impact, help: `${id} help`, nodes: [{ target: ["html"] }] };
}

describe("ROUTES — the routes the credential-free gate scans", () => {
  it("covers the four auth routes, each with a render-proof selector", () => {
    expect(ROUTES.map((r) => r.path)).toEqual([
      "/login",
      "/signup",
      "/forgot-password",
      "/reset-password",
    ]);
    for (const route of ROUTES) {
      expect(route.ready, `${route.path} has no render-proof selector`).toMatch(/^#/);
    }
  });
});

describe("classifyViolations — the §6 gate policy", () => {
  it("splits critical, serious and the rest", () => {
    const { critical, serious, other } = classifyViolations([
      violation("color-contrast", "critical"),
      violation("label", "serious"),
      violation("region", "moderate"),
      violation("unknown", null),
    ]);
    expect(critical.map((v) => v.id)).toEqual(["color-contrast"]);
    expect(serious.map((v) => v.id)).toEqual(["label"]);
    expect(other.map((v) => v.id)).toEqual(["region", "unknown"]);
  });
});

describe("decideExitCode — the gate", () => {
  it("PASSES a clean scan", () => {
    const results: RouteResult[] = [{ path: "/login", rendered: true, violations: [] }];
    expect(decideExitCode(results).code).toBe(0);
  });

  it("FAILS a route that could not be loaded — the negative control", () => {
    const results: RouteResult[] = [
      { path: "/login", rendered: false, violations: [], error: "net::ERR_CONNECTION_REFUSED" },
    ];
    const decision = decideExitCode(results);
    expect(decision.code).toBe(1);
    expect(decision.failures[0]).toContain("could not be loaded");
  });

  it("FAILS a route that did not render — the negative control", () => {
    const results: RouteResult[] = [{ path: "/login", rendered: false, violations: [] }];
    const decision = decideExitCode(results);
    expect(decision.code).toBe(1);
    expect(decision.failures[0]).toContain("did not render");
  });

  it("FAILS on a critical violation — the negative control", () => {
    const results: RouteResult[] = [
      { path: "/login", rendered: true, violations: [violation("color-contrast", "critical")] },
    ];
    const decision = decideExitCode(results);
    expect(decision.code).toBe(1);
    expect(decision.failures[0]).toContain("color-contrast");
  });

  it("WARNS but does not fail on a serious violation (21_ §6 policy)", () => {
    const results: RouteResult[] = [
      { path: "/login", rendered: true, violations: [violation("label", "serious")] },
    ];
    const decision = decideExitCode(results);
    expect(decision.code).toBe(0);
    expect(decision.warnings[0]).toContain("serious");
  });
});

describe("resolveAxeSource — axe-core is installed, not assumed", () => {
  it("resolves the axe-core bundle from this repository's dependencies", () => {
    const source = resolveAxeSource();
    expect(source.length).toBeGreaterThan(1000);
    expect(source).toContain("axe");
  });
});
