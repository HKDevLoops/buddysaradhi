// Implements: docs/design/overhaul-plan.md §4.2 — the admin audit trail, and
// AGENTS.md §2 Rule 1 (BR-SEC-03: every sensitive mutation writes an audit row)
// plus §12_Business_Rules.md BR-SEC-03.
//
// Shape mirrors `prisma/schema.prisma` `model AuditLog` and the existing writer
// in apps/web/src/server/actions/settings.ts (`db.auditLog.create` with
// id, tenantId, actor, action, refType, refId, metadata as a JSON string, and
// createdAt as an ISO string). The console reuses that column-for-column so the
// real sink is a drop-in, with no re-mapping when the entitlement backend lands.
//
// The admin console is not a tenant, so `tenantId` carries the platform marker
// `platform-admin` and the operator is recorded in `actor`. That is the one
// deliberate difference from a per-tenant writer, and docs/design/admin-console.md
// records how the production table handles it.
//
// FAIL CLOSED. `adminAudit` propagates a sink failure instead of swallowing it
// (Rule 9), which means a view that cannot record that it was read does not
// render. A console that silently stops recording reads is worse than one that
// refuses.

import { randomUUID } from "node:crypto";
import type { AdminAuditAction, AdminRefType } from "./types";
import { adminLogError } from "./log";

/** Row scope for console-owned audit entries. */
export const ADMIN_SCOPE_ID = "platform-admin";

export interface AdminAuditRow {
  readonly id: string;
  readonly tenantId: string;
  readonly actor: string;
  readonly action: AdminAuditAction;
  readonly refType: AdminRefType;
  readonly refId: string | null;
  readonly metadata: string | null;
  readonly createdAt: string;
}

export interface AdminAuditInput {
  readonly actor: string;
  readonly action: AdminAuditAction;
  readonly refType: AdminRefType;
  readonly refId?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** The port the real backend implements. One append, one list. */
export interface AdminAuditSink {
  append(row: AdminAuditRow): Promise<void>;
  list(filter: AdminAuditFilter): Promise<readonly AdminAuditRow[]>;
}

export interface AdminAuditFilter {
  readonly action?: AdminAuditAction;
  readonly refId?: string;
  readonly limit: number;
}

const SEED_ROWS: readonly AdminAuditRow[] = [
  {
    id: "a0000000-0000-4000-8000-000000000001",
    tenantId: ADMIN_SCOPE_ID,
    actor: "ops@buddysaradhi.app",
    action: "admin.subscription.update",
    refType: "subscription",
    refId: "t-0007",
    metadata: JSON.stringify({ plan: { from: "batch", to: "institute" }, period: { from: "annual", to: "annual" } }),
    createdAt: "2026-09-28T09:14:00.000Z",
  },
  {
    id: "a0000000-0000-4000-8000-000000000002",
    tenantId: ADMIN_SCOPE_ID,
    actor: "ops@buddysaradhi.app",
    action: "admin.entitlement.grant_set",
    refType: "entitlement",
    refId: "t-0007",
    metadata: JSON.stringify({ grant: "storageQuotaMb", from: 2048, to: 20480 }),
    createdAt: "2026-09-28T09:15:00.000Z",
  },
  {
    id: "a0000000-0000-4000-8000-000000000003",
    tenantId: ADMIN_SCOPE_ID,
    actor: "ops@buddysaradhi.app",
    action: "admin.reminder.advance",
    refType: "reminder",
    refId: "t-0003",
    metadata: JSON.stringify({ from: "gentle-sent", to: "hard-sent", hardReminderCount: 1 }),
    createdAt: "2026-10-01T11:02:00.000Z",
  },
  {
    id: "a0000000-0000-4000-8000-000000000004",
    tenantId: ADMIN_SCOPE_ID,
    actor: "ops@buddysaradhi.app",
    action: "admin.subscriptions.view",
    refType: "subscription",
    refId: null,
    metadata: JSON.stringify({ rows: 8, filter: "all" }),
    createdAt: "2026-10-02T07:41:00.000Z",
  },
];

const RING_CAPACITY = 500;

/**
 * In-memory sink. This pass is UI plus the auth and audit scaffolding, so the
 * rows live for the lifetime of the server process: enough to read a backdated
 * entry off the console, never enough to pretend it is the record of truth.
 * The production sink is `audit_log` through the same interface.
 */
function createMemorySink(): AdminAuditSink {
  const rows: AdminAuditRow[] = [...SEED_ROWS];

  return {
    async append(row) {
      rows.unshift(row);
      if (rows.length > RING_CAPACITY) rows.length = RING_CAPACITY;
    },
    async list(filter) {
      const matches = rows.filter((row) => {
        if (filter.action !== undefined && row.action !== filter.action) return false;
        if (filter.refId !== undefined && row.refId !== filter.refId) return false;
        return true;
      });
      return matches.slice(0, filter.limit);
    },
  };
}

let sink: AdminAuditSink = createMemorySink();

/**
 * Swaps the sink. The entitlement backend calls this once at boot with an
 * `audit_log` writer; tests call it with a capture sink.
 */
export function setAuditSink(next: AdminAuditSink): void {
  sink = next;
}

/** Restores the in-memory sink. Used by tests and by a failed boot. */
export function resetAuditSink(): void {
  sink = createMemorySink();
}

export function adminAuditSink(): AdminAuditSink {
  return sink;
}

/** Writes one audit row. Never swallows a sink failure. */
export async function adminAudit(input: AdminAuditInput): Promise<AdminAuditRow> {
  const row: AdminAuditRow = {
    id: randomUUID(),
    tenantId: ADMIN_SCOPE_ID,
    actor: input.actor,
    action: input.action,
    refType: input.refType,
    refId: input.refId ?? null,
    metadata: input.metadata === undefined ? null : JSON.stringify(input.metadata),
    createdAt: new Date().toISOString(),
  };
  try {
    await sink.append(row);
  } catch (error) {
    adminLogError("admin.audit_append_failed", { action: input.action, actor: input.actor });
    throw error;
  }
  return row;
}

export async function adminAuditList(filter: AdminAuditFilter): Promise<readonly AdminAuditRow[]> {
  return sink.list(filter);
}

/** Metadata is stored as a JSON string; the console renders it, never trusts it. */
export function parseAuditMetadata(row: AdminAuditRow): Record<string, unknown> {
  if (row.metadata === null) return {};
  try {
    const parsed: unknown = JSON.parse(row.metadata);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    // SAFETY: JSON.parse of an object literal, checked above, is a
    // Record<string, unknown>. Values are rendered as text, never executed.
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}
