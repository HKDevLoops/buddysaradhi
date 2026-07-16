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
        
        const prisma = new PrismaClient({
          adapter,
        });

        // BR-LED-01: Prisma middleware to enforce append-only ledger and audit logs
        prisma.$use(async (params, next) => {
          if (params.model === "LedgerEntry" || params.model === "AuditLog") {
            if (
              params.action === "update" ||
              params.action === "updateMany" ||
              params.action === "delete" ||
              params.action === "deleteMany"
            ) {
              throw new Error(`BR-LED-01: ${params.model} cannot be updated or deleted.`);
            }
          }
          return next(params);
        });
        
        Database.instance = prisma;
        Database.initLock = false;
      }
    }
    return Database.instance;
  }
}

export const db = Database.getInstance();
