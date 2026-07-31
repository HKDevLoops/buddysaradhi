import { describe, it, expect } from "vitest";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-db-url, x-db-token, x-tutor-id",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function ok(data: unknown, status = 200): Response {
  return json({ success: true, data }, status);
}

function fail(error: string, status = 400): Response {
  return json({ success: false, error }, status);
}

describe("ok()", () => {
  it("returns 200 with { success: true, data }", async () => {
    const res = ok({ id: 1, name: "test" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { id: 1, name: "test" } });
  });

  it("supports custom status code", async () => {
    const res = ok({ created: true }, 201);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("wraps primitives in data field", async () => {
    const res = ok("hello");
    const body = await res.json();
    expect(body).toEqual({ success: true, data: "hello" });
  });

  it("wraps arrays in data field", async () => {
    const res = ok([1, 2, 3]);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: [1, 2, 3] });
  });

  it("handles null data", async () => {
    const res = ok(null);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: null });
  });

  it("handles undefined data", async () => {
    const res = ok(undefined);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: undefined });
  });

  it("sets Content-Type to application/json", () => {
    const res = ok({});
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("sets CORS headers", () => {
    const res = ok({});
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain(
      "authorization",
    );
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("DELETE");
  });
});

describe("fail()", () => {
  it("returns 400 with { success: false, error }", async () => {
    const res = fail("bad request");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: "bad request" });
  });

  it("supports custom status code", async () => {
    const res = fail("not found", 404);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("not found");
  });

  it("supports 500 status", async () => {
    const res = fail("internal error", 500);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: "internal error" });
  });

  it("supports 401 status", async () => {
    const res = fail("unauthenticated", 401);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthenticated");
  });

  it("supports 403 status", async () => {
    const res = fail("forbidden", 403);
    expect(res.status).toBe(403);
  });

  it("sets Content-Type to application/json", () => {
    const res = fail("error");
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("sets CORS headers", () => {
    const res = fail("error");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("handles empty error string", async () => {
    const res = fail("");
    const body = await res.json();
    expect(body).toEqual({ success: false, error: "" });
  });
});

describe("json()", () => {
  it("returns 200 with raw data (no wrapper)", async () => {
    const res = json({ key: "value" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ key: "value" });
  });

  it("supports custom status code", async () => {
    const res = json({ created: true }, 201);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ created: true });
  });

  it("supports 202 accepted status", async () => {
    const res = json({ status: "processing" }, 202);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ status: "processing" });
  });

  it("wraps arrays without additional nesting", async () => {
    const res = json([{ id: 1 }, { id: 2 }]);
    const body = await res.json();
    expect(body).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("sets Content-Type to application/json", () => {
    const res = json({});
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("sets CORS headers", () => {
    const res = json({});
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain(
      "content-type",
    );
  });

  it("handles complex nested objects", async () => {
    const data = {
      students: [{ id: "1", name: "Alice" }],
      total: 1,
      meta: { page: 1, pageSize: 50 },
    };
    const res = json(data);
    const body = await res.json();
    expect(body).toEqual(data);
  });
});

describe("CORS headers contract", () => {
  it("all responses include Access-Control-Allow-Origin: *", () => {
    const okRes = ok({});
    const failRes = fail("err");
    const jsonRes = json({});
    for (const res of [okRes, failRes, jsonRes]) {
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    }
  });

  it("allows x-db-url and x-db-token headers", () => {
    const res = ok({});
    const headers = res.headers.get("Access-Control-Allow-Headers") ?? "";
    expect(headers).toContain("x-db-url");
    expect(headers).toContain("x-db-token");
  });

  it("allows DELETE method", () => {
    const res = ok({});
    const methods = res.headers.get("Access-Control-Allow-Methods") ?? "";
    expect(methods).toContain("DELETE");
  });
});
