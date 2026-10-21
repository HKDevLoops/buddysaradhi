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
// commit (monotonic, never reused); the preview says so instead of
// fabricating a number. Attribution is earliest-due-first with any surplus
// auto-invoiced as advance — stated, not picked.
//
// Feedback (docs/design/overhaul-plan.md §2): the sheet used to close inside
// `onMutate`, so the typed ₹5,000 vanished before the server had answered and a
// failure looked exactly like a success. It now closes on success, toasts the
// receipt number, toasts the failure and keeps the sheet open with the values
// intact, and refuses to discard a filled-in form on Escape or a scrim click.

import { useEffect, useMemo, useRef, useState } from "react";
import { useFeesStore } from "@/stores/fees-store";
import { recordPaymentAction } from "@/server/actions/fees";
import { useConfirmedMutation, ConfirmedMutationError } from "@/hooks/use-confirmed-mutation";
import type { Confirmation } from "@/hooks/use-confirmed-mutation";
import { useQueryClient } from "@tanstack/react-query";
import { Wallet, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { formatINR } from "@buddysaradhi/shared";
import { useToast } from "@/components/ui/toast";
import { useOverlayDismiss, DiscardChangesPrompt, OverlayCloseButton } from "@/components/ui/overlay";
import { Explain } from "@/components/ui/explain";
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

/**
 * The action's own success payload, read off its return type rather than
 * restated here: a second hand-written copy of the receipt shape is a shape
 * that can drift from the server without anything noticing (AGENTS.md §6.1 —
 * types are inferred, never mirrored).
 */
type PaymentActionData = Extract<
  Awaited<ReturnType<typeof recordPaymentAction>>,
  { success: true }
>["data"];

/**
 * RFC-004 C3 — the offline queue is keyed by tenant, and this sheet has no
 * server-resolved tenant id to key it with (the product is single-tenant per
 * deployment; nothing client-side carries the auth uid).
 *
 * It is also NOT USED: `isOnline` below always returns true, so the hook never
 * takes the queue branch. That is deliberate. `drainQueue`/`useOnlineFlush`
 * exist in `lib/offline-queue.ts` but have NO production call site, so a queued
 * payment would sit there for ever and the tutor would believe it was recorded
 * — a silent failure (Rule 9) about MONEY. When the drain is wired (GlassShell
 * + `useOnlineFlush`, draining with `recordPaymentAction(..., { intentKey:
 * item.key })` per `lib/offline-queue.ts:368`), pass the real tenant id here
 * AND delete the `isOnline` override in one change, so the two can never
 * disagree.
 */
const PAYMENT_QUEUE_SCOPE = "single-tenant";

/**
 * One submit attempt. A `type`, not an `interface`, because
 * `useConfirmedMutation<TArgs extends Record<string, unknown>, …>` requires
 * TArgs to have an implicit index signature — which an interface does not have.
 */
type PaymentSubmit = {
  studentIdSafe: string;
  amountPaise: number;
  description: string;
  receivedOn: string;
  method: PaymentMethod;
  reference: string;
  advanceAcknowledged: boolean;
  /** BR-SEC-04 — present only when `receivedOn` is before today. */
  backdatePin?: string;
};

/** What the optimistic blocks read before they overwrite (rollback source). */
type PaymentSnapshot = {
  prevLedger: LedgerQueryData | undefined;
  prevStudents: FeesStudentsQueryData | undefined;
};

function todayIso(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function RecordPaymentSheet({ studentId, studentName, balanceDuePaise }: RecordPaymentSheetProps) {
  const { isPaymentSheetOpen, setPaymentSheetOpen } = useFeesStore();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("Tuition Fee Payment");
  const [dateIso, setDateIso] = useState(todayIso);
  const [advanceAck, setAdvanceAck] = useState(false);
  const [backdatePin, setBackdatePin] = useState("");

  const resetForm = () => {
    setAmount("");
    setMethod("cash");
    setReference("");
    setDescription("Tuition Fee Payment");
    setDateIso(todayIso());
    setAdvanceAck(false);
    setBackdatePin("");
  };

  const closeSheet = () => {
    setPaymentSheetOpen(false);
    resetForm();
  };

  // Any typed value makes the form dirty; the untouched default description is
  // not the tutor's work. This used to count ONLY the free-text fields, so a
  // tutor who backdated the date — which is what raises the PIN panel — and then
  // hit Escape or clicked the scrim lost the date, the PIN and the advance
  // acknowledgement with no confirmation, while the sheet asked `useOverlayDismiss`
  // whether the form was clean and believed itself. Every control on the form
  // counts.
  const dirty =
    amount.trim().length > 0 ||
    reference.trim().length > 0 ||
    backdatePin.trim().length > 0 ||
    description.trim() !== "Tuition Fee Payment" ||
    method !== "cash" ||
    dateIso !== todayIso() ||
    advanceAck;

  const {
    panelRef,
    onScrimClick,
    confirmThenClose,
    setDiscardOpen,
    discardOpen,
    discardQuestion,
  } = useOverlayDismiss({
    open: isPaymentSheetOpen,
    onClose: closeSheet,
    dirty,
    label: "payment form",
  });

  /**
   * RFC-004 C1/K1 — the intent key is minted ONCE PER SUBMIT by
   * `useConfirmedMutation` and reused unchanged on every retry and every
   * replay, so the server guard in `recordPaymentAction` collapses a double
   * tap, a mid-flight retry, and a "the response never reached me" re-tap into
   * ONE payment and ONE receipt number.
   *
   * TanStack Query does NOT dedupe mutations and a returned `{success:false}`
   * is a RESOLVED value, so the plain `useMutation` this replaces offered
   * nothing at all: a second tap minted a fresh `receiptId` and consumed a
   * fresh `next_receipt_seq`, which is the P0 (F-04) this closes.
   */
  const lastSubmittedRef = useRef<PaymentSubmit | null>(null);
  const handledConfirmationRef = useRef<Confirmation<PaymentActionData> | null>(null);
  const handledErrorRef = useRef<Error | null>(null);

  const confirmed = useConfirmedMutation<PaymentSubmit, PaymentActionData, PaymentSnapshot>({
    tenantId: PAYMENT_QUEUE_SCOPE,
    action: "fees.recordPayment",
    // Always attempt the network: see PAYMENT_QUEUE_SCOPE — nothing drains the
    // offline queue yet, so a queued payment would never post. A dead network
    // now costs three bounded retries with the SAME key and then an honest
    // "nothing was written", which is true: the guard means the retry cannot
    // have committed either.
    isOnline: () => true,
    invoke: (args) =>
      recordPaymentAction(
        args.studentIdSafe,
        args.amountPaise,
        args.description,
        args.receivedOn,
        {
          method: args.method,
          reference: args.reference,
          advanceAcknowledged: args.advanceAcknowledged,
          pin: args.backdatePin,
          intentKey: args.intentKey,
        },
      ),
    snapshot: async () => {
      await queryClient.cancelQueries({ queryKey: ["ledger"] });
      await queryClient.cancelQueries({ queryKey: ["fees-students"] });
      return {
        prevLedger: queryClient.getQueryData<LedgerQueryData>(["ledger", studentId]),
        prevStudents: queryClient.getQueryData<FeesStudentsQueryData>(["fees-students"]),
      };
    },
    applyOptimistic: (args) => {
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
    },
    rollback: (snapshot) => {
      // Rule 9: the optimistic rows are the ones that would lie. Both are
      // restored from the snapshot the hook took in `onMutate`, which is the
      // only place a caller can be sure the pre-mutation state is the state to
      // return to.
      if (snapshot?.prevLedger) queryClient.setQueryData(["ledger", studentId], snapshot.prevLedger);
      if (snapshot?.prevStudents) queryClient.setQueryData(["fees-students"], snapshot.prevStudents);
    },
    invalidateKeys: [["ledger"], ["fees-students"]],
  });

  /**
   * Rule 9: the outcome is stated, every time, either way. `useConfirmedMutation`
   * owns `onSuccess`/`onError` (it cannot be handed callbacks), so the sheet
   * reacts to the settled result here instead of inside the mutation. The
   * identity guards make each outcome fire ONCE per result object, so a
   * re-render never re-toasts and a second attempt toasts for itself.
   */
  useEffect(() => {
    const confirmation = confirmed.data;
    if (!confirmation || handledConfirmationRef.current === confirmation) return;
    handledConfirmationRef.current = confirmation;
    const posted = lastSubmittedRef.current;

    if (confirmation.state === "queued") {
      // Unreachable while `isOnline` returns true — see PAYMENT_QUEUE_SCOPE. It
      // must NOT reuse the success wording below, which names a receipt number
      // that does not exist for a queued intent.
      toast.error(
        "Payment not recorded",
        "This device could not reach your books, so nothing has been written. Reconnect and record the payment again.",
      );
      return;
    }

    const { applied, advancePaise, receiptNo } = confirmation.data;
    // EC-F-02: the surplus is an ADVANCE - money the tutor holds that is not
    // owed. It is never dressed as a bill, so the toast says so plainly.
    const detailParts: string[] = [];
    if (applied.length > 0) {
      detailParts.push(`Applied to ${applied.map((a) => `${a.number} (${a.status})`).join(", ")}`);
    }
    if (advancePaise > 0) {
      detailParts.push(`Held as advance — ${formatINR(advancePaise)}`);
    }
    const detail = detailParts.length > 0 ? detailParts.join(" · ") : "Recorded";
    // 07 §9.6 step 3/7 + BR-RC-01: the number exists, is monotonic, and is
    // never reused — so it is the ONE fact the tutor must be handed, because
    // it is the handle they quote when they later void this payment. The
    // preview already promises it ("Your receipt number is issued the moment
    // this saves"); naming it here is the promise being kept. A blank number
    // is never printed — the sentence is simply omitted rather than showing
    // an empty handle (Rule 9).
    const receiptHandle =
      typeof receiptNo === "string" && receiptNo.trim().length > 0
        ? `${receiptNo.trim()} · `
        : "";
    toast.success(
      `Payment recorded — ${receiptHandle}${formatINR(posted?.amountPaise ?? confirmation.data.creditedPaise)}`,
      `${PAYMENT_METHOD_LABELS[posted?.method ?? confirmation.data.method]} · ${detail}`,
    );
    closeSheet();
  }, [confirmed.data]);

  useEffect(() => {
    const error = confirmed.error;
    if (!error || handledErrorRef.current === error) return;
    handledErrorRef.current = error;
    // The sheet stays open with every value intact so the tutor can retry — and
    // that retry now carries the SAME intent key only if the hook retries it;
    // a fresh tap mints a new one, which is correct: it is a new attempt at a
    // payment whose outcome is unknown, and the server's claim is what decides.
    //
    // "Check your connection" is only true for a failure that SURVIVED a retry.
    // A refusal on the first attempt ("amount exceeds balance", "that PIN isn't
    // right") was never a network problem, and blaming the connection there
    // sends the tutor to debug something that is not broken (Rule 9: the
    // message must state what actually happened).
    const retried = error instanceof ConfirmedMutationError && error.attempts > 1;
    toast.error(
      "Payment not saved",
      retried
        ? `${error.message} Nothing was written — check your connection and try again.`
        : `${error.message} Nothing was written.`,
    );
  }, [confirmed.error]);

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

  /**
   * The refusals the sheet must STATE in the alert block: everything except the
   * reference reason, which the Reference field already shows inline beneath the
   * input (and links to it with `aria-describedby`). Listing it twice read as
   * two different problems from one mistake.
   */
  const blockingErrors = preview.errors.filter((message) => message !== preview.refError);

  // A server rejection is a resolved `{success:false}` payload that
  // `invokeWithRetry` turns into a thrown `ConfirmedMutationError`, so it
  // surfaces here as well as in the toast — the tutor is looking at the sheet,
  // not the corner of the screen.
  const serverError = confirmed.error instanceof Error ? confirmed.error.message : null;

  /**
   * A payment must NAME its subject. `studentId` arriving without a resolvable
   * name is not a cosmetic gap — it renders an empty Student field over an
   * enabled Save button, and a payment that names nobody is a payment the tutor
   * cannot find, reconcile, or reverse (Rule 9). Both props are part of one
   * fact, so they resolve together: no id, or no name, means no subject.
   */
  const subjectName = studentName?.trim() ?? "";
  const subjectResolved = studentId !== null && studentId.length > 0 && subjectName.length > 0;

  const canSubmit =
    subjectResolved &&
    preview.amountPaise !== null &&
    preview.errors.length === 0 &&
    !confirmed.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentId || !subjectResolved || preview.amountPaise === null || preview.errors.length > 0) return;
    // RFC-004 K1 — the in-flight guard. `canSubmit` disables the button, but a
    // form submits on Enter from any field, so the button's state is not a
    // gate. Without this line a tutor could fire two attempts from the keyboard
    // while the first was still open; with it, the second tap waits for a
    // settled result and then re-reads what actually happened.
    if (confirmed.isPending) return;
    const args: PaymentSubmit = {
      studentIdSafe: studentId,
      amountPaise: preview.amountPaise,
      description: description.trim(),
      receivedOn: dateIso,
      method,
      reference: reference.trim(),
      advanceAcknowledged: advanceAck,
      // BR-SEC-04: the PIN is only posted when the payment is backdated. It used
      // to be collected, shown behind a "fresh PIN required" panel, and dropped
      // here — so the server never saw it and the gate was decoration. The
      // server re-derives `isBackdated` from the date rather than trusting this.
      backdatePin: preview.backdated ? backdatePin : undefined,
    };
    // Posts EXACTLY what was previewed — no silent recompute. The ref is read by
    // the outcome effect to report the figures that were ACTUALLY posted.
    lastSubmittedRef.current = args;
    confirmed.mutate(args);
  };

  if (!isPaymentSheetOpen) return null;

  const statusLabel =
    preview.split?.statusAfter === "paid"
      ? "✓ Paid"
      : preview.split?.statusAfter === "partial"
        ? "◐ Partial"
        : "✕ Unpaid";

  /**
   * A negative balance is CREDIT, not a negative debt (12_Business_Rules.md
   * BR-M-04: "Negative balances (advances) render as `−₹500` in emerald (not
   * red). An advance is money the tutor owes the student"). Printing it as
   * "Balance −₹700" beside a "◐ Partial" chip put three contradictory claims in
   * one preview block, so the amount is now named in the word the rest of the
   * product uses for it (see `BalanceStatusChip`: "Credit") and shown in the
   * accent that means "you hold this", never the danger accent.
   */
  const resultingBalance =
    preview.split === null
      ? null
      : preview.split.balanceAfterPaise < 0
        ? { label: "Credit on account", paise: paiseSub(0, preview.split.balanceAfterPaise), accent: "var(--success)" }
        : { label: "Balance", paise: preview.split.balanceAfterPaise, accent: "var(--text-primary)" };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Scrim — dims the page behind so the sheet reads as a surface, not an
          overlay collage. The missing dim is what made ledger cards bleed
          through the panel edges on wide screens. */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onScrimClick}
        aria-hidden="true"
      />

      {/* Sheet Content - .glass-strong, near-opaque so rows behind never show
          through the panel (menus/sheets sit at ~0.85+ solidity; translucency
          is texture, not see-through). */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Record payment"
        tabIndex={-1}
        style={{ background: "color-mix(in srgb, var(--surface-overlay) 88%, transparent)" }}
        className="relative w-full max-w-md h-full glass-strong border-l border-[var(--border-default)] flex flex-col overflow-x-clip"
      >
        <div className="p-6 border-b border-[var(--border-default)] flex items-center justify-between">
          <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Wallet className="w-5 h-5 text-[var(--success)]" aria-hidden="true" />
            Record Payment
          </h2>
          <OverlayCloseButton onClick={confirmThenClose} label="Close record payment sheet" />
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!subjectResolved ? (
            /* Blocking, not a hint. Two different causes land here — no student
               selected at all, or a selected student the current roster can no
               longer resolve — and both name the recovery. The Save button below
               stays disabled; nothing is posted, so nothing can half-post. */
            <div role="alert" className="flex flex-col items-center gap-3 text-center py-10">
              <AlertTriangle className="w-9 h-9 shrink-0" style={{ color: "var(--warning)" }} aria-hidden="true" />
              <p className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                No student to record this payment against.
              </p>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {studentId === null || studentId.length === 0
                  ? "Close this sheet, choose a student from the list, then record the payment."
                  : "The student this payment was opened for is no longer in your list. Close this sheet, choose the student again, then record the payment."}
              </p>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Nothing has been recorded. A payment is always saved against a named student, so this
                one cannot be saved until you pick one.
              </p>
              <button
                type="button"
                onClick={closeSheet}
                className="mt-2 min-h-[44px] neumo-raised px-5 py-2 rounded-lg text-sm font-semibold"
                style={{ color: "var(--text-primary)", border: "1px solid var(--border-default)" }}
              >
                Close and pick a student
              </button>
            </div>
          ) : (
            <form id="payment-form" onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2">Student</label>
                <div className="neumo-inset bg-[var(--surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-[var(--text-primary)]">
                  {subjectName}
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
                    className="neumo-inset w-full bg-[var(--surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 pl-8 text-lg font-medium text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--success)] focus:ring-1 focus:ring-[var(--success)]"
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
                          ? "bg-[var(--success)]/20 border-[var(--success)]/40 text-[color-mix(in_srgb,var(--success)_60%,var(--text-primary))]"
                          : "bg-[var(--surface-inset)] border-[var(--border-default)] text-[var(--text-secondary)]"
                      }`}
                    >
                      {PAYMENT_METHOD_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="payment-ref" className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                  Reference (UTR / Cheque no.) <span className="normal-case font-normal">— optional</span>
                </label>
                <input
                  id="payment-ref"
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={method === "cheque" ? "6-digit cheque no., if you have it" : method === "cash" ? "Optional" : "UTR, if you have it"}
                  aria-describedby={preview.refError ? "payment-ref-error" : undefined}
                  className="neumo-inset w-full bg-[var(--surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--success)] focus:ring-1 focus:ring-[var(--success)]"
                />
                {preview.refError && (
                  <p className="text-xs mt-1 text-[var(--danger)]">{preview.refError}</p>
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
                  className="neumo-inset w-full bg-[var(--surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--success)] focus:ring-1 focus:ring-[var(--success)]"
                />
                {preview.backdated && (
                  <div className="mt-2 p-3 rounded-lg bg-[var(--warning)]/10 border border-[var(--warning)]/25 text-sm text-[color-mix(in_srgb,var(--warning)_60%,var(--text-primary))]">
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
                      className="neumo-inset mt-2 w-full bg-[var(--surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--success)] focus:ring-1 focus:ring-[var(--success)]"
                    />
                    {/* BR-SEC-04 asks for a PIN on a backdated payment and the panel
                        above states the requirement, but not the reason — so a tutor
                        reads it as an obstacle and a 4-8 digit PIN they cannot set from
                        this sheet as a dead end. The explanation sits under the input
                        it explains and states both, in place, with nowhere to click
                        away to. Nothing in the payment path changed. */}
                    <Explain concept="backdated-payment-pin" className="mt-1" />
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
                  className="neumo-inset w-full bg-[var(--surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--success)] focus:ring-1 focus:ring-[var(--success)]"
                />
              </div>

              {preview.excess && (
                <label className="flex items-start gap-3 p-3 rounded-lg bg-[var(--success)]/10 border border-[var(--success)]/25 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={advanceAck}
                    onChange={(e) => setAdvanceAck(e.target.checked)}
                    className="mt-1 w-5 h-5 accent-[var(--success)]"
                  />
                  <span className="text-[var(--text-primary)]">
                    Mark as advance payment
                    <span className="block text-xs text-[var(--text-muted)]">
                      Anything beyond the balance due is kept as advance and used against the next
                      invoice.
                    </span>
                  </span>
                </label>
              )}

              {/* Receipt preview — exactly what will be posted (07 §6.4). */}
              <div id="payment-preview" aria-live="polite" className="p-4 rounded-xl bg-[var(--surface-inset)] border border-[var(--border-default)] text-sm space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Receipt preview</p>
                {preview.amountPaise !== null ? (
                  <>
                    <p className="text-[var(--text-primary)]">
                      Amount <span className="font-bold num">{formatINR(preview.amountPaise)}</span>
                      <span className="text-[var(--text-muted)]"> · {PAYMENT_METHOD_LABELS[method]}</span>
                      {reference.trim() && <span className="text-[var(--text-muted)]"> · {reference.trim()}</span>}
                    </p>
                    {preview.balanceKnown && preview.split && resultingBalance && (
                      <p className="text-[var(--text-primary)]">
                        After this payment: {resultingBalance.label}{" "}
                        <span className="font-bold num" style={{ color: resultingBalance.accent }}>
                          {formatINR(resultingBalance.paise)}
                        </span>
                        {" · "}{statusLabel}
                        {preview.split.isAdvance && (
                          <span className="ml-2 chip chip-success num">Advance {formatINR(preview.split.advancePaise)}</span>
                        )}
                      </p>
                    )}
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {/* Attribution is a FACT about the student's open invoices, so
                          the sentence that states it must not appear when there is
                          nothing to attribute against. A student who owes nothing was
                          previously told this payment "applies to the oldest unpaid
                          invoice first" — there is no such invoice, and the core flow
                          proves it by auto-invoicing the whole amount. One string, so
                          there is no orphaned full stop when the balance is unknown. */}
                      {preview.split === null
                        ? null
                        : preview.split.appliedPaise > 0
                          ? `Applied to the oldest unpaid invoice first${preview.split.isAdvance ? "; anything left over is held as advance on a new invoice" : ""}.`
                          : "Nothing is outstanding, so the whole amount is held on account."}{" "}
                      Your receipt number is issued the moment this saves, and no receipt number is ever
                      reused.
                    </p>
                  </>
                ) : (
                  <p className="text-[var(--text-muted)]">Enter an amount to preview the receipt.</p>
                )}
              </div>

              {serverError && (
                <div role="alert" className="p-3 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/25 text-[color-mix(in_srgb,var(--danger)_60%,var(--text-primary))] text-sm">
                  <span className="font-semibold">Not saved. </span>
                  {serverError} Nothing was written — your entry is still here, fix it and try again.
                </div>
              )}
              {/* Every refusal this sheet computed must be ON SCREEN. The block
                  used to be gated on `preview.amountPaise !== null`, which
                  suppressed it for exactly the input §14 names first — a ZERO
                  amount, where `rupeesStringToPaise` returns null. So "₹0" left
                  Save disabled with NO stated reason anywhere: a refusal the tutor
                  could not read, and the one case they are most likely to type.
                  The reference reason is not repeated here — the field owns it
                  inline, directly beneath the input and wired to it through
                  `aria-describedby` — so it is filtered out of this list. */}
              {blockingErrors.length > 0 && (
                <div role="alert" className="p-3 rounded-lg bg-[var(--warning)]/10 border border-[var(--warning)]/25 text-[color-mix(in_srgb,var(--warning)_60%,var(--text-primary))] text-sm">
                  {blockingErrors.join(" · ")}
                </div>
              )}
            </form>
          )}
        </div>

        <div className="p-6 border-t border-[var(--border-default)] bg-[var(--surface-raised)]/30">
          <button
            type="submit"
            form="payment-form"
            disabled={!canSubmit}
            aria-busy={confirmed.isPending}
            aria-disabled={!canSubmit}
            title={!canSubmit ? "Fill the highlighted fields to enable saving" : undefined}
            className="w-full min-h-[44px] neumo-raised py-3 rounded-xl text-sm font-bold text-[var(--accent-on-primary)] bg-[var(--accent-primary)] hover:brightness-110 transition-all disabled:opacity-70 disabled:shadow-none disabled:cursor-not-allowed disabled:text-[var(--text-secondary)] disabled:bg-[var(--surface-inset)]"
          >
            {confirmed.isPending ? "Saving payment…" : "Save payment"}
          </button>
          {confirmed.isPending ? (
            <p className="mt-2 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              Writing to your ledger. Keep this window open.
            </p>
          ) : null}
        </div>
      </div>

      <DiscardChangesPrompt
        open={discardOpen}
        question={discardQuestion}
        onKeep={() => setDiscardOpen(false)}
        onDiscard={() => {
          setDiscardOpen(false);
          closeSheet();
        }}
      />
    </div>
  );
}
