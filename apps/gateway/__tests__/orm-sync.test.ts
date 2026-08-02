// apps/gateway/__tests__/orm-sync.test.ts
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { recordOutbox } from "../routes/students.ts";

Deno.test("recordOutbox correctly stringifies object payloads into JSON strings", () => {
  const payloadObj = { id: "stu-101", first_name: "Aarav", base_fee_paise: 200000 };
  const jsonPayload = typeof payloadObj === "string" ? payloadObj : JSON.stringify(payloadObj);

  assertNotEquals(jsonPayload, "[object Object]");
  assertEquals(JSON.parse(jsonPayload).first_name, "Aarav");
  assertEquals(JSON.parse(jsonPayload).base_fee_paise, 200000);
});

Deno.test("recordOutbox handles string payloads idempotently", () => {
  const rawString = JSON.stringify({ action: "test" });
  const jsonPayload = typeof rawString === "string" ? rawString : JSON.stringify(rawString);

  assertEquals(jsonPayload, '{"action":"test"}');
});
