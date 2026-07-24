// packages/security/src/audit-chain.test.ts
// Verifies §8.3 audit-chain SHA-256 implementation. Compile-only scaffold —
// runtime wiring deferred to RFC sub-RFC #9.

import { describe, expect, it } from "vitest";
import { nextHead, verifyChain } from "./audit-chain";

describe("audit-chain (10_Security.md §8.3)", () => {
  const tenant = "tenant-uuid-1";
  const baseRow = () => ({
    id: "row-id",
    tenant_id: tenant,
    action: "audit.row",
    ref_type: null,
    ref_id: null,
    metadata: { count: 0 },
    created_at: "2026-07-22T00:00:00.000Z",
  });

  it("chains three rows deterministically", () => {
    let h: string | null = null;
    const rows = [0, 1, 2].map((n) => ({ ...baseRow(), id: `r${n}`, created_at: `2026-07-22T00:00:0${n}.000Z` }));
    for (const r of rows) h = nextHead(h, r);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyChain(rows, h!).ok).toBe(true);
  });

  it("detects tamper at row N", () => {
    const rows = [0, 1, 2].map((n) => ({ ...baseRow(), id: `r${n}`, created_at: `2026-07-22T00:00:0${n}.000Z` }));
    let h: string | null = null;
    for (const r of rows) h = nextHead(h, r);
    const head = h!;
    const tampered = rows.map((r, i) => (i === 1 ? { ...r, action: "tampered.action" } : r));
    const result = verifyChain(tampered, head);
    expect(result.ok).toBe(false);
  });

  it("head mismatch is reported distinctly from mid-chain tamper", () => {
    const rows = [0, 1, 2].map((n) => ({ ...baseRow(), id: `r${n}`, created_at: `2026-07-22T00:00:0${n}.000Z` }));
    expect(verifyChain(rows, "0".repeat(64)).ok).toBe(false);
  });
});
