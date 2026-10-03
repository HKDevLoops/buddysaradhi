"use client";

// Implements: UI/web/06_Fees_and_Payments.md — LedgerTable (TutorOS ledger feed)
// 07_Fees_and_Payments.md §6.3 (immutable per-student ledger with VOID rows +
// void linkage) + §9.10 (void receipt with PIN + typed reason) + §10.2
// BR-LED-02/BR-LED-03 (append-only, void linkage); 12_Business_Rules.md
// BR-LED-04/BR-LED-05 (reversing entry, never void-a-void), BR-M-01 (paise);
// 10_Security.md §4 (void = sensitive mutation, PIN) + §9 (void is a new row);
// 02_Core_Logic.md §13.6 (voidLedgerEntry); 14_Edge_Cases.md EC-F-05 (invoice
// reverts), EC-L-02 (void-of-void blocked), EC-L-07 (receipt gap intentional).
//
// Audit trail per student: every row shows entry type (chip + icon + word),
// business date, receipt number, the VOID linkage (`reverses_entry_id` —
// "↺ reverses …"), and the derived running balance. The gateway already
// ships `reverses_entry_id` in this payload (no extra bytes — free-tier
// minimal); the local row type below declares it because the query's inline
// type omits it (queries are another workstream's scope — not widened here).
// Actor/`created_at` are NOT in this payload (gateway parity gap — reported).

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getLedgerForStudent } from "@/server/queries/fees";
import { voidReceiptAction } from "@/server/actions/fees";
import { useFeesStore } from "@/stores/fees-store";
import { formatINR, paiseAdd, paiseSub } from "@buddysaradhi/shared";
import { VoidReasonSchema } from "./payment-contract";
import { mintIntentKey } from "@/lib/intent-key";
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

type LedgerQueryData = Awaited<ReturnType<typeof getLedgerForStudent>>;
type LedgerQueryRow = LedgerQueryData["data"][number];

// The gateway GET /api/v1/ledger payload carries these fields even though
// the query's inline type omits them (free-tier: already in the payload, so
// declaring them costs zero extra bytes). No cast — an intersection over the
// inferred row type.
type LedgerEntry = LedgerQueryRow & {
  reverses_entry_id?: string | null;
  balance_after?: number | null;
};

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
      return { label: "Fee", accent: "var(--warning)", Icon: Receipt };
    case "EXTRA_FEE":
      return { label: "Extra", accent: "var(--danger)", Icon: Sparkles };
    case "PAYMENT_RECEIVED":
      return { label: "Payment", accent: "var(--success)", Icon: Wallet };
    case "REFUND":
      return { label: "Refund", accent: "var(--info)", Icon: Undo2 };
    case "ADJUSTMENT":
      return { label: "Adjust", accent: "var(--info)", Icon: SlidersHorizontal };
    case "DISCOUNT":
      return { label: "Discount", accent: "var(--info)", Icon: Tag };
    case "VOID":
      return { label: "Void", accent: "var(--danger)", Icon: Ban };
    default:
      return { label: type || "Entry", accent: "var(--text-muted)", Icon: Circle };
  }
}

export function LedgerTable({ studentId, studentName }: LedgerTableProps) {
  const { setPaymentSheetOpen, setInvoiceSheetOpen } = useFeesStore();
  const queryClient = useQueryClient();
const [voidEntryId, setVoidEntryId] = useState<string | null>(null);
const [voidPin, setVoidPin] = useState("");
const [voidReason, setVoidReason] = useState("");
const [voidError, setVoidError] = useState<string | null>(null);
// RFC-004 C1: one intent key per modal open — double-click confirm, aborted
// POST retried, or the same void echoed from another device all replay
// instead of double-voiding (gateway idempotency store is the enforcer).
const [voidKey, setVoidKey] = useState<string>("");

  const { data, isLoading } = useQuery({
    queryKey: ["ledger", studentId],
    queryFn: () => getLedgerForStudent(studentId),
  });

const voidMutation = useMutation({
  mutationFn: () => voidReceiptAction(voidEntryId ?? "", voidPin, voidReason, { intentKey: voidKey }),
  onSuccess: (res) => {
    if (res.success) {
      queryClient.invalidateQueries({ queryKey: ["ledger"] });
      queryClient.invalidateQueries({ queryKey: ["fees-students"] });
      setVoidEntryId(null);
      setVoidPin("");
      setVoidReason("");
      setVoidError(null);
      setVoidKey("");
    } else {
      setVoidError(res.error);
    }
  },
    onError: (err) => {
      setVoidError(err instanceof Error ? err.message : "Failed to void receipt");
    },
  });

  // No cast: LedgerEntry only ADDS optional members over the inferred row, so
  // the query array assigns directly (Rule 9 — no silent `as` forcing).
  const queryRows: LedgerEntry[] =
    data?.success === false ? [] : (data?.data ?? []);
  const rawEntries = queryRows;
  // Derived running balance, oldest → newest (Rule 6: paise helpers only —
  // no `+`/`-` on money per AGENTS §14 checklist #3).
  const entries: Array<LedgerEntry & { balance: number }> = [];
  let runningBalance = 0;
  for (let i = rawEntries.length - 1; i >= 0; i--) {
    const e = rawEntries[i];
    if (!e) continue;
    runningBalance = paiseSub(paiseAdd(runningBalance, e.debit ?? 0), e.credit ?? 0);
    entries.unshift({ ...e, balance: runningBalance });
  }

  const voidTarget = voidEntryId ? entries.find((e) => e.id === voidEntryId) : undefined;
  const reasonError = (() => {
    const r = VoidReasonSchema.safeParse(voidReason);
    return r.success ? null : r.error.issues[0]?.message ?? "Invalid reason";
  })();
  const canConfirmVoid =
    voidTarget !== undefined &&
    voidTarget.type !== "VOID" &&
    voidPin.trim().length >= 6 &&
    reasonError === null &&
    !voidMutation.isPending;

  const openVoid = (id: string) => {
    setVoidEntryId(id);
    setVoidPin("");
    setVoidReason("");
    setVoidError(null);
    setVoidKey(mintIntentKey());
  };

  return (
    <div className="flex flex-col h-full">
      <div
        className="p-4 flex items-center justify-between gap-3 flex-wrap"
        style={{
          borderBottom: "1px solid var(--border-default)",
          background: "var(--surface-inset)",
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center font-bold shrink-0"
            style={{
              background: "linear-gradient(135deg, var(--accent-primary), var(--accent-text))",
              color: "var(--accent-on-primary)",
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
            className="btn-glass neumo-raised min-h-[44px] px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all"
            style={{ background: "var(--surface-raised)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--info)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
          >
            <Plus className="w-4 h-4" style={{ color: "var(--info)" }} /> Charge Fee
          </button>
          <button
            onClick={() => setPaymentSheetOpen(true)}
            className="btn-glass neumo-raised min-h-[44px] px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all shadow-[0_4px_12px_rgba(0,0,0,0.1)]"
            style={{ background: "linear-gradient(135deg, var(--success), var(--info))", color: "var(--accent-on-primary)", border: "none" }}
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
              const amountColor = isInflow ? "var(--success)" : "var(--danger)";
              const sign = isInflow ? "+" : "−";
              const reverses = entry.reverses_entry_id ?? null;
              return (
                <li
                  key={entry.id}
                  className={cn(
                    "group flex items-center gap-3 p-3 rounded-xl transition-colors",
                    entry.isVoid && "opacity-50"
                  )}
                  style={{ background: "var(--surface-inset)", border: "1px solid var(--border-default)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-raised)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface-inset)"; }}
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
                        <span className="text-xs px-1.5 py-0.5 rounded font-mono shrink-0" style={{ color: "var(--text-muted)", border: "1px solid var(--border-default)" }}>
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
                      {reverses && (
                        <span className="ml-2 px-1.5 py-0.5 rounded font-mono" style={{ color: "var(--danger)", border: "1px solid var(--danger)" }}>
                          ↺ reverses {reverses.slice(0, 8)}
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
                        onClick={() => openVoid(entry.id)}
                        // The Void action used to be `opacity-0 group-hover:opacity-100`,
                        // which made it invisible on a touch device (no hover) and
                        // invisible to a keyboard — on the one action in this table
                        // that touches the immutable ledger. It now rests at low
                        // opacity, comes to full on hover AND on keyboard focus, and
                        // becomes fully opaque on coarse pointers where hover never
                        // fires.
                        className="mt-1 min-h-[44px] flex items-center gap-1 text-[11px] px-2 py-0.5 rounded transition-colors opacity-60 group-hover:opacity-100 focus-visible:opacity-100 motion-safe:hover:opacity-100"
                        style={{ color: "var(--text-muted)", border: "1px solid var(--border-default)" }}
                        aria-label={`Void receipt for ${entry.description || "payment"}`}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--danger)"; e.currentTarget.style.borderColor = "var(--danger)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border-default)"; }}
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
          style={{ background: "color-mix(in srgb, var(--canvas) 80%, transparent)" }}
        >
          <div
            className="rounded-2xl w-full max-w-sm p-6"
            style={{
              background: "var(--surface-overlay)",
              backdropFilter: "blur(24px) saturate(160%)",
              border: "1px solid var(--danger)",
              boxShadow: "0 12px 40px var(--shadow-overlay)",
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Void receipt"
          >
            <div className="text-center space-y-4">
              <AlertTriangle className="w-12 h-12 mx-auto opacity-80" style={{ color: "var(--danger)" }} />
              <h3 className="text-lg font-bold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
                Void Receipt
              </h3>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {voidTarget?.receipt_no ? `Receipt ${voidTarget.receipt_no} · ` : ""}
                {voidTarget ? formatINR(voidTarget.credit ?? 0) : ""} — this posts a
                reversing entry linked to the original (Rule 1). The receipt
                number is consumed forever (BR-RC-01). This cannot be undone.
              </p>
              <div className="pt-2 text-left space-y-3">
                <div>
                  <label htmlFor="void-reason" className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                    Reason (required)
                  </label>
                  <textarea
                    id="void-reason"
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    placeholder="e.g. Wrong student — should be Ananya STU-0011"
                    rows={3}
                    className="neumo-inset w-full px-4 py-3 text-sm focus:outline-none resize-none"
                    style={{ background: "var(--surface-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
                  />
                  {voidReason.length > 0 && reasonError && (
                    <p className="text-xs mt-1" style={{ color: "var(--danger)" }}>{reasonError}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="void-pin" className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                    PIN (6+ digits)
                  </label>
                  <input
                    id="void-pin"
                    type="password"
                    value={voidPin}
                    onChange={(e) => setVoidPin(e.target.value)}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="••••••"
                    className="neumo-inset w-full px-4 py-3 text-xl text-center tracking-[0.5em] font-mono focus:outline-none"
                    style={{ background: "var(--surface-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
                  />
                </div>
                {voidError && (
                  <p role="alert" className="text-xs" style={{ color: "var(--danger)" }}>{voidError}</p>
                )}
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => { setVoidEntryId(null); setVoidPin(""); setVoidReason(""); setVoidError(null); setVoidKey(""); }}
                  className="flex-1 min-h-[44px] py-2 rounded-lg text-sm font-semibold transition-colors"
                  style={{ color: "var(--text-secondary)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => voidMutation.mutate()}
                  disabled={!canConfirmVoid}
                  className="flex-1 min-h-[44px] neumo-raised py-2 rounded-lg text-sm font-bold transition-colors disabled:opacity-50"
                  style={{ background: "var(--surface-raised)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--danger)"; e.currentTarget.style.borderColor = "var(--danger)"; }}
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
