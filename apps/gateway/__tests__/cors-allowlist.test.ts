// Implements: 10_Security.md §8 (no origin is trusted implicitly) + AGENTS.md
// §2 Rule 10 (every boundary is auditable) and the 2026-10-04 CORS finding.
//
// THIS FILE REPLACES the previous `errors.test.ts`, which defined its OWN local
// `json`/`ok`/`fail` and then asserted `Access-Control-Allow-Origin: *` against
// them. It never imported `lib/errors.ts`, so it proved nothing about the
// shipped module and — worse — recorded a wildcard as if it were the contract.
// A test that cannot fail is worse than no test, because it is a green light
// where the reading light should be red.
//
// Everything here imports the REAL module.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  corsHeadersForOrigin,
  allowedCorsOrigins,
  resetCorsOriginCache,
} from "../lib/errors.ts";

const PROD_ORIGIN = "https://buddysaradhi.app";
const VERCEL_ORIGIN = "https://buddysaradhi.vercel.app";
const EVIL = "https://buddysaradhi.app.evil.com";

let savedEnv: Record<string, string | undefined>;

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  resetCorsOriginCache();
}

beforeEach(() => {
  savedEnv = {
    DENO_DEPLOYMENT_ID: process.env.DENO_DEPLOYMENT_ID,
    DENO_ENV: process.env.DENO_ENV,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN,
  };
  setEnv("DENO_DEPLOYMENT_ID", undefined);
  setEnv("DENO_ENV", undefined);
  setEnv("ALLOWED_ORIGINS", undefined);
  setEnv("ALLOWED_ORIGIN", undefined);
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) setEnv(k, v);
  resetCorsOriginCache();
});

function deployed(): void {
  setEnv("DENO_DEPLOYMENT_ID", "dep-abc123");
}

describe("CORS — an allowlisted origin is echoed exactly", () => {
  it("echoes a production origin and permits credentials", () => {
    const h = corsHeadersForOrigin(PROD_ORIGIN);
    expect(h["Access-Control-Allow-Origin"]).toBe(PROD_ORIGIN);
    expect(h["Access-Control-Allow-Credentials"]).toBe("true");
  });

  it("echoes the Vercel production host too", () => {
    expect(corsHeadersForOrigin(VERCEL_ORIGIN)["Access-Control-Allow-Origin"])
      .toBe(VERCEL_ORIGIN);
  });

  it("always carries Vary: Origin (a shared cache must not cross-serve origins)", () => {
    expect(corsHeadersForOrigin(PROD_ORIGIN).Vary).toBe("Origin");
    expect(corsHeadersForOrigin("https://nope.example").Vary).toBe("Origin");
    expect(corsHeadersForOrigin(null).Vary).toBe("Origin");
  });

  it("always carries the request-independent headers (RFC-004 C1 idempotency-key)", () => {
    const h = corsHeadersForOrigin(PROD_ORIGIN);
    expect(h["Access-Control-Allow-Headers"]).toContain("idempotency-key");
    expect(h["Access-Control-Allow-Headers"]).toContain("authorization");
    expect(h["Access-Control-Allow-Methods"]).toContain("DELETE");
    expect(h["Access-Control-Max-Age"]).toBe("86400");
  });
});

describe("CORS — fail closed", () => {
  it("emits NO Access-Control-Allow-Origin for an unknown origin", () => {
    const h = corsHeadersForOrigin("https://attacker.example");
    expect(h["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("emits NO Access-Control-Allow-Credentials without an origin (the invalid pairing)", () => {
    const h = corsHeadersForOrigin("https://attacker.example");
    expect(h["Access-Control-Allow-Credentials"]).toBeUndefined();
  });

  it("never emits a wildcard — not for an allowlisted, unknown, or absent origin", () => {
    for (const origin of [PROD_ORIGIN, "https://attacker.example", null, "", "*", "null"]) {
      expect(corsHeadersForOrigin(origin)["Access-Control-Allow-Origin"]).not.toBe("*");
    }
  });

  it("an absent Origin (server-to-server, curl, the mobile SDK) gets no origin header", () => {
    // The web app calls the gateway server-side with no Origin at all. Failing
    // closed here is what keeps that path working: a server-to-server caller
    // needs no CORS header, and the web's browser surface is same-origin.
    const h = corsHeadersForOrigin(null);
    expect(h["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(h["Access-Control-Allow-Credentials"]).toBeUndefined();
    expect(h["Access-Control-Allow-Methods"]).toContain("POST");
  });

  it("the literal string 'null' (sandboxed iframe, file://) is NOT allowlisted", () => {
    expect(corsHeadersForOrigin("null")["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("does not fall back to a hardcoded origin for an unknown caller", () => {
    // The old resolver returned "https://buddysaradhi.app" for ANY unknown
    // origin — asserting an allowlist membership that was never checked.
    expect(corsHeadersForOrigin("https://attacker.example")["Access-Control-Allow-Origin"])
      .not.toBe(PROD_ORIGIN);
  });
});

describe("CORS — the substring bypass is closed", () => {
  it("does not grant buddysaradhi.app.evil.com via the production allowlist", () => {
    // `ALLOWED_ORIGIN.includes(origin)` matched this, because
    // "https://buddysaradhi.app.evil.com" CONTAINS "https://buddysaradhi.app".
    expect(corsHeadersForOrigin(EVIL)["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("does not grant it via an env override either", () => {
    setEnv("ALLOWED_ORIGINS", "https://buddysaradhi.app");
    expect(corsHeadersForOrigin(EVIL)["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("does not grant a subdomain-suffixed or path-appended variant", () => {
    for (const candidate of [
      "https://buddysaradhi.app.evil.com",
      "https://notbuddysaradhi.app",
      "https://buddysaradhi.app/",
      "http://buddysaradhi.app", // http, not https
      "https://buddysaradhi.app:8443",
    ]) {
      expect(corsHeadersForOrigin(candidate)["Access-Control-Allow-Origin"], candidate)
        .toBeUndefined();
    }
  });

  it("the only match is an exact origin", () => {
    expect(corsHeadersForOrigin(PROD_ORIGIN)["Access-Control-Allow-Origin"]).toBe(PROD_ORIGIN);
  });
});

describe("CORS — env overrides are split and matched, never substring-matched", () => {
  it("splits a comma-separated ALLOWED_ORIGINS and honours every entry", () => {
    setEnv("ALLOWED_ORIGINS", "https://one.example, https://two.example ,https://three.example");
    for (const o of ["https://one.example", "https://two.example", "https://three.example"]) {
      expect(corsHeadersForOrigin(o)["Access-Control-Allow-Origin"], o).toBe(o);
    }
  });

  it("trims whitespace and ignores empty entries", () => {
    setEnv("ALLOWED_ORIGINS", "  https://spaced.example  ,, ");
    expect(corsHeadersForOrigin("https://spaced.example")["Access-Control-Allow-Origin"])
      .toBe("https://spaced.example");
    expect(corsHeadersForOrigin("")["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("accepts the singular ALLOWED_ORIGIN spelling", () => {
    setEnv("ALLOWED_ORIGIN", "https://legacy.example");
    expect(corsHeadersForOrigin("https://legacy.example")["Access-Control-Allow-Origin"])
      .toBe("https://legacy.example");
  });

  it("an env override does not displace the built-in production origins", () => {
    setEnv("ALLOWED_ORIGINS", "https://extra.example");
    expect(corsHeadersForOrigin(PROD_ORIGIN)["Access-Control-Allow-Origin"]).toBe(PROD_ORIGIN);
  });
});

describe("CORS — loopback is development-only", () => {
  it("permits localhost:3000/3001 in development (the web's dev ports)", () => {
    for (const o of ["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000"]) {
      expect(corsHeadersForOrigin(o)["Access-Control-Allow-Origin"], o).toBe(o);
    }
  });

  it("permits tauri://localhost in development (the Tauri webview origin)", () => {
    expect(corsHeadersForOrigin("tauri://localhost")["Access-Control-Allow-Origin"])
      .toBe("tauri://localhost");
  });

  it("REFUSES loopback once deployed — a production gateway is not driveable from a laptop", () => {
    deployed();
    for (const o of ["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000", "tauri://localhost"]) {
      expect(corsHeadersForOrigin(o)["Access-Control-Allow-Origin"], o).toBeUndefined();
    }
  });

  it("still permits the real product origins once deployed", () => {
    deployed();
    expect(corsHeadersForOrigin(PROD_ORIGIN)["Access-Control-Allow-Origin"]).toBe(PROD_ORIGIN);
    expect(corsHeadersForOrigin(VERCEL_ORIGIN)["Access-Control-Allow-Origin"]).toBe(VERCEL_ORIGIN);
  });

  it("DENO_ENV=production is honoured as a deployment signal too", () => {
    setEnv("DENO_ENV", "production");
    expect(corsHeadersForOrigin("http://localhost:3000")["Access-Control-Allow-Origin"])
      .toBeUndefined();
  });

  it("an explicit ALLOWED_ORIGINS can still admit a local origin on purpose", () => {
    deployed();
    setEnv("ALLOWED_ORIGINS", "http://localhost:3000");
    expect(corsHeadersForOrigin("http://localhost:3000")["Access-Control-Allow-Origin"])
      .toBe("http://localhost:3000");
  });
});

describe("CORS — the allowlist is one set, and it has no wildcard member", () => {
  it("contains only absolute origins", () => {
    for (const origin of allowedCorsOrigins()) {
      expect(origin, origin).not.toBe("*");
      expect(origin, origin).not.toBe("null");
      expect(origin.startsWith("https://") || origin.startsWith("http://") || origin.startsWith("tauri://"), origin)
        .toBe(true);
    }
  });

  it("is memoised per configuration but recomputed after the cache is reset", () => {
    const before = allowedCorsOrigins();
    expect(allowedCorsOrigins()).toBe(before);
    deployed();
    expect(allowedCorsOrigins()).not.toBe(before);
  });
});
