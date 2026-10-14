// Implements: docs/rfc/004-multi-device-network-contract.md C1 (one client-minted
// intent key per mutate, forwarded to the server guard) + K1 (double-click and
// mid-flight retry collapse to one effect); AGENTS.md §2 Rule 7 + Rule 9.
//
// WHY THIS FILE IS A SOURCE GUARD AND NOT A COMPONENT TEST. The behaviour it
// pins is "the sheet mints ONE key per submit attempt and hands THAT key to
// `recordPaymentAction`", and the natural home for it is
// `record-payment-sheet.test.tsx`. That file cannot run in the current
// dependency tree — zustand resolves its OWN nested copy of React, so
// `useFeesStore()` throws "Invalid hook call" before any assertion is reached,
// on `main` as well as on this branch (verified by stashing this feature and
// re-running: 6/6 fail identically). A pin that cannot execute guards nothing,
// so the wiring is asserted here against the file's text until that tree is
// fixed; the DEEP contract (one payment, one receipt, one balance change) is
// proven for real, against a real database, in `fees-payment-idempotency.test.ts`.
//
// The three things that must never come back:
//   1. the sheet posts through `useConfirmedMutation`, not a bare `useMutation`
//      (TanStack Query does not dedupe mutations — K1 needs the key);
//   2. the hook's `intentKey` is forwarded to `recordPaymentAction`
//      (a key the server never sees is not a key);
//   3. `handleSubmit` refuses to fire while a submit is in flight (Enter in a
//      text field submits a form whose button is disabled).

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SHEET_PATH = join(__dirname, "record-payment-sheet.tsx");
const source = readFileSync(SHEET_PATH, "utf8");

describe("RecordPaymentSheet — the RFC-004 C1 intent key cannot be unwired", () => {
  it("posts through useConfirmedMutation, not a bare useMutation", () => {
    expect(source).toMatch(/useConfirmedMutation\s*[(<]/);
    // Called nowhere (the word may appear in prose explaining why it was
    // replaced — a call is what matters).
    expect(source).not.toMatch(/useMutation\s*[(<]/);
  });

  it("forwards the hook's intentKey into recordPaymentAction", () => {
    // The exact forwarding shape the server guard reads
    // (`RecordPaymentOptions.intentKey`).
    expect(source).toMatch(/intentKey:\s*args\.intentKey/);
  });

  it("guards handleSubmit against a second submit while one is in flight", () => {
    expect(source).toMatch(/if \(confirmed\.isPending\) return;/);
  });

  it("never claims a receipt number on a queued (unwritten) intent", () => {
    // The success toast names a receipt number. A queued intent has none, so
    // that branch must be handled separately and must NOT fall through to the
    // success wording (Rule 9: the toast is not allowed to lie about money).
    expect(source).toMatch(/state === "queued"/);
  });
});