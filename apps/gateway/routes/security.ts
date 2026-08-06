import type { RouteHandler } from "./students.ts";
import { ok, fail } from "../lib/errors.ts";
import { recordAudit } from "./students.ts";
import { invalidateTenant } from "../lib/cache.ts";
import { createPrismaOrm } from "../lib/orm.ts";

export const handleSecurity: RouteHandler = async (req, db, tenantId, path, method) => {
  const orm = createPrismaOrm(db, tenantId);

  // POST /api/v1/security/erase
  if (path === "/api/v1/security/erase" && method === "POST") {
    // P0 SECURITY FIX: Require PIN confirmation before destructive erase.
    // This endpoint previously deleted all enrollments without any re-auth,
    // making it a data-destruction vector with only a JWT gate.
    const body = await req.json().catch(() => ({}));
    const { pin_hash } = body;
    if (!pin_hash || typeof pin_hash !== "string") {
      return fail("pin_hash required for erase confirmation", 400);
    }

    // Verify PIN against stored hash
    const setting = await orm.setting.findFirst({ where: {} });
    if (!setting?.pinHash) {
      return fail("PIN not configured — cannot verify erase request", 400);
    }
    if (setting.pinHash !== pin_hash) {
      return fail("invalid PIN — erase denied", 403);
    }

    await orm.studentEnrollment.deleteMany({ where: {} });
    await recordAudit(db, tenantId, tenantId, "security.erase", null, null, {});
    invalidateTenant(tenantId);
    return ok({ erased: tenantId });
  }

  return null;
};
