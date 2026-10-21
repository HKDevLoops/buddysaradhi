// Implements: docs/audit/REMEDIATION-PLAN-2026-10-21.md row 3.7 - the
// perf-budget gates must measure the CODE, and the gate must still catch a
// real regression.
//
// A gate that has never been seen RED is not a gate. The perf budgets are
// ratios against a stick measured in the same run (see `./perf-stick.ts`),
// and a ratio instrument can be broken in two directions:
//
//   - it can be VACUOUS: if the stick measures as free, every ratio is
//     infinite and every budget passes for free;
//   - it can be BLIND: if the ratio does not move when the candidate gets
//     slower, the budget is decoration.
//
// This file is the negative control for both. It is a PERMANENT test, not a
// one-off experiment: it runs in the perf lane (`vitest.perf.config.ts`) and
// in the ordinary suite, and it fails loudly if the instrument ever stops
// being able to tell a fast candidate from a slow one.
//
// THE MANUAL CONTROL. To see the gate itself go RED, make a candidate
// artificially three times slower and run the lane:
//
//   # in apps/gateway/__tests__/low-latency.test.ts, the warm-cache case
//   #   measures `getCached` once per operation. Measuring it THREE times
//   #   per operation is a candidate three times as slow - the same shape as
//   #   a real regression - and it must trip WARM_CACHE_UNITS.
//
//   bunx vitest run --config vitest.perf.config.ts   # RED
//   # restore the file
//   bunx vitest run --config vitest.perf.config.ts   # GREEN

import { describe, expect, it } from "vitest";
import { costInStickUnits, fastestPerOp, stick } from "./perf-stick.ts";

describe("the perf instrument (the negative control for the gate itself)", () => {
  it("measures a stick that is not free", () => {
    // A stick that measures as zero would make every ratio infinite, and
    // every budget would pass without ever being tested.
    expect(fastestPerOp(stick)).toBeGreaterThan(0);
  });

  it("sees a candidate that is three times slower", () => {
    // The same work, done three times over: a candidate three times as
    // expensive, which is the shape of a real regression. The instrument has
    // to notice.
    const cheap = costInStickUnits(() => {
      // one unit of work
      stick();
    });
    const slow = costInStickUnits(() => {
      // the same unit of work, three times over
      stick();
      stick();
      stick();
    });
    expect(slow).toBeGreaterThan(cheap * 2);
  });

  it("keeps the ratio stable when the machine is slow", () => {
    // The whole point of the ratio: the candidate and the stick are timed in
    // the same run, so a slow runner moves both sides together. The
    // instrument measures them interleaved, so the ratio between a candidate
    // and a stick that does the SAME work has to be about one, whatever the
    // machine is doing.
    const units = costInStickUnits(() => {
      stick();
    });
    expect(units).toBeLessThan(3);
    expect(units).toBeGreaterThan(0.2);
  });
});
