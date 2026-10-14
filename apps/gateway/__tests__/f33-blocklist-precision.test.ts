// Implements: F-33 (regex blocklist false positives) + 10_Security.md §11.
// The four removed patterns each rejected legitimate tutor input; the
// remaining patterns must still catch genuine attacks. Surviving-pattern
// coverage for UNION/OR/DROP and <script>/<img> already exists in
// security.test.ts — this file pins ONLY the F-33 delta in both directions.
import { describe, expect, it } from "vitest";
import { validateRequestBody, validateUrl } from "../lib/security.ts";

function urlWithNote(note: string): Request {
  return new Request(
    `https://example.com/api/v1/students?note=${encodeURIComponent(note)}`,
    { method: "GET" },
  );
}

describe("F-33 — legitimate inputs the removed patterns rejected now pass (body)", () => {
  it("allows 'char (' prose (removed /CHAR\\s*\\(/)", () => {
    const body = JSON.stringify({ note: "Main char (Aarav) needs a costume" });
    expect(validateRequestBody(body).allowed).toBe(true);
  });

  it("allows hexadecimal text (removed /0x[0-9a-f]+/)", () => {
    const body = JSON.stringify({ note: "Revise 0xFF hex conversions" });
    expect(validateRequestBody(body).allowed).toBe(true);
  });

  it("allows day/item prose before '=' (removed /on\\w+\\s*=/)", () => {
    const body = JSON.stringify({ note: "Monday = holiday, class moved to Tuesday" });
    expect(validateRequestBody(body).allowed).toBe(true);
  });

  it("allows 'url (' prose (removed /url\\s*\\(/)", () => {
    const body = JSON.stringify({
      note: "share the receipt url (drive link) with the parent",
    });
    expect(validateRequestBody(body).allowed).toBe(true);
  });
});

describe("F-33 — the same legitimate inputs pass as query params", () => {
  it("allows day/item prose before '=' in a query value", () => {
    expect(validateUrl(urlWithNote("Monday = holiday, class moved to Tuesday")).allowed).toBe(
      true,
    );
  });

  it("allows 'url (' prose in a query value", () => {
    expect(
      validateUrl(urlWithNote("share the receipt url (drive link) with the parent")).allowed,
    ).toBe(true);
  });
});

describe("F-33 — genuine attacks are still rejected", () => {
  it("rejects UNION SELECT in the body", () => {
    expect(validateRequestBody("1 UNION SELECT * FROM students").allowed).toBe(false);
  });

  it("rejects <script> in the body", () => {
    expect(validateRequestBody("<script>alert(1)</script>").allowed).toBe(false);
  });

  it("rejects UNION SELECT in a query value", () => {
    const req = new Request(
      `https://example.com/api/v1/students?search=${encodeURIComponent("1 UNION SELECT * FROM students")}`,
    );
    const result = validateUrl(req);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });

  it("rejects <script> in a query value", () => {
    const req = new Request(
      `https://example.com/api/v1/students?name=${encodeURIComponent("<script>alert(1)</script>")}`,
    );
    const result = validateUrl(req);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });
});
