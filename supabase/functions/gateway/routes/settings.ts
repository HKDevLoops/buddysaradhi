import type { RouteHandler } from "./students.ts";
import { ok, fail } from "../lib/errors.ts";
import { recordAudit } from "./students.ts";
import { getCached, setCache, invalidateTenant } from "../lib/cache.ts";
import { createPrismaOrm } from "../lib/orm.ts";

export const handleSettings: RouteHandler = async (req, db, tenantId, path, method) => {
  const orm = createPrismaOrm(db, tenantId);

  // GET /api/v1/settings
  if (path === "/api/v1/settings" && method === "GET") {
    const settingsCacheKey = `settings:${tenantId}`;
    const cached = getCached(settingsCacheKey);
    if (cached) return ok(cached);

    const setting = await orm.setting.findFirst({ where: {} });
    setCache(settingsCacheKey, setting, 120_000);
    return ok(setting);
  }

  // PATCH /api/v1/settings
  if (path === "/api/v1/settings" && method === "PATCH") {
    const body = await req.json().catch(() => ({}));
    if (Object.keys(body).length === 0) return fail("no_valid_fields", 400);

    const updated = await orm.setting.upsert({
      where: { tenantId },
      create: {
        instituteName: body.instituteName ?? body.institute_name ?? "My Tuition",
        ...body,
      },
      update: body,
    });

    await recordAudit(db, tenantId, tenantId, "settings.update", "settings", tenantId, body);
    invalidateTenant(tenantId);
    return ok(updated);
  }

  // POST /api/v1/settings/pin
  if (path === "/api/v1/settings/pin" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const { pin_hash } = body;
    if (!pin_hash || typeof pin_hash !== "string") {
      return fail("pin_hash required", 400);
    }

    const updated = await orm.setting.upsert({
      where: { tenantId },
      create: {
        instituteName: "My Tuition",
        pinHash: pin_hash,
      },
      update: {
        pinHash: pin_hash,
      },
    });

    await recordAudit(db, tenantId, tenantId, "pin.update", "settings", tenantId, {});
    invalidateTenant(tenantId);
    return ok({ ok: true, setting: updated });
  }

  return null;
};
