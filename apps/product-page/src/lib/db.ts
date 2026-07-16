import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const db =
  global.prisma ||
  new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL || "file:dev.db",
      },
    },
  });

if (process.env.NODE_ENV !== "production") {
  global.prisma = db;
}
