export interface MockRow {
  [key: string]: unknown;
}

export interface MockDb {
  tables: Map<string, MockRow[]>;
  executed: string[];
  executedArgs: unknown[][];
  execute: (sql: string, args?: unknown[]) => Promise<{ rows: MockRow[] }>;
  allRows: (sql: string, args?: unknown[]) => Promise<MockRow[]>;
  oneRow: (sql: string, args?: unknown[]) => Promise<MockRow | null>;
  run: (sql: string, args?: unknown[]) => Promise<void>;
}

export function createMockDb(): MockDb {
  const db: MockDb = {
    tables: new Map<string, MockRow[]>(),
    executed: [],
    executedArgs: [],
    execute: async (sql: string, _args: unknown[] = []) => {
      db.executed.push(sql);
      return { rows: [] };
    },
    allRows: async (sql: string, _args: unknown[] = []) => {
      db.executed.push(sql);
      return [];
    },
    oneRow: async (sql: string, _args: unknown[] = []) => {
      db.executed.push(sql);
      return null;
    },
    run: async (sql: string, _args: unknown[] = []) => {
      db.executed.push(sql);
    },
  };
  return db;
}

export async function recordAudit(
  db: MockDb,
  tenantId: string,
  actor: string,
  action: string,
  refType: string | null,
  refId: string | null,
  metadata: unknown,
): Promise<void> {
  const auditRows = db.tables.get("audit_log") ?? [];
  auditRows.push({
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    actor,
    action,
    ref_type: refType,
    ref_id: refId,
    metadata: JSON.stringify(metadata ?? {}),
    created_at: new Date().toISOString(),
  });
  db.tables.set("audit_log", auditRows);
}

export async function recordOutbox(
  db: MockDb,
  tenantId: string,
  table: string,
  rowId: string,
  op: string,
  payload: unknown,
): Promise<void> {
  const outboxRows = db.tables.get("sync_outbox") ?? [];
  outboxRows.push({
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    table_name: table,
    row_id: rowId,
    op,
    payload: JSON.stringify(payload ?? {}),
    status: "pending",
    attempts: 0,
    created_at: new Date().toISOString(),
  });
  db.tables.set("sync_outbox", outboxRows);
}
