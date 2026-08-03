import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/db.ts", () => ({
  oneRow: async (db: any, sql: string, args: unknown[] = []) => {
    const res = await db.execute({ sql, args });
    return res.rows[0] ?? null;
  },
  allRows: async (db: any, sql: string, args: unknown[] = []) => {
    const res = await db.execute({ sql, args });
    return res.rows ?? [];
  },
}));

import { execLocal } from "../graphql/executor";

function createMockDb(rowsBySql: Record<string, Record<string, unknown>[]>) {
  return {
    execute: async (stmt: string | { sql: string; args?: unknown[] }) => {
      const sqlQuery = typeof stmt === "string" ? stmt : stmt.sql;
      for (const [key, rows] of Object.entries(rowsBySql)) {
        if (sqlQuery.includes(key) || key.includes(sqlQuery)) {
          return { rows };
        }
      }
      return { rows: [] };
    },
  } as any;
}

describe("GraphQL Gateway Executor (execLocal)", () => {
  it("resolves { health } correctly without Promise projection errors", async () => {
    const mockDb = createMockDb({});
    const res = await execLocal("{ health }", {}, { db: mockDb, tenantId: "tenant-1" });
    expect(res).toEqual({
      data: {
        health: "ok",
      },
    });
  });

  it("resolves { settings } including palette, theme, and density fields", async () => {
    const mockDb = createMockDb({
      "SELECT * FROM settings WHERE tenant_id = ?": [
        {
          id: "tenant-1",
          tenant_id: "tenant-1",
          institute_name: "BuddySaradhi Academy",
          palette: "emerald-ledger",
          theme: "dark",
          density: "compact",
        },
      ],
    });
    const query = `{
      settings(tenantId: "tenant-1") {
        id
        instituteName
        palette
        theme
        density
      }
    }`;
    const res = await execLocal(query, {}, { db: mockDb, tenantId: "tenant-1" });
    expect((res as any).data.settings).toMatchObject({
      id: "tenant-1",
      instituteName: "BuddySaradhi Academy",
      palette: "emerald-ledger",
      theme: "dark",
      density: "compact",
    });
  });

  it("rejects { settings } when tenantId does not match authenticated ctx.tenantId", async () => {
    const mockDb = createMockDb({});
    const query = `{
      settings(tenantId: "other-tenant") {
        palette
      }
    }`;
    await expect(
      execLocal(query, {}, { db: mockDb, tenantId: "tenant-1" })
    ).rejects.toThrow("forbidden: tenant mismatch");
  });
});
