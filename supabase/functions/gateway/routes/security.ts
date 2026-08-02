import type { RouteHandler } from "./students.ts";
import { ok } from "../lib/errors.ts";
import { recordAudit } from "./students.ts";
import { invalidateTenant } from "../lib/cache.ts";
import { createPrismaOrm } from "../lib/orm.ts";

export const handleSecurity: RouteHandler = async (_req, db, tenantId, path, method) => {
  const orm = createPrismaOrm(db, tenantId);

  // POST /api/v1/security/erase
  if (path === "/api/v1/security/erase" && method === "POST") {
    await orm.studentEnrollment.deleteMany({ where: {} });
    await recordAudit(db, tenantId, tenantId, "security.erase", null, null, {});
    invalidateTenant(tenantId);
    return ok({ erased: tenantId });
  }

  return null;
};
