// GW-ISDEPLOYED-07 — the mock-token auth bypass must be shut on EVERY real
// deployment shape, not just the one that sets DENO_DEPLOYMENT_ID.
//
// The defect: lib/auth.ts gated the mock path on `DENO_DEPLOYMENT_ID` alone,
// while lib/errors.ts, lib/crypto.ts and index.ts all used the stricter
// `DENO_DEPLOYMENT_ID || DENO_ENV === "production"`. DENO_DEPLOYMENT_ID is set by
// the Supabase/Deno Deploy edge specifically, so a self-hosted production
// deployment — the shape an operator is most likely to stand up themselves —
// evaluated the auth gate false and served a path that authenticates by trusting a
// caller-chosen `x-tutor-id` header. Unauthenticated read of a real tenant's
// books, in production, by design.
//
// 10_Security.md §3 (AUTH-1), fail-closed. AGENTS.md §2 Rule 9.

import { describe, it, expect, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isDeployed, isLocalDev } from "../lib/env.ts";

// `__tests__/setup.ts` injects a `Deno.env.get` that delegates to `process.env`
// and has no `set`/`delete`, so the deployment signals are stubbed through
// process.env — which is exactly what the shim reads in CI too.
// Underscored: retained as the documented list of deployment signals this file
// stubs via process.env literals; deno no-unused-vars requires the prefix.
const _KEYS = ["DENO_DEPLOYMENT_ID", "DENO_ENV"] as const;
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

describe("the deployment predicate", () => {
  it("is true on the Deno Deploy edge (DENO_DEPLOYMENT_ID set)", () => {
    setEnv("DENO_DEPLOYMENT_ID", "abc123");
    setEnv("DENO_ENV", undefined);
    expect(isDeployed()).toBe(true);
    expect(isLocalDev()).toBe(false);
  });

  it("is true on a SELF-HOSTED production deployment (DENO_ENV=production, no deploy id)", () => {
    // THE REGRESSION. This shape previously returned false and opened the
    // mock-token bypass.
    setEnv("DENO_DEPLOYMENT_ID", undefined);
    setEnv("DENO_ENV", "production");
    expect(isDeployed()).toBe(true);
    expect(isLocalDev()).toBe(false);
  });

  it("is true when BOTH signals are present", () => {
    setEnv("DENO_DEPLOYMENT_ID", "abc123");
    setEnv("DENO_ENV", "production");
    expect(isDeployed()).toBe(true);
  });

  it("is false only in local development", () => {
    setEnv("DENO_DEPLOYMENT_ID", undefined);
    setEnv("DENO_ENV", undefined);
    expect(isDeployed()).toBe(false);
    expect(isLocalDev()).toBe(true);
  });

  it("does not treat DENO_ENV=development as deployed", () => {
    setEnv("DENO_DEPLOYMENT_ID", undefined);
    setEnv("DENO_ENV", "development");
    expect(isDeployed()).toBe(false);
  });

  it("does not treat a near-miss DENO_ENV value as deployed", () => {
    // Case sensitivity matters: an operator writing DENO_ENV=Production must not
    // be silently treated as local dev, or the bypass reopens.
    setEnv("DENO_DEPLOYMENT_ID", undefined);
    setEnv("DENO_ENV", "Production");
    expect(isDeployed()).toBe(false);
  });
});

describe("every gate reads the SAME predicate", () => {
  it("no gateway module re-derives deployment detection locally", async () => {
    // The four copies were the defect, not any single one of them. This asserts
    // the duplication is gone, so the next file cannot reintroduce a loose variant.
    const modules = [
      "../lib/auth.ts",
      "../lib/errors.ts",
      "../lib/crypto.ts",
      "../index.ts",
    ];
    for (const path of modules) {
      const source = await readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8");
      // Any direct environment probe for the deployment signals is a re-derivation.
      expect(
        source,
        `${path} must import isDeployed() from lib/env.ts, not read DENO_DEPLOYMENT_ID itself`,
      ).not.toMatch(/Deno\.env\.get\(\s*["']DENO_DEPLOYMENT_ID["']/);
      expect(
        source,
        `${path} must import isDeployed() from lib/env.ts, not read DENO_ENV itself`,
      ).not.toMatch(/Deno\.env\.get\(\s*["']DENO_ENV["']/);
    }
  });
});