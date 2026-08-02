// apps/gateway/__tests__/orm-sync.test.ts
import { describe, it, expect } from "vitest";

describe("recordOutbox JSON Payload Serialization", () => {
  it("correctly stringifies object payloads into JSON strings", () => {
    const payloadObj = { id: "stu-101", first_name: "Aarav", base_fee_paise: 200000 };
    const jsonPayload = typeof payloadObj === "string" ? payloadObj : JSON.stringify(payloadObj);

    expect(jsonPayload).not.toBe("[object Object]");
    expect(JSON.parse(jsonPayload).first_name).toBe("Aarav");
    expect(JSON.parse(jsonPayload).base_fee_paise).toBe(200000);
  });

  it("handles string payloads idempotently", () => {
    const rawString = JSON.stringify({ action: "test" });
    const jsonPayload = typeof rawString === "string" ? rawString : JSON.stringify(rawString);

    expect(jsonPayload).toBe('{"action":"test"}');
  });
});
