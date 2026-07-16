import { randomBytes, randomUUID } from "crypto";
import { getPrismaClient } from "./db";
import type { PrismaClient } from "./prisma-client";

/**
 * provisionTutorDb: bootstrap a fresh tutor namespace.
 *
 * Local-dev: the gateway serves a single sqlite file, so "provisioning a tutor"
 * means minting a new tenantId + tenantSecret (per-tenant isolation per
 * 11_Data_Model.md §1). The schema is already applied to the shared DB via
 * `bunx prisma db push`. The caller (web signup flow) then stores db_url +
 * db_token + tenantId in the Supabase user_metadata so the browser can reach
 * this tutor's rows.
 *
 * Real deployment (TODO, 15_Future_Roadmap.md v2 / 17_API_Gateway_System.md):
 * create a dedicated Turso DB for this tutor via the platform API, run
 * `prisma db push --schema` against it, then upsert the Setting. dbUrl/dbToken
 * returned would be that new DB's credentials. The rest of this function is
 * unchanged.
 *
 * Implements: AGENTS.md §2 (append-only + tenantSecret for the hash chain),
 * §1 single-tenant-per-tutor, no console.log in prod paths.
 */
export interface ProvisionResult {
  tenantId: string;
  tenantSecret: string;
  dbUrl: string;
  dbToken: string;
  prisma: PrismaClient;
}

export async function provisionTutorDb(
  dbUrl: string,
  dbToken: string
): Promise<ProvisionResult> {
  const prisma = getPrismaClient(dbUrl, dbToken);
  const tenantId = randomUUID();
  const tenantSecret = randomBytes(32).toString("hex");
  const now = new Date().toISOString();

  await prisma.setting.upsert({
    where: { tenantId },
    create: { tenantId, tenantSecret, createdAt: now, updatedAt: now },
    update: {},
  });

  await prisma.appState.upsert({
    where: { tenantId },
    create: { tenantId, schemaVersion: 1, createdAt: now },
    update: {},
  });

  return { tenantId, tenantSecret, dbUrl, dbToken, prisma };
}
