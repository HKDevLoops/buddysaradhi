// Implements: 12_Business_Rules.md BR-CALC-09/10/11 (pure calc layer of 02_Core_Logic.md
// §6.9.3, 11_Data_Model.md §15.4, 07_Fees_and_Payments.md §6.2 period toggle).
// Principle: P4 (money exactness). Rules: Rule 6 (integer paise, sums/subtractions
// only — no division, no rounding), Rule 9 (Zod-parse every input, typed throws).
//
// Scope: pure functions only — no Prisma/DB access. Callers fetch rows via Prisma
// ORM (see 11_Data_Model.md §15.4 sketches) and pass them in; every figure returned
// is integer paise. Quarterly/annual are always derived from monthly (BR-FEE-20);
// months are atomic billing units, so any paused day inside a month zeroes it.
import { z } from "zod";
import { paiseAdd, paiseSub } from "./utils/format";

// ── Input shapes (mirror 11_Data_Model.md DDL names; snake_case like schemas/) ──

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected ISO date YYYY-MM-DD")
  .refine(
    (s) => {
      const year = Number(s.slice(0, 4));
      const month = Number(s.slice(5, 7));
      const day = Number(s.slice(8, 10));
      if (month < 1 || month > 12 || day < 1 || day > 31) return false;
      const roundTrip = new Date(Date.UTC(year, month - 1, day));
      return (
        roundTrip.getUTCFullYear() === year &&
        roundTrip.getUTCMonth() === month - 1 &&
        roundTrip.getUTCDate() === day
      );
    },
    { message: "not a real calendar date" },
  );

const MonthKeySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "expected month key YYYY-MM");

export const FeeRateRowSchema = z.object({
  student_id: z.string().uuid(),
  monthly_fee_paise: z.number().int().nonnegative(),
  effective_from: IsoDateSchema,
  // NULL = current (open) rate; set to day-before-next when superseded (BR-FEE-21).
  effective_to: IsoDateSchema.nullable(),
});

export const EnrolmentStatusSchema = z.enum(["active", "paused", "inactive"]);

export const PausedPeriodSchema = z
  .object({ from: IsoDateSchema, to: IsoDateSchema })
  .refine((p) => p.from <= p.to, { message: "paused period from must be <= to" });

export const EnrolmentRowSchema = z.object({
  student_id: z.string().uuid(),
  status: EnrolmentStatusSchema,
  enrolled_from: IsoDateSchema,
  paused_periods: z.array(PausedPeriodSchema).default([]),
});

// Mirrors ledger_entries.type CHECK (11_Data_Model.md §4.13).
export const FeeLedgerTypeSchema = z.enum([
  "FEE_CHARGED",
  "PAYMENT_RECEIVED",
  "DISCOUNT_GRANTED",
  "REFUND_ISSUED",
  "ADJUSTMENT",
  "WRITEOFF",
  "VOID",
]);

export const FeeLedgerRowSchema = z
  .object({
    student_id: z.string().uuid(),
    type: FeeLedgerTypeSchema,
    debit_paise: z.number().int().nonnegative(),
    credit_paise: z.number().int().nonnegative(),
    occurred_on: IsoDateSchema,
    // Prescribed void flag. NOTE (spec gap G2): ledger_entries DDL has no
    // voided_at column — canonical void state is type='VOID' + void_of_id
    // (11_Data_Model.md §4.13). Callers MUST project a voided original
    // (pointed to by a VOID row's void_of_id) with voided_at set, otherwise
    // the voided original still counts. type='VOID' rows are always excluded.
    voided_at: z.string().nullable().optional(),
  })
  .refine((r) => !(r.debit_paise > 0 && r.credit_paise > 0), {
    message: "debit_paise/credit_paise are mutually exclusive (DDL CHECK)",
  });

export const FeePeriodSchema = z
  .object({ from: MonthKeySchema, to: MonthKeySchema })
  .refine((p) => p.from <= p.to, { message: "period from must be <= to" });

export const FeeQuarterSchema = z.number().int().min(1).max(4);
export const FeeYearSchema = z.number().int().min(1).max(9999);

export type FeeRateRow = z.infer<typeof FeeRateRowSchema>;
export type EnrolmentRow = z.infer<typeof EnrolmentRowSchema>;
export type FeeLedgerRow = z.infer<typeof FeeLedgerRowSchema>;
export type FeePeriod = z.infer<typeof FeePeriodSchema>;

// ── Calendar helpers (integer calendar math only — never money) ──

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function monthEndDay(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

function padMonth(month: number): string {
  return month < 10 ? `0${month}` : `${month}`;
}

/** Inclusive month-key enumeration, e.g. 2025-01..2025-03 → 3 keys (BR-CALC-09). */
export function monthKeysInPeriod(period: FeePeriod): string[] {
  const parsed = FeePeriodSchema.parse(period);
  const keys: string[] = [];
  let year = Number(parsed.from.slice(0, 4));
  let month = Number(parsed.from.slice(5, 7));
  const endYear = Number(parsed.to.slice(0, 4));
  const endMonth = Number(parsed.to.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    keys.push(`${year}-${padMonth(month)}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return keys;
}

function monthBounds(monthKey: string): { first: string; last: string } {
  const parsed = MonthKeySchema.parse(monthKey);
  const year = Number(parsed.slice(0, 4));
  const month = Number(parsed.slice(5, 7));
  return { first: `${parsed}-01`, last: `${parsed}-${monthEndDay(year, month)}` };
}

/** Rate effective on month-1st; latest effective_from wins if rows overlap (BR-FEE-21). */
export function rateOn(
  rates: FeeRateRow[],
  studentId: string,
  monthFirst: string,
): FeeRateRow | null {
  const parsedRates = z.array(FeeRateRowSchema).parse(rates);
  const first = IsoDateSchema.parse(monthFirst);
  const id = z.string().uuid().parse(studentId);
  let best: FeeRateRow | null = null;
  for (const row of parsedRates) {
    if (row.student_id !== id) continue;
    if (row.effective_from > first) continue;
    if (row.effective_to !== null && first > row.effective_to) continue;
    if (best === null || row.effective_from > best.effective_from) best = row;
  }
  return best;
}

/**
 * Per-month enrolment gate (BR-FEE-23, BR-CALC-09). A month contributes 0 when the
 * student is inactive, paused (any paused day inside the month zeroes the atomic
 * month), or not-yet-enrolled. No enrolment row at all = not enrolled = false.
 * status='paused' with no paused_periods = currently paused = false for the month.
 */
export function isEnrolmentActiveForMonth(
  enrolments: EnrolmentRow[],
  studentId: string,
  monthKey: string,
): boolean {
  const parsed = z.array(EnrolmentRowSchema).parse(enrolments);
  const id = z.string().uuid().parse(studentId);
  const { first, last } = monthBounds(monthKey);
  const row = parsed.find((e) => e.student_id === id);
  if (row === undefined) return false;
  if (row.status === "inactive") return false;
  if (first < row.enrolled_from) return false;
  for (const paused of row.paused_periods) {
    if (paused.from <= last && first <= paused.to) return false;
  }
  if (row.status === "paused" && row.paused_periods.length === 0) return false;
  return true;
}

function isVoided(entry: FeeLedgerRow): boolean {
  if (entry.type === "VOID") return true;
  return entry.voided_at !== null && entry.voided_at !== undefined;
}

// ── EXPECTED (BR-CALC-09) ──

export function expectedForMonth(
  rates: FeeRateRow[],
  enrolments: EnrolmentRow[],
  studentId: string,
  month: string,
): number {
  const key = MonthKeySchema.parse(month);
  const id = z.string().uuid().parse(studentId);
  if (!isEnrolmentActiveForMonth(enrolments, id, key)) return 0;
  const rate = rateOn(rates, id, `${key}-01`);
  // No rate effective that month → 0 (spec gap G4: BR-FEE-20 says null; number
  // contract keeps 0 per BR-CALC-09 "contributes 0" + §15.4 sketch).
  if (rate === null) return 0;
  return rate.monthly_fee_paise;
}

export function expectedForPeriod(
  rates: FeeRateRow[],
  enrolments: EnrolmentRow[],
  studentId: string,
  period: FeePeriod,
): number {
  const parsed = FeePeriodSchema.parse(period);
  const id = z.string().uuid().parse(studentId);
  let total = 0;
  for (const key of monthKeysInPeriod(parsed)) {
    total = paiseAdd(total, expectedForMonth(rates, enrolments, id, key));
  }
  return total;
}

export function expectedForQuarter(
  rates: FeeRateRow[],
  enrolments: EnrolmentRow[],
  studentId: string,
  year: number,
  quarter: number,
): number {
  const y = FeeYearSchema.parse(year);
  const q = FeeQuarterSchema.parse(quarter);
  const startMonth = (q - 1) * 3 + 1;
  return expectedForPeriod(rates, enrolments, studentId, {
    from: `${y}-${padMonth(startMonth)}`,
    to: `${y}-${padMonth(startMonth + 2)}`,
  });
}

export function expectedForYear(
  rates: FeeRateRow[],
  enrolments: EnrolmentRow[],
  studentId: string,
  year: number,
): number {
  const y = FeeYearSchema.parse(year);
  return expectedForPeriod(rates, enrolments, studentId, {
    from: `${y}-01`,
    to: `${y}-12`,
  });
}

// ── COLLECTED (BR-CALC-10) ──

export function collectedForPeriod(
  entries: FeeLedgerRow[],
  studentId: string,
  from: string,
  to: string,
): number {
  const parsed = z.array(FeeLedgerRowSchema).parse(entries);
  const id = z.string().uuid().parse(studentId);
  const fromDate = IsoDateSchema.parse(from);
  const toDate = IsoDateSchema.parse(to);
  if (fromDate > toDate) throw new Error("collectedForPeriod: from must be <= to");
  let credits = 0;
  let refunds = 0;
  for (const entry of parsed) {
    if (entry.student_id !== id) continue;
    if (isVoided(entry)) continue;
    if (entry.occurred_on < fromDate || entry.occurred_on > toDate) continue;
    if (entry.type === "PAYMENT_RECEIVED") credits = paiseAdd(credits, entry.credit_paise);
    if (entry.type === "REFUND_ISSUED") refunds = paiseAdd(refunds, entry.debit_paise);
  }
  return paiseSub(credits, refunds);
}

function quarterDateRange(year: number, quarter: number): { from: string; to: string } {
  const y = FeeYearSchema.parse(year);
  const q = FeeQuarterSchema.parse(quarter);
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  return {
    from: `${y}-${padMonth(startMonth)}-01`,
    to: `${y}-${padMonth(endMonth)}-${monthEndDay(y, endMonth)}`,
  };
}

export function collectedForMonth(
  entries: FeeLedgerRow[],
  studentId: string,
  month: string,
): number {
  const { first, last } = monthBounds(month);
  return collectedForPeriod(entries, studentId, first, last);
}

export function collectedForQuarter(
  entries: FeeLedgerRow[],
  studentId: string,
  year: number,
  quarter: number,
): number {
  const range = quarterDateRange(year, quarter);
  return collectedForPeriod(entries, studentId, range.from, range.to);
}

export function collectedForYear(
  entries: FeeLedgerRow[],
  studentId: string,
  year: number,
): number {
  const y = FeeYearSchema.parse(year);
  return collectedForPeriod(entries, studentId, `${y}-01-01`, `${y}-12-31`);
}

// ── ARREARS (BR-CALC-11) — NEVER clamped; negative = advance (BR-M-04) ──

export function arrearsForPeriod(
  rates: FeeRateRow[],
  enrolments: EnrolmentRow[],
  entries: FeeLedgerRow[],
  studentId: string,
  period: FeePeriod,
): number {
  const parsed = FeePeriodSchema.parse(period);
  const id = z.string().uuid().parse(studentId);
  const ledger = z.array(FeeLedgerRowSchema).parse(entries);
  const expected = expectedForPeriod(rates, enrolments, id, parsed);
  const rangeFrom = `${parsed.from}-01`;
  const endBounds = monthBounds(parsed.to);
  const collected = collectedForPeriod(ledger, id, rangeFrom, endBounds.last);
  let discounts = 0;
  for (const entry of ledger) {
    if (entry.student_id !== id) continue;
    if (isVoided(entry)) continue;
    if (entry.occurred_on < rangeFrom || entry.occurred_on > endBounds.last) continue;
    if (entry.type === "DISCOUNT_GRANTED") discounts = paiseAdd(discounts, entry.credit_paise);
  }
  return paiseSub(paiseSub(expected, collected), discounts);
}

export function arrearsForMonth(
  rates: FeeRateRow[],
  enrolments: EnrolmentRow[],
  entries: FeeLedgerRow[],
  studentId: string,
  month: string,
): number {
  const key = MonthKeySchema.parse(month);
  return arrearsForPeriod(rates, enrolments, entries, studentId, { from: key, to: key });
}

export function arrearsForQuarter(
  rates: FeeRateRow[],
  enrolments: EnrolmentRow[],
  entries: FeeLedgerRow[],
  studentId: string,
  year: number,
  quarter: number,
): number {
  const y = FeeYearSchema.parse(year);
  const q = FeeQuarterSchema.parse(quarter);
  const startMonth = (q - 1) * 3 + 1;
  return arrearsForPeriod(rates, enrolments, entries, studentId, {
    from: `${y}-${padMonth(startMonth)}`,
    to: `${y}-${padMonth(startMonth + 2)}`,
  });
}

export function arrearsForYear(
  rates: FeeRateRow[],
  enrolments: EnrolmentRow[],
  entries: FeeLedgerRow[],
  studentId: string,
  year: number,
): number {
  const y = FeeYearSchema.parse(year);
  return arrearsForPeriod(rates, enrolments, entries, studentId, {
    from: `${y}-01`,
    to: `${y}-12`,
  });
}
