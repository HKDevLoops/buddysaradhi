"use client";

// Implements: 07_Fees_and_Payments.md §6.5 (Generate Invoice sheet) — amount,
// date, description, monotonic invoice number issued on commit. Money crosses
// as integer paise (BR-M-01). Feedback behaviour is identical to the Record
// Payment sheet (docs/design/overhaul-plan.md §2): it closes on success, toasts
// the invoice number it got back, toasts a failure and keeps the typed values,
// and a filled-in form is never discarded on Escape or a scrim click.
//
// 07_Fees_and_Payments.md §6.4 (the subject rule, applied HERE too). The rule —
// a charge must name its student — was enforced only in the payment sheet, so
// this sheet kept an enabled submit over an empty Student field. Both now block.
// The description may be seeded by an Extra Fees category: that is the seed
// only, and `openingDescription` is what `dirty` compares against, so a
// category the app chose is not mistaken for work the tutor typed.

import { useEffect, useState } from "react";
import { useFeesStore } from "@/stores/fees-store";
import { createInvoiceAction } from "@/server/actions/fees";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileText } from "lucide-react";
import { format } from "date-fns";
import { formatINR, paiseAdd } from "@buddysaradhi/shared";
import { useToast } from "@/components/ui/toast";
import { useOverlayDismiss, DiscardChangesPrompt, OverlayCloseButton } from "@/components/ui/overlay";
import type { getLedgerForStudent } from "@/server/queries/fees";
import type { getStudentsForFees } from "@/server/queries/fees";
import { rupeesStringToPaise } from "./payment-contract";

type LedgerQueryData = Awaited<ReturnType<typeof getLedgerForStudent>>;
type FeesStudentsQueryData = Awaited<ReturnType<typeof getStudentsForFees>>;

/** What an invoice is called when nobody chose a category for it. */
const DEFAULT_DESCRIPTION = "Monthly Tuition Fee";

interface GenerateInvoiceSheetProps {
  studentId: string | null;
  studentName?: string;
}

export function GenerateInvoiceSheet({ studentId, studentName }: GenerateInvoiceSheetProps) {
  const {
    isInvoiceSheetOpen,
    setInvoiceSheetOpen,
    invoiceDescriptionSeed,
    setInvoiceDescriptionSeed,
  } = useFeesStore();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [dateIso, setDateIso] = useState(format(new Date(), "yyyy-MM-dd"));
  /**
   * The description this OPEN started from, which may be an extra-fee category
   * rather than the default. `dirty` compares against this, not against the
   * constant: a category the app chose is not work the tutor typed, and asking
   * "discard your changes?" about it would be a lie.
   */
  const [openingDescription, setOpeningDescription] = useState(DEFAULT_DESCRIPTION);

  // Adopt the category seed ON OPEN. Reading the seed on every render would
  // overwrite whatever the tutor typed the moment the store changed underneath.
  useEffect(() => {
    if (!isInvoiceSheetOpen) return;
    const seed = invoiceDescriptionSeed ?? DEFAULT_DESCRIPTION;
    setOpeningDescription(seed);
    setDescription(seed);
  }, [isInvoiceSheetOpen, invoiceDescriptionSeed]);

  const closeSheet = () => {
    setInvoiceSheetOpen(false);
    // The seed is consumed here, so the NEXT invoice opens from the default
    // instead of inheriting a category chosen two screens ago.
    setInvoiceDescriptionSeed(null);
    setAmount("");
    setDescription(DEFAULT_DESCRIPTION);
    setOpeningDescription(DEFAULT_DESCRIPTION);
    setDateIso(format(new Date(), "yyyy-MM-dd"));
  };

  const dirty =
    amount.trim().length > 0 || description.trim() !== openingDescription.trim();

  const { panelRef, onScrimClick, confirmThenClose, setDiscardOpen, discardOpen, discardQuestion } =
    useOverlayDismiss({
      open: isInvoiceSheetOpen,
      onClose: closeSheet,
      dirty,
      label: "invoice form",
    });

  const mutation = useMutation({
    mutationFn: (amountMinor: number) =>
      createInvoiceAction(studentId!, amountMinor, description, dateIso),
    onMutate: async (amountMinor) => {
      await queryClient.cancelQueries({ queryKey: ["ledger"] });
      await queryClient.cancelQueries({ queryKey: ["fees-students"] });

      const prevLedger = queryClient.getQueryData<LedgerQueryData>(["ledger", studentId]);
      const prevStudents = queryClient.getQueryData<FeesStudentsQueryData>(["fees-students"]);

      // Optimistic row in PAISE (paise feed — never rupees here).
      queryClient.setQueryData<LedgerQueryData>(["ledger", studentId], (old) => {
        if (!old || old.success === false || !Array.isArray(old.data)) return old;
        const template = old.data[0];
        const optimistic = {
          ...(template ?? {
            id: "",
            type: "FEE_CHARGED",
            debit: 0,
            credit: 0,
            occurred_on: dateIso,
            receipt_no: null,
            description: null,
            isVoid: false,
            this_hash: null,
          }),
          id: "temp-" + Date.now(),
          type: "FEE_CHARGED",
          debit: amountMinor,
          credit: 0,
          occurred_on: dateIso,
          receipt_no: null,
          description,
          isVoid: false,
          this_hash: "calculating...",
        };
        return { ...old, data: [optimistic, ...old.data] };
      });

      queryClient.setQueryData<FeesStudentsQueryData>(["fees-students", ""], (old) => {
        if (!old || old.success === false || !Array.isArray(old.data)) return old;
        return {
          ...old,
          data: old.data.map((s) =>
            s.id === studentId ? { ...s, balance_due: paiseAdd(s.balance_due, amountMinor) } : s
          ),
        };
      });

      return { prevLedger, prevStudents };
    },
    onSuccess: (result, amountMinor) => {
      if (result.success !== true) {
        toast.error("Invoice not created", `${result.error} Nothing was written.`);
        return;
      }
      toast.success(
        `Invoice created — ${formatINR(amountMinor)}`,
        `${result.data.number} · now owed by ${subjectName}`,
      );
      closeSheet();
    },
    onError: (error, _newAmount, context) => {
      const ctx = context as
        | { prevLedger?: LedgerQueryData; prevStudents?: FeesStudentsQueryData }
        | undefined;
      if (ctx?.prevLedger) queryClient.setQueryData(["ledger", studentId], ctx.prevLedger);
      if (ctx?.prevStudents) queryClient.setQueryData(["fees-students"], ctx.prevStudents);
      toast.error(
        "Invoice not created",
        `${error.message} Nothing was written — your entry is still here, fix it and try again.`,
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["ledger"] });
      queryClient.invalidateQueries({ queryKey: ["fees-students"] });
    },
  });

  const amountPaise = amount.trim().length > 0 ? rupeesStringToPaise(amount) : null;
  const amountError =
    amount.trim().length > 0 && amountPaise === null
      ? "Enter a valid amount (up to 2 decimals, max ₹1,00,00,000)"
      : null;

  const serverError =
    mutation.isSuccess && mutation.data && mutation.data.success !== true
      ? mutation.data.error
      : mutation.isError && mutation.error instanceof Error
        ? mutation.error.message
        : null;

  /**
   * An invoice must NAME its subject, exactly as a payment must
   * (`record-payment-sheet.tsx` — "A payment must NAME its subject"). The rule
   * lived in the payment sheet alone, so the invoice sheet kept an enabled
   * "Create invoice" over an EMPTY Student field: an invoice that names nobody
   * is a charge the tutor cannot find, reconcile, or reverse. `studentId` with no
   * resolvable name is not a cosmetic gap, so both props resolve together — no
   * id, or no name, means no subject, and the sheet blocks instead of hinting.
   *
   * Extra Fees is the case that made this matter: its Charge buttons open this
   * sheet from a screen where the tutor may not have picked a student yet.
   */
  const subjectName = studentName?.trim() ?? "";
  const subjectResolved = studentId !== null && studentId.length > 0 && subjectName.length > 0;

  const canSubmit = subjectResolved && amountPaise !== null && !mutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Re-derived here rather than trusted from `canSubmit`: the button's disabled
    // state is a hint to the browser, this is the check that decides whether money
    // is written.
    if (!studentId || !subjectResolved || amountPaise === null || mutation.isPending) return;
    mutation.mutate(amountPaise);
  };

  if (!isInvoiceSheetOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0" onClick={onScrimClick} aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Generate invoice"
        tabIndex={-1}
        className="relative w-full max-w-md h-full glass-strong border-l border-[var(--border-default)] flex flex-col"
      >
        <div className="p-6 border-b border-[var(--border-default)] flex items-center justify-between">
          <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
            <FileText className="w-5 h-5 text-[var(--info)]" aria-hidden="true" />
            Generate Invoice
          </h2>
          <OverlayCloseButton onClick={confirmThenClose} label="Close generate invoice sheet" />
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!subjectResolved ? (
            /* Blocking, not a hint — the same state the payment sheet shows. Two
               causes land here (no student selected, or a selected student the
               current roster can no longer resolve) and both name the recovery.
               The submit button stays disabled, so nothing can half-post. */
            <div role="alert" className="flex flex-col items-center gap-3 text-center py-10">
              <AlertTriangle className="w-9 h-9 shrink-0" style={{ color: "var(--warning)" }} aria-hidden="true" />
              <p className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                No student to invoice.
              </p>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {studentId === null || studentId.length === 0
                  ? "Close this sheet, choose a student from the list, then create the invoice."
                  : "The student this invoice was opened for is no longer in your list. Close this sheet, choose the student again, then create the invoice."}
              </p>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Nothing has been charged. An invoice is always raised against a named student, so this
                one cannot be created until you pick one.
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
            <form id="invoice-form" onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                  Student
                </label>
                <div className="neumo-inset bg-[var(--surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-[var(--text-primary)]">
                  {subjectName}
                </div>
              </div>

              <div>
                <label
                  htmlFor="invoice-amount"
                  className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2"
                >
                  Amount (₹)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-3 text-[var(--text-muted)] font-medium">₹</span>
                  <input
                    id="invoice-amount"
                    type="text"
                    inputMode="decimal"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    aria-invalid={amountError ? true : undefined}
                    aria-describedby={amountError ? "invoice-amount-error" : undefined}
                    className="neumo-inset w-full bg-[var(--surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 pl-8 text-lg font-medium text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--info)] focus:ring-1 focus:ring-[var(--info)]"
                  />
                </div>
                {amountError && (
                  <p id="invoice-amount-error" className="mt-1 text-xs" style={{ color: "var(--danger)" }}>
                    {amountError}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="invoice-date"
                  className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2"
                >
                  Date
                </label>
                <input
                  id="invoice-date"
                  type="date"
                  required
                  value={dateIso}
                  onChange={(e) => setDateIso(e.target.value)}
                  className="neumo-inset w-full bg-[var(--surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--info)] focus:ring-1 focus:ring-[var(--info)]"
                />
              </div>

              <div>
                <label
                  htmlFor="invoice-desc"
                  className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2"
                >
                  Description
                </label>
                <input
                  id="invoice-desc"
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="neumo-inset w-full bg-[var(--surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--info)] focus:ring-1 focus:ring-[var(--info)]"
                />
              </div>

              {serverError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/25 text-[var(--danger)] text-sm"
                >
                  <span className="font-semibold">Not created. </span>
                  {serverError} Nothing was written — your entry is still here, fix it and try again.
                </div>
              )}
            </form>
          )}
        </div>

        <div className="p-6 border-t border-[var(--border-default)] bg-[var(--surface-raised)]/30">
          <button
            type="submit"
            form="invoice-form"
            disabled={!canSubmit}
            aria-busy={mutation.isPending}
            className="w-full min-h-[44px] neumo-raised py-3 rounded-xl text-sm font-bold text-[var(--accent-on-primary)] bg-[var(--accent-primary)] hover:brightness-110 transition-all disabled:opacity-50 disabled:shadow-none"
          >
            {mutation.isPending ? "Creating invoice…" : "Create invoice"}
          </button>
          <p className="mt-2 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            An invoice number is issued the moment this saves, and numbers are never reused.
          </p>
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