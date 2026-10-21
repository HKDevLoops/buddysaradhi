// Implements: 12_Business_Rules.md BR-SEC-04 + 10_Security.md §18.1 step 1 +
// 10_Security.md §8 (a documented control that does not exist is worse than an
// undocumented one) + AGENTS.md §2 Rule 9.
//
// FINDING 2.8 (docs/audit/REMEDIATION-PLAN-2026-10-21.md, Phase 2):
// "GATEWAY_ADMIN_TOKEN is documented as the erase route's second factor and is
// read by NO handler."
//
// THE RESOLUTION IS THE DOCUMENTATION, because the erase route ALREADY has a
// different and sufficient second factor: the tutor's PIN PROOF. The edge
// cannot evaluate argon2id (`settings.pin_hash`), but it CAN verify
// `settings.pin_proof` — an HMAC over the PIN under a server-side key — in
// constant time (routes/security.ts `constantTimeCompare`). That proof proves
// KNOWLEDGE OF THE PIN, which is exactly the factor BR-SEC-04 asks for.
//
// A server-held admin token would prove something else — "the caller is our
// own backend" — which (a) duplicates the session credential the route
// already requires, (b) cannot be held by a mobile/desktop client, and (c) is
// in no spec section. So the token stays a BOOT GATE (index.ts refuses to
// boot without a strong value) and the DOCUMENTATION now says what is true.
//
// This file is the guard on that truth: it fails if the documentation drifts
// back into claiming the token is a per-request factor, and it fails if a
// handler ever starts reading one.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const GATEWAY_ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function read(relativePath: string): string {
  return readFileSync(join(GATEWAY_ROOT, relativePath), "utf8");
}

describe("2.8 — GATEWAY_ADMIN_TOKEN is documented as what it actually is", () => {
  it("the .env.example no longer claims the token is a per-request erase factor", () => {
    const env = read(".env.example");
    expect(env).toContain("GATEWAY_ADMIN_TOKEN=");
    // The old claim: "Token required in the X-Admin-Token header for the
    // destructive POST /api/v1/security/erase endpoint".
    expect(env).not.toMatch(/X-Admin-Token/i);
    expect(env).not.toMatch(/admin token.*required.*erase/i);
  });

  it("the .env.example names the PIN proof as the erase route's second factor", () => {
    const env = read(".env.example");
    expect(env).toMatch(/PIN PROOF/i);
    expect(env).toMatch(/BR-SEC-04/);
    // And it says the token is a boot gate, not a request credential.
    expect(env).toMatch(/BOOT GATE/i);
    expect(env).toMatch(/NO REQUEST HANDLER READS IT/i);
  });

  it("NO route handler reads an admin-token header", () => {
    const routeDir = join(GATEWAY_ROOT, "routes");
    const sources = readdirSync(routeDir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => ({ name, source: readFileSync(join(routeDir, name), "utf8") }));
    expect(sources.length).toBeGreaterThan(0);
    for (const { name, source } of sources) {
      expect(source, `${name} must not read an admin token`).not.toMatch(
        /x-admin-token|adminToken|GATEWAY_ADMIN_TOKEN/i,
      );
    }
  });

  it("the erase route DOES verify the PIN proof in constant time", () => {
    // The documentation's claim is only true while the second factor exists.
    const security = read("routes/security.ts");
    expect(security).toContain("constantTimeCompare");
    expect(security).toContain("pin_proof");
  });
});
