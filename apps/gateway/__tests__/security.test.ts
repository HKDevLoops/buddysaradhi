import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  validateRequestSize,
  validateUrl,
  validateHeaders,
  validatePath,
  validateRequestBody,
  checkIpRateLimit,
  validateNonce,
  validateTimestamp,
  trackFailedAuth,
  clearFailedAuth,
  getSecurityHeaders,
  runSecurityChecks,
  generateRequestId,
} from "../lib/security.ts";

function makeRequest(
  url: string,
  opts: RequestInit & { method?: string } = {},
): Request {
  return new Request(url, {
    method: opts.method ?? "GET",
    headers: opts.headers ?? {},
    body: opts.body,
  });
}

describe("validateRequestSize", () => {
  it("allows requests with no content-length", () => {
    const req = makeRequest("https://example.com/api/v1/students");
    expect(validateRequestSize(req).allowed).toBe(true);
  });

  it("allows requests under 1MB", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      method: "POST",
      headers: { "content-length": "500000" },
    });
    expect(validateRequestSize(req).allowed).toBe(true);
  });

  it("rejects requests over 1MB", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      method: "POST",
      headers: { "content-length": "2000000" },
    });
    const result = validateRequestSize(req);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(413);
  });

  it("rejects invalid content-length", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      method: "POST",
      headers: { "content-length": "abc" },
    });
    const result = validateRequestSize(req);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });

  it("rejects negative content-length", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      method: "POST",
      headers: { "content-length": "-1" },
    });
    const result = validateRequestSize(req);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });
});

describe("validateUrl", () => {
  it("allows normal URLs", () => {
    const req = makeRequest("https://example.com/api/v1/students?page=1");
    expect(validateUrl(req).allowed).toBe(true);
  });

  it("rejects URLs with too many query params", () => {
    const params = Array.from({ length: 60 }, (_, i) => `p${i}=v${i}`).join("&");
    const req = makeRequest(`https://example.com/api/v1/students?${params}`);
    const result = validateUrl(req);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });

  it("rejects SQL injection in query params", () => {
    const req = makeRequest("https://example.com/api/v1/students?search=1%20OR%201%3D1");
    const result = validateUrl(req);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });

  it("rejects XSS in query params", () => {
    const req = makeRequest("https://example.com/api/v1/students?name=%3Cscript%3Ealert(1)%3C/script%3E");
    const result = validateUrl(req);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });

  it("rejects path traversal in query params", () => {
    const req = makeRequest("https://example.com/api/v1/students?file=../../etc/passwd");
    const result = validateUrl(req);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });

  it("allows normal query params", () => {
    const req = makeRequest("https://example.com/api/v1/students?search=alice&status=active");
    expect(validateUrl(req).allowed).toBe(true);
  });
});

describe("validateHeaders", () => {
  it("allows normal headers for GET", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      headers: { authorization: "Bearer test-token" },
    });
    expect(validateHeaders(req).allowed).toBe(true);
  });

  it("rejects POST without content-type", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      method: "POST",
    });
    const result = validateHeaders(req);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });

  it("rejects unsupported content-type", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      method: "POST",
      headers: { "content-type": "text/xml" },
    });
    const result = validateHeaders(req);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(415);
  });

  it("allows application/json content-type", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(validateHeaders(req).allowed).toBe(true);
  });

  it("allows application/x-www-form-urlencoded", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(validateHeaders(req).allowed).toBe(true);
  });

  it("removes dangerous headers", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      headers: {
        "x-forwarded-host": "evil.com",
        "x-real-ip": "1.2.3.4",
      },
    });
    const result = validateHeaders(req);
    expect(result.allowed).toBe(true);
    expect(req.headers.has("x-forwarded-host")).toBe(false);
    expect(req.headers.has("x-real-ip")).toBe(false);
  });

  it("rejects headers exceeding max length", () => {
    const longValue = "a".repeat(5000);
    const req = makeRequest("https://example.com/api/v1/students", {
      headers: { "x-custom": longValue },
    });
    const result = validateHeaders(req);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });
});

describe("validatePath", () => {
  it("allows normal paths", () => {
    expect(validatePath("/api/v1/students").allowed).toBe(true);
    expect(validatePath("/api/v1/students/123").allowed).toBe(true);
    expect(validatePath("/api/v1/analytics/dashboard").allowed).toBe(true);
  });

  it("rejects path traversal", () => {
    expect(validatePath("/api/v1/../../../etc/passwd").allowed).toBe(false);
    expect(validatePath("/api/v1/%2e%2e%2f").allowed).toBe(false);
  });

  it("rejects command injection", () => {
    expect(validatePath("/api/v1/students;ls").allowed).toBe(false);
    expect(validatePath("/api/v1/students|cat").allowed).toBe(false);
    expect(validatePath("/api/v1/students`whoami`").allowed).toBe(false);
    expect(validatePath("/api/v1/students$(cmd)").allowed).toBe(false);
  });

  it("normalizes double slashes", () => {
    const result = validatePath("/api//v1//students");
    expect(result.allowed).toBe(true);
  });
});

describe("validateRequestBody", () => {
  it("allows empty body", () => {
    expect(validateRequestBody("").allowed).toBe(true);
  });

  it("allows normal JSON body", () => {
    const body = JSON.stringify({ first_name: "Alice", grade: "10" });
    expect(validateRequestBody(body).allowed).toBe(true);
  });

  it("rejects SQL injection in body", () => {
    expect(validateRequestBody("1 OR 1=1").allowed).toBe(false);
    expect(validateRequestBody("'; DROP TABLE students; --").allowed).toBe(false);
  });

  it("rejects XSS in body", () => {
    expect(validateRequestBody('<script>alert(1)</script>').allowed).toBe(false);
    expect(validateRequestBody('<img src=x onerror=alert(1)>').allowed).toBe(false);
  });

  it("sanitizes null bytes", () => {
    const body = "hello\x00world";
    const result = validateRequestBody(body);
    expect(result.allowed).toBe(true);
  });
});

describe("checkIpRateLimit", () => {
  beforeEach(() => {
    // Rate limit state is module-level, so we use unique IPs per test
  });

  it("allows first request from new IP", () => {
    const result = checkIpRateLimit("1.2.3.4-new");
    expect(result.allowed).toBe(true);
  });

  it("allows requests under limit", () => {
    const ip = "5.6.7.8-under";
    for (let i = 0; i < 50; i++) {
      checkIpRateLimit(ip);
    }
    const result = checkIpRateLimit(ip);
    expect(result.allowed).toBe(true);
  });

  it("rejects requests over limit", () => {
    const ip = "9.10.11.12-over";
    for (let i = 0; i < 110; i++) {
      checkIpRateLimit(ip);
    }
    const result = checkIpRateLimit(ip);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(429);
  });
});

describe("validateNonce", () => {
  it("rejects empty nonce", () => {
    const result = validateNonce("", "tenant-1");
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });

  it("rejects short nonce", () => {
    const result = validateNonce("abc", "tenant-1");
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });

  it("allows valid nonce", () => {
    const nonce = crypto.randomUUID().replace(/-/g, "").padEnd(32, "0");
    const result = validateNonce(nonce, "tenant-1");
    expect(result.allowed).toBe(true);
  });

  it("rejects replayed nonce", () => {
    const nonce = crypto.randomUUID().replace(/-/g, "").padEnd(32, "0");
    validateNonce(nonce, "tenant-replay");
    const result = validateNonce(nonce, "tenant-replay");
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(409);
  });
});

describe("validateTimestamp", () => {
  it("rejects null timestamp", () => {
    const result = validateTimestamp(null);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });

  it("rejects non-numeric timestamp", () => {
    const result = validateTimestamp("not-a-number");
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });

  it("allows current timestamp", () => {
    const result = validateTimestamp(String(Date.now()));
    expect(result.allowed).toBe(true);
  });

  it("rejects expired timestamp (>120s skew)", () => {
    const old = Date.now() - 200_000;
    const result = validateTimestamp(String(old));
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(401);
  });
});

describe("trackFailedAuth", () => {
  beforeEach(() => {
    clearFailedAuth("lockout-tenant");
  });

  it("returns locked: false for first attempt", () => {
    const result = trackFailedAuth("lockout-tenant");
    expect(result.locked).toBe(false);
    expect(result.attempts).toBe(1);
  });

  it("increments attempts", () => {
    trackFailedAuth("lockout-tenant");
    trackFailedAuth("lockout-tenant");
    const result = trackFailedAuth("lockout-tenant");
    expect(result.attempts).toBe(3);
    expect(result.locked).toBe(false);
  });

  it("locks after 15 attempts", () => {
    for (let i = 0; i < 14; i++) {
      trackFailedAuth("lockout-tenant");
    }
    const result = trackFailedAuth("lockout-tenant");
    expect(result.locked).toBe(true);
    expect(result.attempts).toBe(15);
  });

  it("clears failed auth", () => {
    trackFailedAuth("lockout-tenant");
    trackFailedAuth("lockout-tenant");
    clearFailedAuth("lockout-tenant");
    const result = trackFailedAuth("lockout-tenant");
    expect(result.attempts).toBe(1);
    expect(result.locked).toBe(false);
  });
});

describe("getSecurityHeaders", () => {
  it("returns all required security headers", () => {
    const headers = getSecurityHeaders();
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-XSS-Protection"]).toBe("0");
    expect(headers["Strict-Transport-Security"]).toContain("max-age");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["Cache-Control"]).toContain("no-store");
  });
});

describe("runSecurityChecks", () => {
  it("passes for a normal GET request", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      headers: { authorization: "Bearer test" },
    });
    const result = runSecurityChecks(req);
    expect(result.allowed).toBe(true);
  });

  it("fails for oversized request", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      method: "POST",
      headers: { "content-length": "99999999" },
    });
    const result = runSecurityChecks(req);
    expect(result.allowed).toBe(false);
  });
});

describe("generateRequestId", () => {
  it("returns a 32-char hex string", () => {
    const id = generateRequestId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("generates unique IDs", () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    expect(id1).not.toBe(id2);
  });
});
