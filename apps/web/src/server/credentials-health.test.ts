// Implements: web/03_Auth_and_Provisioning.md §8 (failures & recovery);
// RFC-003 §0 (incident grounding) + §1 G-ERR.
//
// Health-classification tests: the stored-credential gate that replaces the
// silent env-var fall-through. `getDbCredentials` keeps its local-dev
// fallback by default; with `{ allowEnvFallback: false }` (what
// `server/get-db.ts` passes for production sessions) missing/dummy metadata
// throws typed DB_NOT_PROVISIONED even when env vars exist.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDbCredentials } from "@/lib/db";
import { parseAuthErrorCode } from "./auth-errors";

const REAL_URL = "libsql://buddysaradhi-abc123.aws-ap-south-1.turso.io";
const REAL_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.real-token";

let originalDbUrl: string | undefined;
let originalAuthToken: string | undefined;

beforeEach(() => {
  originalDbUrl = process.env.TURSO_DATABASE_URL;
  originalAuthToken = process.env.TURSO_AUTH_TOKEN;
});

afterEach(() => {
  if (originalDbUrl !== undefined) process.env.TURSO_DATABASE_URL = originalDbUrl;
  else delete process.env.TURSO_DATABASE_URL;
  if (originalAuthToken !== undefined) process.env.TURSO_AUTH_TOKEN = originalAuthToken;
  else delete process.env.TURSO_AUTH_TOKEN;
});

describe("credential health classification", () => {
  it("real metadata credentials win regardless of the gate", () => {
    process.env.TURSO_DATABASE_URL = "libsql://shared-dev.turso.io";
    process.env.TURSO_AUTH_TOKEN = "shared-token";
    const gated = getDbCredentials({ db_url: REAL_URL, db_token: REAL_TOKEN }, { allowEnvFallback: false });
    expect(gated.dbUrl).toBe(REAL_URL);
  });

  it("production-session gate: missing metadata throws typed DB_NOT_PROVISIONED despite env vars", () => {
    process.env.TURSO_DATABASE_URL = "libsql://shared-dev.turso.io";
    process.env.TURSO_AUTH_TOKEN = "shared-token";
    let code: string | null = null;
    try {
      getDbCredentials({ db_url: null, db_token: null }, { allowEnvFallback: false });
    } catch (err) {
      code = parseAuthErrorCode(err);
    }
    expect(code).toBe("DB_NOT_PROVISIONED");
  });

  it("production-session gate: dummy sentinel throws typed DB_NOT_PROVISIONED despite env vars", () => {
    process.env.TURSO_DATABASE_URL = "libsql://shared-dev.turso.io";
    process.env.TURSO_AUTH_TOKEN = "shared-token";
    let code: string | null = null;
    try {
      getDbCredentials({ db_url: "libsql://dummy-local-dev-url", db_token: "tok" }, { allowEnvFallback: false });
    } catch (err) {
      code = parseAuthErrorCode(err);
    }
    expect(code).toBe("DB_NOT_PROVISIONED");
  });

  it("local-dev default: env fallback still applies when metadata is missing", () => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.TURSO_DATABASE_URL = "libsql://shared-dev.turso.io";
    process.env.TURSO_AUTH_TOKEN = "shared-token";
    // Default (no opts) preserves local-dev ergonomics outside production.
    if (process.env.NODE_ENV !== "production") {
      const result = getDbCredentials({ db_url: null, db_token: null });
      expect(result.dbUrl).toBe("libsql://shared-dev.turso.io");
    }
  });

  it("no credentials anywhere throws typed DB_NOT_PROVISIONED", () => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    let code: string | null = null;
    try {
      getDbCredentials(undefined);
    } catch (err) {
      code = parseAuthErrorCode(err);
    }
    expect(code).toBe("DB_NOT_PROVISIONED");
  });
});
