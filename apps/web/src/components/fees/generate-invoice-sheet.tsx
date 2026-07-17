"use client";

import { useState } from "react";
import { useFeesStore } from "@/stores/fees-store";
import { createInvoiceAction } from "@/server/actions/fees";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, FileText } from "lucide-react";
import { format } from "date-fns";


interface GenerateInvoiceSheetProps {
  studentId: string | null;
  studentName?: string;
}

export function GenerateInvoiceSheet({ studentId, studentName }: GenerateInvoiceSheetProps) {
  const { isInvoiceSheetOpen, setInvoiceSheetOpen } = useFeesStore();
  const queryClient = useQueryClient();
  
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("Monthly Tuition Fee");
  const [dateIso, setDateIso] = useState(format(new Date(), 'yyyy-MM-dd'));

  const mutation = useMutation({
    mutationFn: (amountMinor: number) => 
      createInvoiceAction(studentId!, amountMinor, description, dateIso),
    onMutate: async (amountMinor) => {
      await queryClient.cancelQueries({ queryKey: ['ledger'] });
      await queryClient.cancelQueries({ queryKey: ['fees-students'] });

      const prevLedger = queryClient.getQueryData(['ledger', studentId]);
      const prevStudents = queryClient.getQueryData(['fees-students', ]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queryClient.setQueryData(['fees-ledger', studentId], (old: { data: any[] } | undefined) => {
        if (!old?.data) return old;
        const newEntry = {
          id: 'temp-' + Date.now(),
          type: 'FEE_CHARGED',
          debit: amountMinor / 100,
          credit: 0,
          occurred_on: dateIso,
          receipt_no: null,
          description,
          isVoid: false,
          this_hash: 'calculating...'
        };
        const newData = [newEntry, ...old.data].sort((a, b) => {
           if (a.occurred_on > b.occurred_on) return -1;
           if (a.occurred_on < b.occurred_on) return 1;
           return 0;
        });
        return { ...old, data: newData };
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queryClient.setQueryData(['fees-students', ""], (old: { data: any[] } | undefined) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((s: { id: string; balance_due: number; [key: string]: unknown }) => 
            s.id === studentId ? { ...s, balance_due: s.balance_due + (amountMinor / 100) } : s
          )
        };
      });

      closeSheet();

      return { prevLedger, prevStudents };
    },
    onError: (err, newAmount, context) => {
      queryClient.setQueryData(['ledger', studentId], context?.prevLedger);
      queryClient.setQueryData(['fees-students', ], context?.prevStudents);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['ledger'] });
      queryClient.invalidateQueries({ queryKey: ['fees-students'] });
    }
  });

  const closeSheet = () => {
    setInvoiceSheetOpen(false);
    setAmount("");
    setDescription("Monthly Tuition Fee");
    setDateIso(format(new Date(), 'yyyy-MM-dd'));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentId || !amount) return;
    // BR-M-01: convert display rupees → integer paise safely (no float drift).
    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees <= 0) return;
    const amountMinor = Math.round(rupees * 100);
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) return;
    mutation.mutate(amountMinor);
  };

  if (!isInvoiceSheetOpen) return null;

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
            <FileText className="w-5 h-5 text-[var(--accent-cyan)]" />
            Generate Invoice
          </h2>
          <button 
            onClick={closeSheet}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--surface-glass-strong)] transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)]"
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
            <form id="invoice-form" onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2">Student</label>
                <div className="neumo-inset bg-[var(--bg-surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-[var(--text-primary)]">
                  {studentName}
                </div>
              </div>

              <div>
                <label htmlFor="invoice-amount" className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2">Amount (₹)</label>
                <div className="relative">
                  <span className="absolute left-4 top-3 text-[var(--text-muted)] font-medium">₹</span>
                  <input 
                    id="invoice-amount"
                    type="number" 
                    step="0.01"
                    min="1"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="neumo-inset w-full bg-[var(--bg-surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 pl-8 text-lg font-medium text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-cyan)]"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="invoice-date" className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2">Date</label>
                <input 
                  id="invoice-date"
                  type="date" 
                  required
                  value={dateIso}
                  onChange={(e) => setDateIso(e.target.value)}
                  className="neumo-inset w-full bg-[var(--bg-surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-cyan)]"
                />
              </div>

              <div>
                <label htmlFor="invoice-desc" className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2">Description</label>
                <input 
                  id="invoice-desc"
                  type="text" 
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="neumo-inset w-full bg-[var(--bg-surface-inset)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-cyan)]"
                />
              </div>

              {mutation.error && (
                <div className="p-3 rounded-lg bg-[var(--accent-flare)]/10 border border-[var(--accent-flare)]/20 text-[var(--accent-flare)] text-sm">
                  {mutation.error.message}
                </div>
              )}
            </form>
          )}
        </div>

        <div className="p-6 border-t border-[var(--border-default)] bg-[var(--bg-surface-raised)]/30">
          <button 
            type="submit"
            form="invoice-form"
            disabled={!studentId || !amount || mutation.isPending}
            className="w-full neumo-raised py-3 rounded-xl text-sm font-bold text-[var(--text-on-accent)] bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-violet)] shadow-[0_0_15px_rgba(0,255,157,0.3)] hover:brightness-110 transition-all disabled:opacity-50 disabled:shadow-none"
          >
            {mutation.isPending ? "Generating..." : "Generate Invoice"}
          </button>
        </div>
      </div>
    </div>
  );
}
