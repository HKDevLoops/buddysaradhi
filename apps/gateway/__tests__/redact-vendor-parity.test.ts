// Implements: 10_Security.md §8 (one set of redaction rules for every sink) +
// 17_API_Gateway_System.md §5 (the edge bundler only ships `supabase/functions/
// <fn>/`, so shared code is vendored into `lib/vendor/`) + AGENTS.md §3.5 (one
// implementation of a rule, never a second copy that drifts).
//
// The gateway CANNOT import `packages/shared/src/redact.ts` at runtime — the
// deploy stages `apps/gateway/*` into the function directory and a
// `../../../packages` import 400s the bundle. So the copy in
// `apps/gateway/lib/vendor/redact.ts` is byte-identical by construction, and this
// suite is what keeps it that way: a rule added to the source and forgotten here
// would leave the gateway quietly leaking whatever the web logger now protects.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { redact as sourceRedact, sanitizeLogData as sourceSanitize } from "../../../packages/shared/src/redact.ts";
import { redact as vendorRedact, sanitizeLogData as vendorSanitize } from "../lib/vendor/redact.ts";
import { redact as gatewayRedact, sanitizeLogData as gatewaySanitize } from "../lib/log.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(HERE, "../../../packages/shared/src/redact.ts");
const VENDOR = path.resolve(HERE, "../lib/vendor/redact.ts");

/** The file body minus its leading comment block, line-ending normalised. */
function bodyOf(file: string): string {
  const lines = readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n");
  let start = 0;
  while (start < lines.length && (lines[start] ?? "").trimStart().startsWith("//")) start += 1;
  return lines.slice(start).join("\n").trimEnd();
}

const VISA_16 = "4111111111111111";
const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig";

/** A corpus that must produce byte-identical output in every implementation. */
const CORPUS: readonly string[] = [
  VISA_16,
  `authorization: Bearer ${JWT}`,
  "password: hunter2",
  "secret=abc123",
  "api_key: sk-live-9f8a",
  "tutor kabir@example.com logged in",
  "ssn 123-45-6789 on file",
  "parent 9876543210 called",
  "db libsql://tenant-abc.turso.io",
  "1234567890123456",
  "2026-01-04",
  "status=500 durationMs=12",
  "018f0000-0000-7000-8000-000000000001",
];

describe("the edge vendored redactor cannot drift from the shared source", () => {
  it("is byte-identical to packages/shared/src/redact.ts", () => {
    expect(bodyOf(VENDOR)).toBe(bodyOf(SOURCE));
  });

  it("produces identical output for every corpus entry", () => {
    for (const input of CORPUS) {
      expect(vendorRedact(input)).toBe(sourceRedact(input));
    }
  });

  it("produces identical structured output for a log entry", () => {
    const entry = {
      message: `card ${VISA_16} declined`,
      tenantId: "018f0000-0000-7000-8000-000000000001",
      queryCount: 4,
      cacheHit: true,
      payload: { nested: true },
      blob: "y".repeat(900),
    };
    expect(vendorSanitize(entry)).toEqual(sourceSanitize(entry));
  });

  it("lib/log.ts re-exports the vendored implementation, not a private copy", () => {
    for (const input of CORPUS) {
      expect(gatewayRedact(input)).toBe(sourceRedact(input));
    }
    expect(gatewaySanitize({ message: "x".repeat(900) })).toEqual(
      sourceSanitize({ message: "x".repeat(900) }),
    );
  });
});