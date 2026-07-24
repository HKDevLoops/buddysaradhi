// Implements: 10_Security.md §8.3 Audit log SHA-256 chain.

import { createHash } from "crypto";

export type AuditChainHead = string; // hex sha256

export interface AuditChainRow {
  id: string;
  tenant_id: string;
  action: string;
  ref_type: string | null;
  ref_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string; // ISO 8601
}

export function canonicalJson(row: AuditChainRow): string {
  return JSON.stringify({
    id: row.id,
    tenant_id: row.tenant_id,
    action: row.action,
    ref_type: row.ref_type,
    ref_id: row.ref_id,
    metadata: row.metadata,
    created_at: row.created_at,
  });
}

export function nextHead(prevHead: AuditChainHead | null, row: AuditChainRow): AuditChainHead {
  const raw = `${prevHead ?? ""}|${canonicalJson(row)}`;
  return createHash("sha256").update(raw).digest("hex");
}

export function verifyChain(rows: AuditChainRow[], expectedHead: AuditChainHead): { ok: true } | { ok: false; brokenAtIndex: number; reason: "tamper-detected" | "head-mismatch" } {
  let h: AuditChainHead | null = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    h = nextHead(h, row);
  }
  if (h !== expectedHead) return { ok: false, brokenAtIndex: rows.length - 1, reason: "head-mismatch" };
  return { ok: true };
}
