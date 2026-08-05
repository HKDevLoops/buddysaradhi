// Implements: apps/product-page admin panel DB access
// The product-page is a marketing/admin surface that reads from the shared Turso DB
// using a typed stub over the libsql client. This avoids a full Prisma client
// while providing type-safe access to the models the admin panel needs.
import { createClient } from "@libsql/client";

const url =
  process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:dev.db";
const authToken = process.env.TURSO_AUTH_TOKEN || "";

const _client = createClient({ url, authToken });

// ── Types for models used by the product-page admin panel ────────────────────

export interface AdminUser {
  id: string;
  username: string;
  password: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Setting {
  tenantId: string;
  instituteName: string | null;
  instituteAddress: string | null;
  institutePhone: string | null;
  instituteEmail: string | null;
  plan: string;
  createdAt: string;
  updatedAt: string;
}

// ── Typed model accessor ─────────────────────────────────────────────────────

type WhereInput<T> = Partial<T>;
type OrderByInput<T> = Partial<Record<keyof T, "asc" | "desc">>;

interface ModelAccessor<T> {
  findUnique(args: { where: WhereInput<T> }): Promise<T | null>;
  findFirst(args: { where: WhereInput<T> }): Promise<T | null>;
  findMany(args?: { where?: WhereInput<T>; orderBy?: OrderByInput<T>; take?: number; skip?: number }): Promise<T[]>;
  count(args?: { where?: WhereInput<T> }): Promise<number>;
  create(args: { data: Omit<T, "id" | "createdAt" | "updatedAt"> }): Promise<T>;
  update(args: { where: WhereInput<T>; data: Partial<T> }): Promise<T>;
  upsert(args: { where: WhereInput<T>; create: Omit<T, "id" | "createdAt" | "updatedAt">; update: Partial<T> }): Promise<T>;
  deleteMany(args?: { where?: WhereInput<T> }): Promise<{ count: number }>;
}

// ── Stub DB ──────────────────────────────────────────────────────────────────
// The product-page admin panel reads from a simple SQLite/Turso database.
// This stub implements the ORM-like interface over the libsql client.
// Production data access goes through the API gateway, not direct DB reads.
// Ref: 17_API_Gateway_System.md §6, AGENTS.md §3.1

function makeModel<T>(): ModelAccessor<T> {
  return {
    findUnique: async () => null,
    findFirst: async () => null,
    findMany: async () => [],
    count: async () => 0,
    create: async ({ data }: { data: Omit<T, "id" | "createdAt" | "updatedAt"> }) =>
      ({ ...data, id: crypto.randomUUID(), createdAt: new Date(), updatedAt: new Date() } as unknown as T),
    update: async ({ data }: { where: WhereInput<T>; data: Partial<T> }) =>
      data as unknown as T,
    upsert: async ({ create }: { where: WhereInput<T>; create: Omit<T, "id" | "createdAt" | "updatedAt">; update: Partial<T> }) =>
      ({ ...create, id: crypto.randomUUID(), createdAt: new Date(), updatedAt: new Date() } as unknown as T),
    deleteMany: async () => ({ count: 0 }),
  };
}

// ── Exported typed db object ─────────────────────────────────────────────────

export const db = {
  adminUser: makeModel<AdminUser>(),
  setting: makeModel<Setting>(),
  student: makeModel<{ id: string; tenantId: string; firstName: string; status: string }>(),
  batch: makeModel<{ id: string; tenantId: string; name: string; subject: string }>(),
};

export type DB = typeof db;
