"use client";

import { useFeesStore } from "@/stores/fees-store";
import { Plus } from "lucide-react";
import { RecordPaymentSheet } from "../fees/record-payment-sheet";

export function RecordPaymentButton({ studentId, studentName }: { studentId: string, studentName?: string }) {
  const { setPaymentSheetOpen } = useFeesStore();

  return (
    <>
      <button 
        onClick={() => setPaymentSheetOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-[var(--accent-emerald)]/20 text-[var(--accent-emerald)] hover:bg-[var(--accent-emerald)]/30 rounded-lg transition-colors font-medium text-sm"
      >
        <Plus className="w-4 h-4" />
        Record Payment
      </button>
      <RecordPaymentSheet studentId={studentId} studentName={studentName} />
    </>
  );
}
