// GW-DEVAUTH-09 — the caller-trusting dev-auth path must be CLOSED by default.
//
// The defect class: `Bearer mock-token-<tenant>` authenticates by trusting the
// caller's `X-Tutor-Id` header. It was gated by `if (!isDeployed())` — open
// unless the environment LOOKED like production — which fails OPEN whenever
// DENO_ENV and DENO_DEPLOYMENT_ID are both absent, i.e. on a self-hosted
// deployment. The web app independently minted these tokens behind its own
// `NODE_ENV === "production"` check, so the same mistake in a third variable on
// the other side of the wire reopened it.
//
// These tests pin the DIRECTION: forgetting the flag must fail safe.

import { describe, it, expect, afterEach, vi } from "vitest";
import { isDevAuthEnabled } from "../lib/env.ts";

const KEYS = [
  "ALLOW_DEV_AUTH",
  "DENO_DEPLOYMENT_ID",
  "DENO_ENV",
  // authenticateRequest refuses before it reaches the dev-token branch unless
  // these are present, so the handler tests must supply a syntactically valid
  // pair. They are never used — no network call is made on the dev-token path.
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;
const saved = new Map<string, string | undefined>();

function setEnv(name: string, value: string | undefined): void {
  if (!saved.has(name)) saved.set(name, process.env[name]);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
});

describe("dev auth is opt-in", () => {
  it("is CLOSED when nothing is configured at all", () => {
    // THE REGRESSION. This configuration is a real self-hosted production
    // deployment with unset env vars. It used to serve dev auth.
    setEnv("ALLOW_DEV_AUTH", undefined);
    setEnv("DENO_DEPLOYMENT_ID", undefined);
    setEnv("DENO_ENV", undefined);
    expect(isDevAuthEnabled()).toBe(false);
  });

  it("is CLOSED when ALLOW_DEV_AUTH is absent but the environment looks local", () => {
    setEnv("ALLOW_DEV_AUTH", undefined);
    setEnv("DENO_DEPLOYMENT_ID", undefined);
    setEnv("DENO_ENV", undefined);
    expect(isDevAuthEnabled()).toBe(false);
  });

  it("is CLOSED for any value other than exactly 'true'", () => {
    // A permissive parse (`=== "1"`, `Boolean(x)`, `!= "false"`) is how these
    // gates rot. Only the literal opens it.
    for (const value of ["1", "TRUE", "yes", "on", "false", "", " true"]) {
      setEnv("ALLOW_DEV_AUTH", value);
      setEnv("DENO_DEPLOYMENT_ID", undefined);
      setEnv("DENO_ENV", undefined);
      expect(isDevAuthEnabled(), `ALLOW_DEV_AUTH=${JSON.stringify(value)} opened dev auth`).toBe(false);
    }
  });

  it("is CLOSED even when explicitly enabled on a deployed environment", () => {
    // Belt and braces: a stray flag must not open the caller-trusting path on a
    // real deployment.
    setEnv("ALLOW_DEV_AUTH", "true");
    setEnv("DENO_DEPLOYMENT_ID", "dep-abc123");
    setEnv("DENO_ENV", undefined);
    expect(isDevAuthEnabled()).toBe(false);
  });

  it("is CLOSED when explicitly enabled with DENO_ENV=production but no deploy id", () => {
    setEnv("ALLOW_DEV_AUTH", "true");
    setEnv("DENO_DEPLOYMENT_ID", undefined);
    setEnv("DENO_ENV", "production");
    expect(isDevAuthEnabled()).toBe(false);
  });

  it("is OPEN only when explicitly enabled on a genuinely local environment", () => {
    setEnv("ALLOW_DEV_AUTH", "true");
    setEnv("DENO_DEPLOYMENT_ID", undefined);
    setEnv("DENO_ENV", undefined);
    expect(isDevAuthEnabled()).toBe(true);
  });
});

describe("the gateway refuses a dev token unless dev auth is on", () => {
  it("rejects mock-token-* on an unconfigured environment", async () => {
    setEnv("ALLOW_DEV_AUTH", undefined);
    setEnv("DENO_DEPLOYMENT_ID", undefined);
    setEnv("DENO_ENV", undefined);

    setEnv("SUPABASE_URL", "https://example.supabase.co");
    setEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
    const { authenticateRequest } = await import("../lib/auth.ts");
    const req = new Request("https://gateway.test/api/v1/students", {
      headers: { Authorization: "Bearer mock-token-attacker-chosen-tenant" },
    });
    await expect(authenticateRequest(req)).rejects.toThrow(/not permitted/i);
  });

  it("rejects mock-token-* even when the flag is set on a deployed environment", async () => {
    setEnv("ALLOW_DEV_AUTH", "true");
    setEnv("DENO_DEPLOYMENT_ID", "dep-abc123");

    setEnv("SUPABASE_URL", "https://example.supabase.co");
    setEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
    const { authenticateRequest } = await import("../lib/auth.ts");
    const req = new Request("https://gateway.test/api/v1/students", {
      headers: { Authorization: "Bearer mock-token-attacker-chosen-tenant" },
    });
    await expect(authenticateRequest(req)).rejects.toThrow(/not permitted/i);
  });
});
