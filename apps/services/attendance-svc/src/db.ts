import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { getTursoClient } from "./turso/client";

class Database {
  private static instance: PrismaClient;
  private static initLock = false;

  private constructor() {}

  public static getInstance(): PrismaClient {
    if (!Database.instance) {
      if (!Database.initLock) {
        Database.initLock = true;
        const libsql = getTursoClient();
        const adapter = new PrismaLibSQL(libsql) as any;
        const prisma = new PrismaClient({ adapter });
        Database.instance = prisma;
        Database.initLock = false;
      }
    }
    return Database.instance;
  }
}

export const db = Database.getInstance();
