import type { RouteHandler } from "./students.ts";
import { ok, fail } from "../lib/errors.ts";
import { recordAudit } from "./students.ts";
import { createPrismaOrm } from "../lib/orm.ts";

const NOTIFICATION_CATEGORIES = ["fee", "attendance", "student", "system", "reminder"] as const;

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

    // Validate required fields
    if (!body.category || typeof body.category !== "string") {
      return fail("category is required", 400);
    }
    if (!body.title || typeof body.title !== "string") {
      return fail("title is required", 400);
    }

    // Sanitize: strip control characters from user-provided strings
    // deno-lint-ignore no-control-regex
    const sanitize = (s: string) => s.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 500);
    const category = sanitize(body.category);
    const title = sanitize(body.title);
    const bodyText = body.body ? sanitize(String(body.body)) : null;

    // Validate category is in allowed set
    if (!NOTIFICATION_CATEGORIES.includes(category as typeof NOTIFICATION_CATEGORIES[number])) {
      return fail(`invalid category: must be one of ${NOTIFICATION_CATEGORIES.join(", ")}`, 400);
    }

    const created = await orm.notification.create({
      data: {
        category,
        title,
        body: bodyText,
        refType: body.refType ?? body.ref_type ?? null,
        refId: body.refId ?? body.ref_id ?? null,
      },
    });
    await recordAudit(db, tenantId, tenantId, "notification.create", "notification", created.id, { category, title });
    return ok({ id: created.id }, 201);
  }

  // PATCH /api/v1/notifications/:id
  if (path.startsWith("/api/v1/notifications/") && path !== "/api/v1/notifications/" && method === "PATCH") {
    const id = path.split("/").pop()!;
    return ok({ id, read: true });
  }

  return null;
};
