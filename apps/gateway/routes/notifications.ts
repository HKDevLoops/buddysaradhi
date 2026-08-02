import type { RouteHandler } from "./students.ts";
import { ok } from "../lib/errors.ts";
import { recordAudit } from "./students.ts";
import { createPrismaOrm } from "../lib/orm.ts";

export const handleNotifications: RouteHandler = async (req, db, tenantId, path, method, url) => {
  const sp = url.searchParams;
  const orm = createPrismaOrm(db, tenantId);

  // GET /api/v1/notifications
  if (path === "/api/v1/notifications" && method === "GET") {
    const limit = Math.min(50, parseInt(sp.get("limit") ?? "20", 10));
    const rows = await orm.notification.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return ok(rows);
  }

  // POST /api/v1/notifications
  if (path === "/api/v1/notifications" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const created = await orm.notification.create({
      data: {
        category: body.category ?? "system",
        title: body.title ?? "Notification",
        body: body.body ?? null,
        refType: body.refType ?? body.ref_type ?? null,
        refId: body.refId ?? body.ref_id ?? null,
      },
    });
    await recordAudit(db, tenantId, tenantId, "notification.create", "notification", created.id, body);
    return ok({ id: created.id }, 201);
  }

  // PATCH /api/v1/notifications/:id
  if (path.startsWith("/api/v1/notifications/") && path !== "/api/v1/notifications/" && method === "PATCH") {
    const id = path.split("/").pop()!;
    return ok({ id, read: true });
  }

  return null;
};
