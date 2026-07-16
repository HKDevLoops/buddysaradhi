import type { Hono } from "hono";
import { ok, fail, getContext } from "../lib/respond";

export function registerSettings(app: Hono) {
  app.get("/api/v1/settings", async (c) => {
    const { db, tenantId } = getContext(c);
    const setting = await db.setting.findUnique({ where: { tenantId } });
    return ok(c, setting);
  });

  app.post("/api/v1/settings", async (c) => {
    const { db, tenantId } = getContext(c);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const now = new Date().toISOString();
    const setting = await db.setting.upsert({
      where: { tenantId },
      create: { tenantId, ...(body as object), createdAt: now } as never,
      update: body as never,
    });
    return ok(c, setting, 201);
  });

  app.patch("/api/v1/settings", async (c) => {
    const { db, tenantId } = getContext(c);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      const setting = await db.setting.update({
        where: { tenantId },
        data: body as never,
      });
      return ok(c, setting);
    } catch {
      return fail(c, "Setting not found for tenant", 404);
    }
  });
}
