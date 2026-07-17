"use client";

// Implements: UI/web/06_Fees_and_Payments.md — LedgerTable (TutorOS ledger feed)
// Renders the chronological transaction feed for a student with type-badged rows.
// Append-only ledger: this component only renders + voids (via existing action).

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getLedgerForStudent } from "@/server/queries/fees";
import { voidReceiptAction } from "@/server/actions/fees";
import { useFeesStore } from "@/stores/fees-store";
import { formatINR } from "@buddysaradhi/shared";
import { format, parseISO } from "date-fns";
import { Loader2, Plus, Ban, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Receipt,
  Sparkles,
  Wallet,
  Undo2,
  SlidersHorizontal,
  Tag,
  Circle,
  ArrowDownToLine,
} from "lucide-react";

interface LedgerEntry {
  id: string;
  type: string;
  occurred_on: string;
  description: string | null;
  receipt_no?: string | null;
  this_hash?: string | null;
  debit: number;
  credit: number;
  isVoid?: boolean;
  balance: number;
}

interface LedgerTableProps {
  studentId: string;
  studentName: string;
}

type EntryMeta = {
  label: string;
  accent: string;
  Icon: typeof Receipt;
};

function entryMeta(type: string): EntryMeta {
  switch (type) {
    case "FEE_CHARGED":
      return { label: "Fee", accent: "var(--accent-amber)", Icon: Receipt };
    case "EXTRA_FEE":
      return { label: "Extra", accent: "var(--accent-flare)", Icon: Sparkles };
    case "PAYMENT_RECEIVED":
      return { label: "Payment", accent: "var(--accent-emerald)", Icon: Wallet };
    case "REFUND":
      return { label: "Refund", accent: "var(--accent-cyan)", Icon: Undo2 };
    case "ADJUSTMENT":
      return { label: "Adjust", accent: "var(--accent-violet)", Icon: SlidersHorizontal };
    case "DISCOUNT":
      return { label: "Discount", accent: "var(--accent-cyan)", Icon: Tag };
    case "VOID":
      return { label: "Void", accent: "var(--accent-danger)", Icon: Ban };
    default:
      return { label: type || "Entry", accent: "var(--text-muted)", Icon: Circle };
  }
}

export function LedgerTable({ studentId, studentName }: LedgerTableProps) {
  const { setPaymentSheetOpen, setInvoiceSheetOpen } = useFeesStore();
  const queryClient = useQueryClient();
  const [voidEntryId, setVoidEntryId] = useState<string | null>(null);
  const [voidPin, setVoidPin] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["ledger", studentId],
    queryFn: () => getLedgerForStudent(studentId),
  });

  const voidMutation = useMutation({
    mutationFn: () => voidReceiptAction(voidEntryId!, voidPin),
    onSuccess: (res) => {
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: ["ledger"] });
        queryClient.invalidateQueries({ queryKey: ["fees-students"] });
        setVoidEntryId(null);
        setVoidPin("");
      }
    },
  });

  const rawEntries = (data?.data ?? []) as LedgerEntry[];
  const entries: LedgerEntry[] = [];
  let runningBalance = 0;
  for (let i = rawEntries.length - 1; i >= 0; i--) {
    const e = rawEntries[i];
    runningBalance += e.debit ?? 0;
    runningBalance -= e.credit ?? 0;
    entries.unshift({ ...e, balance: runningBalance });
  }

  return (
    <div className="flex flex-col h-full">
      <div
        className="p-4 flex items-center justify-between gap-3 flex-wrap"
        style={{
          borderBottom: "1px solid var(--border-glass)",
          background: "var(--surface-glass-faint)",
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center font-bold shrink-0"
            style={{
              background: "linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))",
              color: "var(--text-on-accent)",
            }}
          >
            {studentName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2
              className="text-lg font-bold truncate"
              style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}
            >
              {studentName}&apos;s Ledger
            </h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {entries.length} entries · hash-chained &amp; append-only
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setInvoiceSheetOpen(true)}
            className="btn-glass neumo-raised px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all"
            style={{ background: "var(--bg-surface-raised)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent-cyan)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
          >
            <Plus className="w-4 h-4" style={{ color: "var(--accent-cyan)" }} /> Charge Fee
          </button>
          <button
            onClick={() => setPaymentSheetOpen(true)}
            className="btn-glass neumo-raised px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all shadow-[0_4px_12px_rgba(0,0,0,0.1)]"
            style={{ background: "linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan))", color: "var(--text-on-accent)", border: "none" }}
          >
            <ArrowDownToLine className="w-4 h-4" /> Record Payment
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto no-scrollbar p-3 sm:p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-primary)" }} />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-sm" style={{ color: "var(--text-muted)" }}>
            <Receipt className="w-8 h-8 opacity-40 mb-3" />
            <p>No ledger entries yet. Charge a fee or record a payment to begin.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => {
              const meta = entryMeta(entry.type);
              const isInflow = (entry.credit ?? 0) > 0;
              const amount = isInflow ? entry.credit : entry.debit;
              const amountColor = isInflow ? "var(--accent-emerald)" : "var(--accent-flare)";
              const sign = isInflow ? "+" : "−";
              return (
                <li
                  key={entry.id}
                  className={cn(
                    "group flex items-center gap-3 p-3 rounded-xl transition-colors",
                    entry.isVoid && "opacity-50"
                  )}
                  style={{ background: "var(--surface-glass-faint)", border: "1px solid var(--border-glass)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-glass)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface-glass-faint)"; }}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{
                      background: `color-mix(in srgb, ${meta.accent} 14%, transparent)`,
                      color: meta.accent,
                      border: `1px solid color-mix(in srgb, ${meta.accent} 28%, transparent)`,
                    }}
                    aria-hidden="true"
                  >
                    <meta.Icon className="w-5 h-5" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wide"
                        style={{
                          background: `color-mix(in srgb, ${meta.accent} 12%, transparent)`,
                          color: meta.accent,
                        }}
                      >
                        {meta.label}
                      </span>
                      <p
                        className={cn("font-semibold text-sm truncate", entry.isVoid && "line-through")}
                        style={{ color: entry.isVoid ? "var(--text-muted)" : "var(--text-primary)" }}
                      >
                        {entry.description || meta.label}
                      </p>
                      {entry.receipt_no && (
                        <span className="text-xs px-1.5 py-0.5 rounded font-mono shrink-0" style={{ color: "var(--text-muted)", border: "1px solid var(--border-glass)" }}>
                          {entry.receipt_no}
                        </span>
                      )}
                    </div>
                    <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                      {format(parseISO(entry.occurred_on), "dd MMM yyyy")}
                      {entry.balance !== undefined && (
                        <span className="ml-2" style={{ color: "var(--text-secondary)" }}>
                          Bal {formatINR(Math.abs(entry.balance))} {entry.balance > 0 ? "Dr" : entry.balance < 0 ? "Cr" : ""}
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold num" style={{ color: amountColor }}>
                      {sign}
                      {formatINR(amount ?? 0)}
                    </p>
                    {entry.type === "PAYMENT_RECEIVED" && !entry.isVoid && (
                      <button
                        onClick={() => setVoidEntryId(entry.id)}
                        className="mt-1 flex items-center gap-1 text-[11px] px-2 py-0.5 rounded transition-colors opacity-0 group-hover:opacity-100"
                        style={{ color: "var(--text-muted)", border: "1px solid var(--border-glass)" }}
                        aria-label={`Void receipt for ${entry.description || "payment"}`}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent-danger)"; e.currentTarget.style.borderColor = "var(--accent-danger)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border-glass)"; }}
                      >
                        <Ban className="w-3 h-3" /> Void
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {voidEntryId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
          style={{ background: "color-mix(in srgb, var(--bg-canvas) 80%, transparent)" }}
        >
          <div
            className="rounded-2xl w-full max-w-sm p-6"
            style={{
              background: "var(--surface-glass-strong)",
              backdropFilter: "blur(24px) saturate(160%)",
              border: "1px solid var(--accent-danger)",
              boxShadow: "0 12px 40px var(--shadow-color)",
            }}
          >
            <div className="text-center space-y-4">
              <AlertTriangle className="w-12 h-12 mx-auto opacity-80" style={{ color: "var(--accent-danger)" }} />
              <h3 className="text-lg font-bold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
                Void Receipt
              </h3>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                This will append a reversing entry to the ledger. This action cannot be undone.
              </p>
              <div className="pt-4">
                <input
                  type="password"
                  value={voidPin}
                  onChange={(e) => setVoidPin(e.target.value)}
                  maxLength={4}
                  autoFocus
                  placeholder="PIN"
                  className="neumo-inset w-full px-4 py-3 text-xl text-center tracking-[1em] font-mono focus:outline-none"
                  style={{ background: "var(--bg-surface-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
                />
                {voidMutation.error && (
                  <p className="text-xs mt-2" style={{ color: "var(--accent-danger)" }}>{voidMutation.error.message}</p>
                )}
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => { setVoidEntryId(null); setVoidPin(""); }}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold transition-colors"
                  style={{ color: "var(--text-secondary)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => voidMutation.mutate()}
                  disabled={voidPin.length < 4 || voidMutation.isPending}
                  className="flex-1 neumo-raised py-2 rounded-lg text-sm font-bold transition-colors disabled:opacity-50"
                  style={{ background: "var(--bg-surface-raised)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent-danger)"; e.currentTarget.style.borderColor = "var(--accent-danger)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.borderColor = "var(--border-default)"; }}
                >
                  {voidMutation.isPending ? "Voiding..." : "Confirm Void"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
