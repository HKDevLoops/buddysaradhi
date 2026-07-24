import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:dev.db";
const authToken = process.env.TURSO_AUTH_TOKEN || "";

const client = createClient({ url, authToken });

export const db = new Proxy({}, {
  get: (_, prop: string) => {
    return {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      count: async () => 0,
      create: async ({ data }: any) => data,
      update: async ({ data }: any) => data,
      upsert: async ({ create }: any) => create,
      deleteMany: async () => ({ count: 0 }),
    };
  }
});
