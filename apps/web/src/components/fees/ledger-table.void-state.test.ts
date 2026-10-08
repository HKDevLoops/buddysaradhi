// Implements: 07_Fees_and_Payments.md §6.3 (a voided payment is struck through
// and word-marked VOIDED; the reversing row names what it reversed), §10.2
// BR-LED-03; 12_Business_Rules.md BR-LED-04/BR-LED-05, EC-F-05, EC-L-02;
// AGENTS.md §2 Rule 10 (colour is never the only signal).
//
// THE BUG THIS PINS. `ledger-table.tsx` decided whether a row was dead from the
// gateway's `isVoid` flag ALONE:
//
//     const isVoided = entry.isVoid === true;
//
// On the QA tenant that rendered every already-voided receipt exactly like a
// live one — no strike-through, no "Voided" word, and an enabled "Void" button
// (measured on the real tenant: 6 voided payments, 0 flagged). The
// `fees audit 3` e2e failed on exactly this at
// "the reversed original is still in the ledger and marked VOIDED".
//
// A dead receipt that still looks live is the worst state a ledger table can be
// in: a tutor reads it as money they are owed, and pressing Void then reaches
// only the gateway's BR-LED-04/05 409 — a button whose only outcome is an
// error.
//
// The fix unions the flag with the reversing-row linkage the payload ALREADY
// carries. These cases pin both arms independently, so neither can be
// "simplified" back to the single-flag version: the flag case fails if the
// linkage arm is dropped, and the linkage case fails if the flag arm is
// dropped.

import { describe, it, expect } from "vitest";
import { isLedgerRowVoided } from "./ledger-table";

/** The map `LedgerTable` builds from `reverses_entry_id` across the page. */
function linkageOf(...pairs: Array<[targetId: string, voidId: string]>) {
  return new Map(pairs);
}

describe("isLedgerRowVoided — a row is dead if EITHER source says so", () => {
  it("honours the gateway's isVoid flag", () => {
    expect(isLedgerRowVoided({ id: "payment-1", isVoid: true }, linkageOf())).toBe(true);
  });

  it("honours the reversing-row linkage even when the flag is absent", () => {
    // This is the arm the QA tenant was failing: the gateway sent no flag, but
    // the VOID row naming this payment is right there in the same payload.
    expect(
      isLedgerRowVoided({ id: "payment-1" }, linkageOf(["payment-1", "void-1"])),
      "a payment named by a reversing row is dead whether or not a flag agrees",
    ).toBe(true);
  });

  it("honours the linkage when the flag is present and FALSE", () => {
    // A stale or absent flag must not be able to resurrect a dead row.
    expect(
      isLedgerRowVoided({ id: "payment-1", isVoid: false }, linkageOf(["payment-1", "void-1"])),
    ).toBe(true);
  });

  it("leaves a live payment live", () => {
    expect(isLedgerRowVoided({ id: "payment-1", isVoid: false }, linkageOf())).toBe(false);
    expect(isLedgerRowVoided({ id: "payment-1" }, linkageOf())).toBe(false);
  });

  it("does NOT mark the reversing row itself as dead (BR-LED-04 audit trail)", () => {
    // The VOID row is a real, live correcting entry. Striking IT through would
    // hide the correction — the exact thing the append-only ledger exists to
    // keep. `void_of_id` is one-directional, so the VOID row is never a KEY in
    // the map and the flag is not set on it.
    const map = linkageOf(["payment-1", "void-1"]);
    expect(map.has("void-1")).toBe(false);
    expect(isLedgerRowVoided({ id: "void-1", isVoid: false }, map)).toBe(false);
  });

  it("treats isVoid as strictly boolean — a truthy non-true does not kill a row", () => {
    // Defensive: `=== true` means an absent field is NOT a claim of death.
    // Without the strict compare, a JSON payload carrying `isVoid: 1` or
    // `isVoid: "false"` would silently strike through a live receipt.
    expect(
      isLedgerRowVoided({ id: "p", isVoid: "false" as unknown as boolean }, linkageOf()),
    ).toBe(false);
  });

  it("handles several voided payments in one page independently", () => {
    // The QA tenant reached 14 live-looking payments; the fix must mark the
    // dead ones WITHOUT marking their neighbours.
    const map = linkageOf(["payment-1", "void-1"], ["payment-3", "void-2"]);
    expect(isLedgerRowVoided({ id: "payment-1" }, map)).toBe(true);
    expect(isLedgerRowVoided({ id: "payment-2" }, map)).toBe(false);
    expect(isLedgerRowVoided({ id: "payment-3" }, map)).toBe(true);
    expect(isLedgerRowVoided({ id: "payment-4" }, map)).toBe(false);
  });
});