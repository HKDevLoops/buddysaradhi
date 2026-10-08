// Implements: 12_Business_Rules.md BR-CALC-06; 06_Attendance.md §9.7, §10.2,
// §10.5; 14_Edge_Cases.md EC-A-04; 13_UI_Guidelines.md BR-CALC-07.
//
// WHY THIS FILE EXISTS SEPARATELY. `attendance-bulk-summary.test.ts` already
// asserts `attendancePct({present:0,late:0,absent:0}) === null` — the ARITHMETIC
// half of BR-CALC-06. The DISPLAY half had no test at all: `pctText` was a
// private function inside `attendance-summary.tsx`, so the rule a tutor actually
// reads ("an unmeasurable period shows —, never 0%") lived in a component, where
// only a Playwright run could reach it. `attendancePctText` moved to the same
// module as the arithmetic, so both halves are pinned here.
//
// WHICH BUGS THESE WOULD HAVE CAUGHT:
//   * `pctText` returning `pct === null ? "0%" : …`, or the caller passing a
//     defaulted `0`, so a month with NO records told the tutor their students
//     attended nothing — a fabricated accusation about their own books, on the
//     one screen whose job is to be true about their books.
//   * a `NaN` reaching the panel (denominator arithmetic moved without the
//     null guard), which printed the literal string "NaN%" in a table cell.
//   * `excused` being counted in the denominator, which lowers a percentage for a
//     medical leave — BR-ATT-02 excludes it.
//   * `late` being counted as an absence, which lowers a percentage for a student
//     who was there five minutes late.
import { describe, expect, it } from "vitest";
import { attendancePct, attendancePctText } from "./attendance-calc";

describe("BR-CALC-06 — a period with nothing to measure is null, then an em dash", () => {
  it("returns null (never 0) for a zero denominator", () => {
    // The distinction the whole rule exists for: `0` means "every session was an
    // absence", `null` means "there were no sessions". Only the second is true
    // of an empty period, and only the second may reach the screen.
    expect(attendancePct({ present: 0, late: 0, absent: 0 })).toBeNull();
    expect(attendancePct({ present: 0, late: 0, absent: 0 })).not.toBe(0);
  });

  it("renders null as an em dash and never as 0% or NaN%", () => {
    // THE regression. Every assertion here is about a string the tutor reads.
    const shown = attendancePctText(attendancePct({ present: 0, late: 0, absent: 0 }));
    expect(shown).toBe("—");
    expect(shown).not.toContain("0");
    expect(shown).not.toContain("NaN");
    // And the arithmetic cannot leak a NaN for any non-negative count triple.
    for (let p = 0; p <= 3; p += 1) {
      for (let l = 0; l <= 3; l += 1) {
        for (let a = 0; a <= 3; a += 1) {
          const pct = attendancePct({ present: p, late: l, absent: a });
          const text = attendancePctText(pct);
          expect(text, `p${p} l${l} a${a}`).not.toContain("NaN");
          expect(text, `p${p} l${l} a${a}`).toMatch(/^(—|\d{1,3}%)$/);
        }
      }
    }
  });

  it("collapses a non-finite percentage to the dash instead of throwing in a render", () => {
    // A cosmetic defect must not be able to take the screen down: that is what
    // the unparseable period bound did (date-fns RangeError → error.tsx), so the
    // display helper is total.
    expect(attendancePctText(Number.NaN)).toBe("—");
    expect(attendancePctText(Number.POSITIVE_INFINITY)).toBe("—");
    expect(attendancePctText(Number.NEGATIVE_INFINITY)).toBe("—");
  });

  it("rounds to a whole percent, and 100% for a fully attended run", () => {
    expect(attendancePct({ present: 2, late: 1, absent: 0 })).toBe(100);
    expect(attendancePct({ present: 1, late: 0, absent: 2 })).toBe(33);
    expect(attendancePctText(33)).toBe("33%");
    expect(attendancePctText(100)).toBe("100%");
  });
});

describe("BR-CALC-06 — late is attended, excused is out of the denominator", () => {
  it("counts late toward the numerator (BR-ATT-02 / §10.5)", () => {
    // Five sessions, one of them late, nobody absent → 100%, not 80%.
    expect(attendancePct({ present: 4, late: 1, absent: 0 })).toBe(100);
  });

  it("never counts excused, because the caller cannot pass it (BR-ATT-02)", () => {
    // `attendancePct`'s signature has no `excused` field at all, which is how the
    // exclusion is enforced: a medical leave cannot be added to the denominator
    // by a caller that does not have a slot for it. Asserted here so widening
    // the signature is a deliberate, visible act.
    const eightPresentOneExcused = attendancePct({ present: 8, late: 0, absent: 0 });
    expect(eightPresentOneExcused).toBe(100);
    expect(attendancePctText(eightPresentOneExcused)).toBe("100%");
    expect("excused" in { present: 0, late: 0, absent: 0 }).toBe(false);
  });

  it("keeps a genuine all-absent run at 0%, which is a DIFFERENT claim", () => {
    // The mirror image of the dash: when there IS something to measure and the
    // student missed all of it, 0% is the honest number and must NOT be swept
    // into the em dash. A "fix" that made every 0 read as — would be as wrong
    // as the bug this file exists to catch.
    const missed = attendancePct({ present: 0, late: 0, absent: 4 });
    expect(missed).toBe(0);
    expect(attendancePctText(missed)).toBe("0%");
  });
});
