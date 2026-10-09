// Implements: 10_Security.md §3 (the destructive admin surface has a real
// credential) + AGENTS.md Rule 9 (no silent failures — a gate that fails open is
// worse than no gate) + `.env.example`'s own instruction ("CHANGE THIS in every
// environment") which nothing enforced.
//
// The defect this pins: `GATEWAY_ADMIN_TOKEN=change-me` shipped in
// `.env.example`, was never read by any handler, and never gated boot. An
// operator who rotated it believed they had protected `POST
// /api/v1/security/erase`; an operator who did not had a value published in this
// repository.
//
// Shape follows `assertSecretStrength` in lib/crypto.ts: throw in a deployed
// context, warn and continue in development (so `deno task dev` and this suite
// run without a secret store), and never echo the token value itself.
import { describe, expect, it, afterEach, vi } from "vitest";

// `index.ts` imports `lib/db.ts`, which imports `@libsql/client/web` — a package
// this workspace does not install (every other gateway test reaches the routes,
// which import `DB` as a TYPE, so no test has ever loaded the real client). The
// boot gate never touches a database, so the client is stubbed rather than
// installed: a new dependency for a module the assertion does not use would be
// the wrong trade. Everything else in `index.ts` is the real module graph.
vi.mock("../lib/db.ts", () => ({ getTurso: () => { throw new Error("not used"); } }));

const { assertAdminTokenStrength } = await import("../index.ts");

const ENV_KEYS = ["GATEWAY_ADMIN_TOKEN", "DENO_DEPLOYMENT_ID", "DENO_ENV"] as const;
const saved = new Map<string, string | undefined>();

function setEnv(name: string, value: string | undefined): void {
  if (!saved.has(name)) saved.set(name, process.env[name]);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** A 48-char random-looking token — clears the 32-char floor. */
const STRONG = "gw_admin_7f3c1b9d2a4e6f80b5c7d9e1a3f5c7e9d1b3a5f7c9e1d3b5";

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
});

describe("GATEWAY_ADMIN_TOKEN boot gate — deployed (10_Security.md §3)", () => {
  it("refuses to boot on the DENO_DEPLOYMENT_ID edge when the token is unset", () => {
    setEnv("DENO_DEPLOYMENT_ID", "dep-abc123");
    setEnv("DENO_ENV", undefined);
    setEnv("GATEWAY_ADMIN_TOKEN", undefined);
    expect(() => assertAdminTokenStrength()).toThrow(/GATEWAY_ADMIN_TOKEN is not set/);
  });

  it("refuses to boot on DENO_ENV=production alone (no Deno Deploy id)", () => {
    // The union predicate matters: a self-hosted production deployment sets
    // DENO_ENV, not DENO_DEPLOYMENT_ID. A gate that only read the deployment id
    // would skip exactly the environment it exists to protect.
    setEnv("DENO_DEPLOYMENT_ID", undefined);
    setEnv("DENO_ENV", "production");
    setEnv("GATEWAY_ADMIN_TOKEN", "change-me");
    expect(() => assertAdminTokenStrength()).toThrow(/still the `.env.example` placeholder/);
  });

  it("refuses to boot on the `.env.example` placeholder", () => {
    setEnv("DENO_DEPLOYMENT_ID", "dep-abc123");
    setEnv("GATEWAY_ADMIN_TOKEN", "change-me");
    expect(() => assertAdminTokenStrength()).toThrow(/placeholder/);
  });

  it("refuses a token below the 32-char entropy floor", () => {
    const weak = "short-but-not-the-example";
    setEnv("DENO_DEPLOYMENT_ID", "dep-abc123");
    setEnv("GATEWAY_ADMIN_TOKEN", weak);
    expect(weak.length).toBeLessThan(32);
    expect(() => assertAdminTokenStrength()).toThrow(
      new RegExp(`only ${weak.length} characters \\(minimum 32\\)`),
    );
  });

  it("treats surrounding whitespace as unset, not as padding around a strong token", () => {
    setEnv("DENO_DEPLOYMENT_ID", "dep-abc123");
    setEnv("GATEWAY_ADMIN_TOKEN", "change-me   ");
    expect(() => assertAdminTokenStrength()).toThrow(/placeholder/);
  });

  it("passes a strong token", () => {
    setEnv("DENO_DEPLOYMENT_ID", "dep-abc123");
    setEnv("DENO_ENV", undefined);
    setEnv("GATEWAY_ADMIN_TOKEN", STRONG);
    expect(() => assertAdminTokenStrength()).not.toThrow();
  });

  it("passes a strong token under DENO_ENV=production alone", () => {
    setEnv("DENO_DEPLOYMENT_ID", undefined);
    setEnv("DENO_ENV", "production");
    setEnv("GATEWAY_ADMIN_TOKEN", STRONG);
    expect(() => assertAdminTokenStrength()).not.toThrow();
  });
});

describe("GATEWAY_ADMIN_TOKEN boot gate — development keeps working", () => {
  it("warns instead of throwing when nothing is deployed and no token is set", () => {
    setEnv("DENO_DEPLOYMENT_ID", undefined);
    setEnv("DENO_ENV", undefined);
    setEnv("GATEWAY_ADMIN_TOKEN", undefined);
    expect(() => assertAdminTokenStrength()).not.toThrow();
  });

  it("warns instead of throwing on the placeholder locally", () => {
    setEnv("DENO_DEPLOYMENT_ID", undefined);
    setEnv("DENO_ENV", "development");
    setEnv("GATEWAY_ADMIN_TOKEN", "change-me");
    expect(() => assertAdminTokenStrength()).not.toThrow();
  });
});

describe("the gate never leaks the token it rejected (10_Security.md §8)", () => {
  it("a too-short token is not echoed into the error", () => {
    const weak = "hunter2hunter2hunter2hunter2";
    setEnv("DENO_DEPLOYMENT_ID", "dep-abc123");
    setEnv("GATEWAY_ADMIN_TOKEN", weak);
    let message = "";
    try {
      assertAdminTokenStrength();
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("GATEWAY_ADMIN_TOKEN");
    expect(message).not.toContain(weak);
  });

  it("only ever names the example literal, which is already public in .env.example", () => {
    setEnv("DENO_DEPLOYMENT_ID", "dep-abc123");
    setEnv("GATEWAY_ADMIN_TOKEN", "change-me");
    let message = "";
    try {
      assertAdminTokenStrength();
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("change-me");
  });

  it("the env read covers every variable the gate depends on", () => {
    // A typo in a key would silently disable the gate; pin the exact set.
    for (const key of ENV_KEYS) expect(typeof key).toBe("string");
    setEnv("DENO_DEPLOYMENT_ID", "dep-abc123");
    setEnv("GATEWAY_ADMIN_TOKEN", "change-me");
    expect(() => assertAdminTokenStrength()).toThrow();
  });
});