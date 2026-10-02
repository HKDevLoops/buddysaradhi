// Implements: docs/rfc/004-multi-device-network-contract.md C4 + K4;
// 12_Business_Rules.md BR-SYN-01..03 (outbox + audit on every accepted write,
// LWW-via-CAS on `updated_at` for non-ledger rows).
//
// K4-equivalent proof for the web side: a stale `base_updated_at` is rejected
// with a typed CONFLICT + the fresh server row (no write, no outbox row, no
// audit row); a fresh base writes through (write + outbox + audit); a missing
// base takes the legacy path (writes through, unchanged behaviour for
// call sites not yet passing a base).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/server/get-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/get-db")>();
  return {
    ...actual,
    getAuthenticatedDb: vi.fn(),
    getAuthenticatedPrisma: vi.fn(),
    gatewayPatch: vi.fn(),
  };
});

import type { Client } from "@libsql/client";
import {
  getAuthenticatedDb,
  getAuthenticatedPrisma,
  gatewayPatch,
  createLibsqlProxy,
} from "@/server/get-db";
import { log } from "@/lib/logger";
import { updateSettingAction, updateSettingsBatchAction } from "./settings";
import { updateStudentAction } from "./students";

const mockedGetDb = vi.mocked(getAuthenticatedDb);
const mockedGetPrisma = vi.mocked(getAuthenticatedPrisma);
const mockedGatewayPatch = vi.mocked(gatewayPatch);

type Row = Record<string, unknown>;

const TENANT = "t-cas-1";
const STUDENT_ID = "11111111-1111-4111-8111-111111111111";
const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-02-01T00:00:00.000Z";

/** Minimal in-memory libsql `Client`: SELECT/INSERT/UPDATE over plain rows. */
function createFakeClient(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = Object.fromEntries(
    Object.entries(seed).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]),
  );

  function tableOf(sql: string): string {
    // The libsql proxy quotes identifiers (`FROM "settings"`); the raw
    // outbox/audit SQL in the actions does not (`INTO sync_outbox`).
    const match = /FROM "?(\w+)"?|INTO "?(\w+)"?|UPDATE "?(\w+)"?/.exec(sql);
    const name = match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
    if (!tables[name]) tables[name] = [];
    return name;
  }

  function conditionsOf(sql: string): string[] {
    const whereIdx = sql.indexOf(" WHERE ");
    if (whereIdx === -1) return [];
    const tail = sql.slice(whereIdx + 7).split(" LIMIT ")[0] ?? "";
    return tail
      .split(" AND ")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }

  function matches(row: Row, conds: string[], args: unknown[]): boolean {
    let argIdx = 0;
    for (const cond of conds) {
      const eq = /^"(\w+)" = \?$/.exec(cond);
      if (eq) {
        if (row[eq[1] ?? ""] !== args[argIdx]) return false;
        argIdx += 1;
        continue;
      }
      const isNull = /^"(\w+)" IS NULL$/.exec(cond);
      if (isNull) {
        const value = row[isNull[1] ?? ""];
        if (value !== null && value !== undefined) return false;
        continue;
      }
      const isNotNull = /^"(\w+)" IS NOT NULL$/.exec(cond);
      if (isNotNull) {
        const value = row[isNotNull[1] ?? ""];
        if (value === null || value === undefined) return false;
        continue;
      }
      throw new Error(`fake-db: unsupported condition: ${cond}`);
    }
    return true;
  }

  async function execute(query: { sql: string; args?: unknown[] } | string) {
    const sql = typeof query === "string" ? query : query.sql;
    const args = (typeof query === "string" ? [] : (query.args ?? [])) as unknown[];
    const name = tableOf(sql);
    const rows = tables[name] ?? [];
    if (/^\s*SELECT/i.test(sql)) {
      const matched = rows.filter((row) => matches(row, conditionsOf(sql), args));
      const limited = /LIMIT 1/i.test(sql) ? matched.slice(0, 1) : matched;
      return { rows: limited.map((row) => ({ ...row })), rowsAffected: 0 };
    }
    if (/^\s*INSERT/i.test(sql)) {
      const colsMatch = /\(([^)]+)\)\s*VALUES/i.exec(sql);
      const cols = (colsMatch?.[1] ?? "")
        .split(",")
        .map((col) => col.trim().replace(/"/g, ""));
      const row: Row = {};
      cols.forEach((col, idx) => {
        row[col] = args[idx];
      });
      rows.push(row);
      return { rows: [], rowsAffected: 1 };
    }
    if (/^\s*UPDATE/i.test(sql)) {
      const setStart = sql.indexOf(" SET ") + 5;
      const setEnd = sql.indexOf(" WHERE ");
      const setCols = sql
        .slice(setStart, setEnd)
        .split(",")
        .map((part) => part.split("=")[0]?.trim().replace(/"/g, "") ?? "");
      const setVals = args.slice(0, setCols.length);
      const whereArgs = args.slice(setCols.length);
      const whereIdx = sql.indexOf(" WHERE ");
      const conds = conditionsOf(sql.slice(0, whereIdx) + " WHERE " + sql.slice(whereIdx + 7));
      let count = 0;
      for (const row of rows) {
        if (matches(row, conds, whereArgs)) {
          setCols.forEach((col, idx) => {
            row[col] = setVals[idx];
          });
          count += 1;
        }
      }
      return { rows: [], rowsAffected: count };
    }
    throw new Error(`fake-db: unsupported SQL: ${sql}`);
  }

  async function batch(stmts: Array<{ sql: string; args: unknown[] }>) {
    const out = [];
    for (const stmt of stmts) out.push(await execute(stmt));
    return out;
  }

  return { client: { execute, batch } as unknown as Client, tables };
}

let fake: ReturnType<typeof createFakeClient>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  fake = createFakeClient({
    settings: [
      {
        tenant_id: TENANT,
        institute_name: "Old Institute",
        tenant_secret: "s3cr3t",
        pin_hash: "hash",
        created_at: T0,
        updated_at: T1,
      },
    ],
    students: [
      {
        id: STUDENT_ID,
        tenant_id: TENANT,
        code: "S-1",
        first_name: "Old",
        last_name: null,
        admission_date: "2026-01-15",
        status: "active",
        fee_model: "postpaid",
        base_fee_paise: 0,
        balance_paise: 0,
        dup_key: "S-1",
        created_at: T0,
        updated_at: T1,
      },
    ],
    sync_outbox: [],
    audit_log: [],
  });
  mockedGetDb.mockResolvedValue({ client: fake.client, userId: TENANT, tenantId: TENANT });
  mockedGetPrisma.mockResolvedValue({
    db: createLibsqlProxy(fake.client),
    userId: TENANT,
    tenantId: TENANT,
  });
  // Gateway unreachable by default → exercises the local-fallback write path,
  // where the defensive pre-check + outbox/audit writes are observable.
  mockedGatewayPatch.mockResolvedValue({ success: false, error: "Gateway 503: service unavailable" });
  warnSpy = vi.spyOn(log, "warn");
});

describe("settings CAS (RFC-004 C4)", () => {
  it("fresh base writes through: write + outbox + audit, base forwarded to gateway", async () => {
    const res = await updateSettingAction("instituteName", "New Institute", { base_updated_at: T1 });
    expect(res).toMatchObject({ success: true });
    expect(mockedGatewayPatch).toHaveBeenCalledWith("/api/v1/settings", {
      instituteName: "New Institute",
      base_updated_at: T1,
    });
    expect(fake.tables.settings[0]?.institute_name).toBe("New Institute");
    expect(fake.tables.settings[0]?.updated_at).not.toBe(T1);
    expect(fake.tables.sync_outbox).toHaveLength(1);
    expect(fake.tables.audit_log).toHaveLength(1);
  });

  it("stale base is rejected: CONFLICT + server row, no write, no outbox/audit row", async () => {
    const res = await updateSettingAction("instituteName", "Stale Write", { base_updated_at: T0 });
    expect(res).toMatchObject({
      success: false,
      code: "CONFLICT",
      error: "CONFLICT: settings changed elsewhere",
      // The proxy returns camelCase rows (as does the gateway ORM output).
      serverRow: expect.objectContaining({ instituteName: "Old Institute", updatedAt: T1 }),
    });
    // Secrets never echo in the 409 row (either spelling).
    const serverRow = (res as unknown as { serverRow?: Row }).serverRow ?? {};
    expect(serverRow).not.toHaveProperty("pin_hash");
    expect(serverRow).not.toHaveProperty("pinHash");
    expect(serverRow).not.toHaveProperty("tenant_secret");
    expect(serverRow).not.toHaveProperty("tenantSecret");
    // Nothing happened: row untouched, no replication/audit trail for the
    // rejected attempt, gateway never called.
    expect(fake.tables.settings[0]?.institute_name).toBe("Old Institute");
    expect(fake.tables.sync_outbox).toHaveLength(0);
    expect(fake.tables.audit_log).toHaveLength(0);
    expect(mockedGatewayPatch).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("cas_conflict_settings", expect.any(String));
  });

  it("missing base takes the legacy path: writes through with no CAS", async () => {
    const res = await updateSettingAction("instituteName", "Legacy Write");
    expect(res).toMatchObject({ success: true });
    expect(mockedGatewayPatch).toHaveBeenCalledWith("/api/v1/settings", {
      instituteName: "Legacy Write",
    });
    expect(fake.tables.settings[0]?.institute_name).toBe("Legacy Write");
    expect(fake.tables.sync_outbox).toHaveLength(1);
    expect(fake.tables.audit_log).toHaveLength(1);
  });

  it("gateway 409 maps to CONFLICT with a fresh row and no local write", async () => {
    mockedGatewayPatch.mockResolvedValueOnce({
      success: false,
      error: 'Gateway 409: {"success":false,"error":"CONFLICT: settings changed elsewhere"}',
    });
    const res = await updateSettingAction("instituteName", "Raced Write", { base_updated_at: T1 });
    expect(res).toMatchObject({
      success: false,
      code: "CONFLICT",
      serverRow: expect.objectContaining({ instituteName: "Old Institute" }),
    });
    expect(fake.tables.settings[0]?.institute_name).toBe("Old Institute");
    expect(fake.tables.sync_outbox).toHaveLength(0);
    expect(fake.tables.audit_log).toHaveLength(0);
  });

  it("batch path: stale base rejected, fresh base writes + outbox + audit", async () => {
    const stale = await updateSettingsBatchAction({ instituteName: "Stale Batch" }, { base_updated_at: T0 });
    expect(stale).toMatchObject({ success: false, code: "CONFLICT" });
    expect(mockedGatewayPatch).not.toHaveBeenCalled();
    expect(fake.tables.sync_outbox).toHaveLength(0);

    const fresh = await updateSettingsBatchAction({ instituteName: "Fresh Batch" }, { base_updated_at: T1 });
    expect(fresh).toMatchObject({ success: true });
    expect(fake.tables.settings[0]?.institute_name).toBe("Fresh Batch");
    expect(fake.tables.sync_outbox).toHaveLength(1);
    expect(fake.tables.audit_log).toHaveLength(1);
  });
});

describe("student profile CAS (RFC-004 C4)", () => {
  it("fresh base writes through: write + outbox + audit, base forwarded to gateway", async () => {
    const res = await updateStudentAction(STUDENT_ID, { first_name: "New" }, { base_updated_at: T1 });
    expect(res).toMatchObject({ success: true });
    expect(mockedGatewayPatch).toHaveBeenCalledWith(`/api/v1/students/${STUDENT_ID}`, {
      first_name: "New",
      base_updated_at: T1,
    });
    const data = (res as unknown as { data?: { first_name?: string; updated_at?: string } }).data;
    expect(data?.first_name).toBe("New");
    expect(data?.updated_at).not.toBe(T1);
    expect(fake.tables.sync_outbox).toHaveLength(1);
    expect(fake.tables.audit_log).toHaveLength(1);
  });

  it("stale base is rejected: CONFLICT + server row, no write, no outbox/audit row", async () => {
    const res = await updateStudentAction(STUDENT_ID, { first_name: "Stale" }, { base_updated_at: T0 });
    expect(res).toMatchObject({
      success: false,
      code: "CONFLICT",
      error: "CONFLICT: student changed elsewhere",
      serverRow: expect.objectContaining({ first_name: "Old", updated_at: T1 }),
    });
    const row = fake.tables.students[0];
    expect(row?.first_name).toBe("Old");
    expect(fake.tables.sync_outbox).toHaveLength(0);
    expect(fake.tables.audit_log).toHaveLength(0);
    expect(mockedGatewayPatch).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("cas_conflict_student", expect.any(String));
  });

  it("missing base takes the legacy path: writes through with no CAS", async () => {
    const res = await updateStudentAction(STUDENT_ID, { first_name: "Legacy" });
    expect(res).toMatchObject({ success: true });
    expect(mockedGatewayPatch).toHaveBeenCalledWith(`/api/v1/students/${STUDENT_ID}`, {
      first_name: "Legacy",
    });
    expect(fake.tables.students[0]?.first_name).toBe("Legacy");
    expect(fake.tables.sync_outbox).toHaveLength(1);
  });

  it("gateway 409 maps to CONFLICT with a fresh row and no local write", async () => {
    mockedGatewayPatch.mockResolvedValueOnce({
      success: false,
      error: 'Gateway 409: {"success":false,"error":"CONFLICT: student changed elsewhere"}',
    });
    const res = await updateStudentAction(STUDENT_ID, { first_name: "Raced" }, { base_updated_at: T1 });
    expect(res).toMatchObject({
      success: false,
      code: "CONFLICT",
      serverRow: expect.objectContaining({ first_name: "Old" }),
    });
    expect(fake.tables.students[0]?.first_name).toBe("Old");
    expect(fake.tables.sync_outbox).toHaveLength(0);
    expect(fake.tables.audit_log).toHaveLength(0);
  });
});
