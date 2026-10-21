// Implements: the perf gates' measuring contract (docs/audit/REMEDIATION-PLAN-2026-10-21.md
// row 3.7 - "the perf-budget gates measure the machine").
//
// WHY A STICK. An absolute millisecond budget measures the runner, not the
// code: the same test produced 12.4 ms, 6.3 ms and 8.4 ms against a 2 ms
// budget on three runners, and a real 10x regression on a quiet machine still
// fitted under the budget. So every budget in the gateway's perf suites is
// expressed in UNITS OF THIS STICK, and the stick's cost is measured in the
// SAME run, interleaved with the candidate.
//
// WHY THE STICK IS MEMORY-BOUND. An ALU-only stick does not degrade when the
// machine is loaded, while the operations under test (a URL parse, a JSON
// encode, a cache lookup) do. Normalising by an ALU stick therefore INFLATED
// the ratio on a loaded runner - measured 101 on a quiet run and 1019 on a
// loaded one, because the denominator held still while the numerator sagged.
// A stick that touches memory the way the candidates do degrades with them,
// and the ratio holds: the spread between runs fell from 10x to 1.2x-2.3x.
//
// WHY THE FASTEST BATCH. A batch is only ever SLOWER than the code's true
// cost - the machine interferes, it never helps - so the fastest batch is the
// closest estimate of the cost itself.
//
// WHY ABBA. The stick and the candidate are timed as stick, candidate,
// candidate, stick, so the two share the same time window and a CPU frequency
// ramp moves both sides together.

/** Operations in one stick call. Sized so a batch is long enough to time. */
const STICK_OPS = 64;

/** Operations per timed batch - large enough to amortise a preemption. */
export const BATCH = 200;

/** Timed batches, excluding the discarded warm-up. */
export const BATCHES = 20;

const STICK_KEYS = ["a", "b", "c", "d", "e", "f", "g", "h"];
const STICK_MAP = new Map(STICK_KEYS.map((k, i) => [k, i]));

/**
 * The sink. Exported so it is visibly USED (an unused local would be
 * deleted, and with it the work the stick is supposed to measure) and so
 * the optimiser cannot eliminate the loop.
 */
export let stickSink = 0;

export function stick(): void {
  let acc = 0;
  for (let i = 0; i < STICK_OPS; i++) {
    acc = (acc + (STICK_MAP.get(STICK_KEYS[i & 7] as string) ?? 0)) | 0;
  }
  stickSink = acc;
}

/** The stick's own cost, per call. */
export function fastestStickPerOp(): number {
  return fastestPerOp(stick);
}

/**
 * The FASTEST batch's per-op cost - the same estimator `costInStickUnits`
 * uses, and for the same reason: a batch is only ever slower than the code's
 * true cost, so the fastest batch is the closest estimate of it.
 */
export function fastestPerOp(op: () => void): number {
  const samples: number[] = [];
  for (let batch = 0; batch < BATCHES + 1; batch++) {
    const start = performance.now();
    for (let i = 0; i < BATCH; i++) op();
    const elapsed = performance.now() - start;
    if (batch > 0) samples.push(elapsed / BATCH);
  }
  return Math.min(...samples);
}

/**
 * The candidate's per-operation cost, in STICK UNITS.
 *
 * The candidate and the stick are timed in INTERLEAVED (ABBA) batches, so a
 * runner that speeds up or slows down mid-run moves both sides together.
 */
export function costInStickUnits(op: () => void): number {
  const candidate: number[] = [];
  const reference: number[] = [];
  for (let batch = 0; batch < BATCHES + 1; batch++) {
    const t0 = performance.now();
    for (let i = 0; i < BATCH; i++) stick();
    const t1 = performance.now();
    for (let i = 0; i < BATCH; i++) op();
    const t2 = performance.now();
    for (let i = 0; i < BATCH; i++) op();
    const t3 = performance.now();
    for (let i = 0; i < BATCH; i++) stick();
    const t4 = performance.now();
    if (batch === 0) continue; // the warm-up batch warms both sides
    reference.push((t1 - t0 + (t4 - t3)) / (2 * BATCH));
    candidate.push((t2 - t1 + (t3 - t2)) / (2 * BATCH));
  }
  const stickCost = Math.min(...reference);
  // A stick that measures as free (a timer with a resolution coarser than the
  // work) would make the ratio infinite. That is a broken measurement, not a
  // fast candidate, so it fails the gate rather than passing it.
  if (stickCost <= 0) return Number.POSITIVE_INFINITY;
  return Math.min(...candidate) / stickCost;
}
