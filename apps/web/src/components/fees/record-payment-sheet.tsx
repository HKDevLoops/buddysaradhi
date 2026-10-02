"use client";

// Implements: 07_Fees_and_Payments.md §6.4 (Record Payment Sheet — quick
// amounts, method segmented control, reference, date + backdate warning,
// advance toggle, live receipt preview) + §10.1 BR-M-04 (excess requires
// advance acknowledgement); 12_Business_Rules.md BR-FEE-04/BR-FEE-15
// (exact + ADVANCE split), BR-FEE-05 (paid-in-full tolerance),
// BR-M-01 (integer paise); 02_Core_Logic.md §3.4 (receipt_form state);
// 14_Edge_Cases.md EC-F-02/EC-F-08 (advance chip).
//
// Receipt-before-post: the preview block below is built by the pure
// `payment-contract` builders and the submit posts THE SAME values —
// amount, method, reference, date, description — which the server action
// re-validates with the same Zod schema before any DB call. Nothing is
// re-derived between preview and post. The receipt NUMBER is issued on
// commit (monotonic per BR-RC-01, never reused); the preview says so
// instead of fabricating a number. Attribution follows §9.6 step 5
// (earliest-due-first; surplus auto-invoiced) — stated, not picked.

import { useMemo, useState } from "react";
import { useFeesStore } from "@/stores/fees-store";
import { recordPaymentAction } from "@/server/actions/fees";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Wallet, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { formatINR } from "@buddysaradhi/shared";
import type { getLedgerForStudent } from "@/server/queries/fees";
import type { getStudentsForFees } from "@/server/queries/fees";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  isBackdated,
  paiseSub,
  rupeesStringToPaise,
  splitPaymentPreview,
  validateReferenceForMethod,
  type PaymentMethod,
} from "./payment-contract";

interface RecordPaymentSheetProps {
  studentId: string | null;
  studentName?: string;
  /** Known dues in paise (fees list). Omitted from the drawer — preview then skips balance-after honestly. */
  balanceDuePaise?: number;
}

type LedgerQueryData = Awaited<ReturnType<typeof getLedgerForStudent>>;
type LedgerRow = LedgerQueryData["data"][number];
type FeesStudentsQueryData = Awaited<ReturnType<typeof getStudentsForFees>>;

function todayIso(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function RecordPaymentSheet({ studentId, studentName, balanceDuePaise }: RecordPaymentSheetProps) {
  const { isPaymentSheetOpen, setPaymentSheetOpen } = useFeesStore();
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("Tuition Fee Payment");
  const [dateIso, setDateIso] = useState(todayIso);
  const [advanceAck, setAdvanceAck] = useState(false);
  const [backdatePin, setBackdatePin] = useState("");

  const mutation = useMutation({
    mutationFn: (args: {
      studentIdSafe: string;
      amountPaise: number;
      description: string;
      receivedOn: string;
      method: PaymentMethod;
      reference: string;
      advanceAcknowledged: boolean;
    }) =>
      recordPaymentAction(args.studentIdSafe, args.amountPaise, args.description, args.receivedOn, {
        method: args.method,
        reference: args.reference,
        advanceAcknowledged: args.advanceAcknowledged,
      }),
    onMutate: async (args) => {
      await queryClient.cancelQueries({ queryKey: ["ledger"] });
      await queryClient.cancelQueries({ queryKey: ["fees-students"] });

      const prevLedger = queryClient.getQueryData<LedgerQueryData>(["ledger", studentId]);
      const prevStudents = queryClient.getQueryData<FeesStudentsQueryData>(["fees-students"]);

      // Optimistic row in PAISE (the query rows are paise — formatINR takes
      // paise; the old `/ 100` here mixed rupees into a paise feed).
      queryClient.setQueryData<LedgerQueryData>(["ledger", studentId], (old) => {
        if (!old || old.success === false || !Array.isArray(old.data)) return old;
        const optimistic: LedgerRow = {
          ...(old.data[0] ?? {
            id: "",
            type: "PAYMENT_RECEIVED",
            debit: 0,
            credit: 0,
            occurred_on: args.receivedOn,
            receipt_no: null,
            description: null,
            isVoid: false,
            this_hash: null,
          }),
          id: `temp-${Date.now()}`,
          type: "PAYMENT_RECEIVED",
          debit: 0,
          credit: args.amountPaise,
          occurred_on: args.receivedOn,
          receipt_no: "PENDING",
          description: args.description,
          isVoid: false,
          this_hash: "calculating...",
        };
        return { ...old, data: [optimistic, ...old.data] };
      });

      queryClient.setQueryData<FeesStudentsQueryData>(["fees-students"], (old) => {
        if (!old || old.success === false || !Array.isArray(old.data)) return old;
        return {
          ...old,
          data: old.data.map((s) =>
            s.id === studentId
              ? { ...s, balance_due: paiseSub(s.balance_due, args.amountPaise) }
              : s
          ),
        };
      });

      closeSheet();

      return { prevLedger, prevStudents };
    },
    onError: (_err, _args, context) => {
      const ctx = context as
        | { prevLedger?: LedgerQueryData; prevStudents?: FeesStudentsQueryData }
        | undefined;
      if (ctx?.prevLedger) queryClient.setQueryData(["ledger", studentId], ctx.prevLedger);
      if (ctx?.prevStudents) queryClient.setQueryData(["fees-students"], ctx.prevStudents);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["ledger"] });
      queryClient.invalidateQueries({ queryKey: ["fees-students"] });
    },
  });

  const closeSheet = () => {
    setPaymentSheetOpen(false);
    setAmount("");
    setMethod("cash");
    setReference("");
    setDescription("Tuition Fee Payment");
    setDateIso(todayIso());
    setAdvanceAck(false);
    setBackdatePin("");
  };

  // Live receipt preview — pure, client-side, zero network (free-tier: no
  // per-keystroke remote calls). The submit below posts these exact values.
  const preview = useMemo(() => {
    const amountPaise = amount.trim().length > 0 ? rupeesStringToPaise(amount) : null;
    const refError = validateReferenceForMethod(method, reference);
    const backdated = isBackdated(dateIso, todayIso());
    const balanceKnown =
      typeof balanceDuePaise === "number" && Number.isSafeInteger(balanceDuePaise);
    const split =
      balanceKnown && amountPaise !== null
        ? splitPaymentPreview(balanceDuePaise, amountPaise)
        : null;
    const excess = split !== null && split.isAdvance;
    const errors: string[] = [];
    if (amount.trim().length > 0 && amountPaise === null)
      errors.push("Enter a valid amount (up to 2 decimals, max ₹1,00,00,000)");
    if (refError) errors.push(refError);
    if (backdated && backdatePin.trim().length === 0)
      errors.push("Backdated payments need a fresh PIN");
    if (excess && !advanceAck)
      errors.push("Amount exceeds balance — acknowledge Mark as advance");
    return { amountPaise, refError, backdated, balanceKnown, split, excess, errors };
  }, [amount, method, reference, dateIso, balanceDuePaise, advanceAck, backdatePin]);

  const canSubmit =
    studentId !== null &&
    preview.amountPaise !== null &&
    preview.errors.length === 0 &&
    !mutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentId || preview.amountPaise === null || preview.errors.length > 0) return;
    // Posts EXACTLY what was previewed — no silent recompute.
    mutation.mutate({
      studentIdSafe: studentId,
      amountPaise: preview.amountPaise,
      description: description.trim(),
      receivedOn: dateIso,
      method,
      reference: reference.trim(),
      advanceAcknowledged: advanceAck,
    });
  };

  if (!isPaymentSheetOpen) return null;

  const statusLabel =
    preview.split?.statusAfter === "paid"
      ? "✓ Paid"
      : preview.split?.statusAfter === "partial"
        ? "◐ Partial"
        : "✕ Unpaid";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[#0C081A]/80 backdrop-blur-sm transition-opacity"
        onClick={closeSheet}
      />

      {/* Sheet Content - .glass-strong */}
      <div className="relative w-full max-w-md h-full glass-strong border-l border-[var(--border-default)] shadow-2xl flex flex-col transform transition-transform duration-300">
        <div className="p-6 border-b border-[var(--border-default)] flex items-center justify-between">
          <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Wallet className="w-5 h-5 text-[var(--accent-emerald)]" />
            Record Payment
          </h2>
          <button
            onClick={closeSheet}
            aria-label="Close record payment sheet"
            className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-[var(--surface-glass-strong)] transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!studentId ? (
            <div className="text-[var(--text-muted)] text-sm text-center py-8">
              Please select a student from the sidebar first.
            </div>
          ) : (
            <form id="payment-form" onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2">Student</label>
                <div className="neumo-inset bg-[var(--bg-surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-[var(--text-primary)]">
                  {studentName}
                </div>
              </div>

              <div>
                <label htmlFor="payment-amount" className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2">Amount (₹)</label>
                <div className="relative">
                  <span className="absolute left-4 top-3 text-[var(--text-muted)] font-medium">₹</span>
                  <input
                    id="payment-amount"
                    type="text"
                    inputMode="decimal"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    aria-describedby="payment-preview"
                    className="neumo-inset w-full bg-[var(--bg-surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 pl-8 text-lg font-medium text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-emerald)]"
                  />
                </div>
              </div>

              <div>
                <span id="payment-method-label" className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2">Method</span>
                <div role="group" aria-labelledby="payment-method-label" className="grid grid-cols-3 gap-2">
                  {PAYMENT_METHODS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={method === m}
                      onClick={() => setMethod(m)}
                      className={`min-h-[44px] px-3 rounded-lg text-sm font-semibold border transition-colors ${
                        method === m
                          ? "bg-[var(--accent-emerald)]/20 border-[var(--accent-emerald)]/40 text-[var(--accent-emerald)]"
                          : "bg-[var(--bg-surface-inset)] border-[var(--border-default)] text-[var(--text-secondary)]"
                      }`}
                    >
                      {PAYMENT_METHOD_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="payment-ref" className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                  Reference (UTR / Cheque no.){method === "upi" || method === "bank" || method === "cheque" ? " *" : ""}
                </label>
                <input
                  id="payment-ref"
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={method === "cheque" ? "6-digit cheque no." : method === "cash" ? "Optional" : "10–22 character UTR"}
                  className="neumo-inset w-full bg-[var(--bg-surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-emerald)]"
                />
                {preview.refError && (
                  <p className="text-xs mt-1 text-[var(--accent-flare)]">{preview.refError}</p>
                )}
              </div>

              <div>
                <label htmlFor="payment-date" className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2">Date</label>
                <input
                  id="payment-date"
                  type="date"
                  required
                  value={dateIso}
                  onChange={(e) => setDateIso(e.target.value)}
                  className="neumo-inset w-full bg-[var(--bg-surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-emerald)]"
                />
                {preview.backdated && (
                  <div className="mt-2 p-3 rounded-lg bg-[var(--accent-amber)]/10 border border-[var(--accent-amber)]/25 text-sm text-[var(--accent-amber)]">
                    <p className="flex items-center gap-2 font-semibold">
                      <AlertTriangle className="w-4 h-4" /> Backdated payment — fresh PIN required
                    </p>
                    <input
                      id="payment-pin"
                      type="password"
                      value={backdatePin}
                      onChange={(e) => setBackdatePin(e.target.value)}
                      placeholder="Enter PIN"
                      aria-label="Fresh PIN for backdated payment"
                      className="neumo-inset mt-2 w-full bg-[var(--bg-surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none"
                    />
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="payment-desc" className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2">Description</label>
                <input
                  id="payment-desc"
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="neumo-inset w-full bg-[var(--bg-surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-emerald)]"
                />
              </div>

              {preview.excess && (
                <label className="flex items-start gap-3 p-3 rounded-lg bg-[var(--accent-emerald)]/10 border border-[var(--accent-emerald)]/25 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={advanceAck}
                    onChange={(e) => setAdvanceAck(e.target.checked)}
                    className="mt-1 w-5 h-5 accent-[var(--accent-emerald)]"
                  />
                  <span className="text-[var(--text-primary)]">
                    Mark as advance payment
                    <span className="block text-xs text-[var(--text-muted)]">
                      Surplus beyond balance goes to the advance wallet (EC-F-02)
                    </span>
                  </span>
                </label>
              )}

              {/* Receipt preview — exactly what will be posted (07 §6.4). */}
              <div id="payment-preview" aria-live="polite" className="p-4 rounded-xl bg-[var(--surface-glass-faint)] border border-[var(--border-glass)] text-sm space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Receipt preview</p>
                {preview.amountPaise !== null ? (
                  <>
                    <p className="text-[var(--text-primary)]">
                      Amount <span className="font-bold num">{formatINR(preview.amountPaise)}</span>
                      <span className="text-[var(--text-muted)]"> · {PAYMENT_METHOD_LABELS[method]}</span>
                      {reference.trim() && <span className="text-[var(--text-muted)]"> · {reference.trim()}</span>}
                    </p>
                    {preview.balanceKnown && preview.split && (
                      <p className="text-[var(--text-primary)]">
                        After this payment: Balance{" "}
                        <span className="font-bold num">{formatINR(preview.split.balanceAfterPaise)}</span>
                        {" · "}{statusLabel}
                        {preview.split.isAdvance && (
                          <span className="ml-2 chip chip-success num">Advance {formatINR(preview.split.advancePaise)}</span>
                        )}
                      </p>
                    )}
                    <p className="text-xs text-[var(--text-muted)]">
                      Applies earliest-due-first (§9.6 step 5)
                      {preview.split?.isAdvance ? "; surplus auto-invoiced as advance" : ""} · Receipt
                      number issued on commit — monotonic, never reused (BR-RC-01)
                    </p>
                  </>
                ) : (
                  <p className="text-[var(--text-muted)]">Enter an amount to preview the receipt.</p>
                )}
              </div>

              {mutation.error && (
                <div role="alert" className="p-3 rounded-lg bg-[var(--accent-flare)]/10 border border-[var(--accent-flare)]/20 text-[var(--accent-flare)] text-sm">
                  {mutation.error.message}
                </div>
              )}
              {preview.errors.length > 0 && preview.amountPaise !== null && (
                <div role="alert" className="p-3 rounded-lg bg-[var(--accent-amber)]/10 border border-[var(--accent-amber)]/25 text-[var(--accent-amber)] text-sm">
                  {preview.errors.join(" ")}
                </div>
              )}
            </form>
          )}
        </div>

        <div className="p-6 border-t border-[var(--border-default)] bg-[var(--bg-surface-raised)]/30">
          <button
            type="submit"
            form="payment-form"
            disabled={!canSubmit}
            className="w-full min-h-[44px] neumo-raised py-3 rounded-xl text-sm font-bold text-[var(--text-on-accent)] bg-gradient-to-r from-[var(--accent-emerald)] to-[var(--accent-cyan)] shadow-[0_0_15px_rgba(0,255,157,0.3)] hover:brightness-110 transition-all disabled:opacity-50 disabled:shadow-none"
          >
            {mutation.isPending ? "Recording..." : "Save Payment"}
          </button>
        </div>
      </div>
    </div>
  );
}
