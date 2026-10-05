// Implements: 07_Fees_and_Payments.md §6.2 (per-student balance list) + §6.4
// (Record Payment is entered for ONE named student) + 12_Business_Rules.md
// BR-CALC-01/BR-M-01 (balances are DERIVED, integer paise); 05_Students.md §6
// (roster status vocabulary); AGENTS.md §2 Rule 6 (paise helpers only) and
// Rule 10 (colour is never the only signal).
//
// ONE vocabulary for "what this student owes", read from the one field every
// money surface already reads: `balance_due` (paise; positive = the student owes,
// negative = the institute holds a credit).
//
// Deletion test: delete this file and the Due / Credit / No-dues decision — plus
// the "what is safe to do next" reasoning behind it — reappears inline in the
// master list, the fees roster, and the pending-dues list, and drifts (it already
// had: the pending list called every owing student "Unpaid", a different claim
// about the same number). This is that complexity, concentrated.
//
// Invariants callers must not re-implement:
//   1. Three states, from the sign of `balance_due`. Positive is "Due" — NOT
//      "Unpaid", because a half-paid student is not unpaid and the word would
//      change what the tutor does next.
//   2. `Partial` is deliberately NOT here. It is a fact about invoices, not about
//      a balance, and no balance-only payload can support it. A surface that has
//      invoice rows should say "Partial" there; it must not guess it here.
//   3. The credit amount is computed with `paiseSub(0, n)` — never `Math.abs`, so
//      the money path stays on the paise helpers (Rule 6).
//   4. `BalanceLegend` is the ONE place the three words are taught. The chip says
//      "Credit" and a `title` says "held on account against future fees", which a
//      tutor never reads and a screen reader reads as one flat string. A tutor
//      who does not know that "Credit" is money already received reads it as a
//      discount or a rounding error, and under-collects for months. The legend
//      sits with the classifier so the words and the states cannot drift apart.

import { AlertCircle, CheckCircle2, type LucideIcon } from "lucide-react";
import { formatINR, paiseSub } from "@buddysaradhi/shared";
import { Explain } from "@/components/ui/explain";

export type BalanceStatus = "due" | "credit" | "none";

/** The one classifier. The sign of the paise balance is the only input. */
export function balanceStatusOf(balanceDuePaise: number): BalanceStatus {
  if (balanceDuePaise > 0) return "due";
  if (balanceDuePaise < 0) return "credit";
  return "none";
}

/** The stated amount, always positive, always via a paise helper. */
export function amountStatedPaise(balanceDuePaise: number): number {
  return balanceStatusOf(balanceDuePaise) === "credit"
    ? paiseSub(0, balanceDuePaise)
    : balanceDuePaise;
}

interface StatusCopy {
  label: string;
  /** What the state means, and what to do next, in the tutor's terms. */
  meaning: string;
  chip: string;
  Icon: LucideIcon;
}

const COPY: Record<BalanceStatus, StatusCopy> = {
  due: {
    label: "Due",
    meaning: "outstanding — record a payment to settle it",
    chip: "chip-warning",
    Icon: AlertCircle,
  },
  credit: {
    label: "Credit",
    meaning: "held on account against future fees",
    chip: "chip-info",
    Icon: CheckCircle2,
  },
  none: {
    label: "No dues",
    meaning: "nothing outstanding",
    chip: "chip-success",
    Icon: CheckCircle2,
  },
};

/** The chip's accessible description, so the state is never carried by colour. */
export function balanceStatusTitle(balanceDuePaise: number): string {
  const status = balanceStatusOf(balanceDuePaise);
  const copy = COPY[status];
  return status === "none"
    ? copy.meaning
    : `${copy.label} ${formatINR(amountStatedPaise(balanceDuePaise))} — ${copy.meaning}`;
}

export interface BalanceStatusChipProps {
  balanceDuePaise: number;
  className?: string;
}

/**
 * The status chip. An icon AND a word carry the meaning; colour is the fastest
 * read, never the only one (AGENTS.md §2 Rule 10, no colour-only status).
 */
export function BalanceStatusChip({ balanceDuePaise, className }: BalanceStatusChipProps) {
  const status = balanceStatusOf(balanceDuePaise);
  const copy = COPY[status];
  const Icon = copy.Icon;
  const suffix = status === "none" ? "" : ` ${formatINR(amountStatedPaise(balanceDuePaise))}`;
  return (
    <span
      className={`chip ${copy.chip} num shrink-0 text-[11px] px-2 py-1${className ? ` ${className}` : ""}`}
      title={balanceStatusTitle(balanceDuePaise)}
    >
      <Icon className="w-3 h-3" aria-hidden="true" />
      {copy.label}
      {suffix}
    </span>
  );
}

/**
 * The vocabulary, taught ONCE next to a chip that uses it. Mounted once per
 * roster, not once per row: a disclosure repeated down a 40-row list is a wall
 * of identical triggers, which is a different way of saying nothing.
 */
export function BalanceLegend({ className }: { className?: string }) {
  return (
    <div
      className={`flex flex-col items-start gap-0.5${className ? ` ${className}` : ""}`}
    >
      <p className="text-xs leading-snug" style={{ color: "var(--text-muted)" }}>
        <span style={{ color: "var(--text-secondary)" }}>Due</span> = money owed ·{" "}
        <span style={{ color: "var(--text-secondary)" }}>No dues</span> = settled ·{" "}
        <span style={{ color: "var(--text-secondary)" }}>Credit</span> = paid in advance
      </p>
      <Explain concept="credit-balance" trigger="What does Credit mean?" />
    </div>
  );
}