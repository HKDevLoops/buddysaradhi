"use client";

// Implements: 07_Fees_and_Payments.md §6.2 (row action → RecordPaymentSheet
// with student prefilled) + §6.4 (receipt preview needs known dues).
import { useFeesStore } from "@/stores/fees-store";
import { Plus } from "lucide-react";
import { RecordPaymentSheet } from "../fees/record-payment-sheet";

export function RecordPaymentButton({
  studentId,
  studentName,
  balanceDuePaise,
}: {
  studentId: string;
  studentName?: string;
  /** Known dues in paise — feeds the receipt preview. Omitted callers (e.g. the student drawer) get a preview without balance-after. */
  balanceDuePaise?: number;
}) {
  const { setPaymentSheetOpen } = useFeesStore();

  return (
    <>
      <button
        onClick={() => setPaymentSheetOpen(true)}
        aria-label={studentName ? `Record payment for ${studentName}` : "Record payment"}
        className="min-h-[44px] flex items-center gap-2 px-4 py-2 bg-[var(--success)]/20 text-[var(--success)] hover:bg-[var(--success)]/30 rounded-lg transition-colors font-medium text-sm"
      >
        <Plus className="w-4 h-4" />
        Record Payment
      </button>
      <RecordPaymentSheet
        studentId={studentId}
        studentName={studentName}
        balanceDuePaise={balanceDuePaise}
      />
    </>
  );
}
