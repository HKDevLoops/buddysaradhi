"use client";

// Implements: UI/web/06_Fees_and_Payments.md — Pending/Overdue tab (TutorOS)
// Lists students with outstanding dues, each with a Record Payment action + bulk record.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getStudentsForFees } from "@/server/queries/fees";
import { useFeesStore } from "@/stores/fees-store";
import { formatINR } from "@buddysaradhi/shared";
import { Loader2, Search, Wallet, CircleDollarSign } from "lucide-react";

interface StudentRow {
  id: string;
  name: string;
  code: string | null;
  fee_model: string;
  balance_due: number;
}

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

export function PendingTab() {
  const { setSelectedStudentId, setPaymentSheetOpen } = useFeesStore();
  const [query, setQuery] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["fees-students", ""],
    queryFn: () => getStudentsForFees(""),
  });

  const students = useMemo(() => (data?.data ?? []) as StudentRow[], [data]);
  const due = useMemo(
    () => students.filter((s) => s.balance_due > 0),
    [students]
  );
  const filtered = useMemo(
    () => due.filter((s) => s.name.toLowerCase().includes(query.toLowerCase())),
    [due, query]
  );
  const totalDue = due.reduce((acc, s) => acc + s.balance_due, 0);

  const recordFor = (id: string) => {
    setSelectedStudentId(id);
    setPaymentSheetOpen(true);
  };

  const bulkRecord = () => {
    if (due.length === 0) return;
    recordFor(due[0].id);
  };

  return (
    <div className="glass-panel rounded-xl p-6 flex flex-col min-h-[400px]">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-medium" style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
            Pending / Overdue
          </h2>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {due.length} students owe{" "}
            <span className="num font-semibold" style={{ color: "var(--accent-flare)" }}>{formatINR(totalDue)}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <input
              type="text"
              placeholder="Search dues..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="neumo-inset w-full md:w-56 bg-[var(--bg-surface-inset)] border border-[var(--border-default)] rounded-lg px-3 py-2 pl-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-cyan)]"
            />
            <Search className="w-4 h-4 absolute left-3 top-2.5 pointer-events-none" style={{ color: "var(--text-muted)" }} />
          </div>
          <button
            onClick={bulkRecord}
            disabled={due.length === 0}
            className="btn-glass neumo-raised px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan))", color: "var(--text-on-accent)", border: "none" }}
          >
            <Wallet className="w-4 h-4" /> Record Payment
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-primary)" }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
          <CircleDollarSign className="w-8 h-8 opacity-40 mb-3" style={{ color: "var(--accent-success)" }} />
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {due.length === 0 ? "All dues collected. Clean slate." : "No matches for your search."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 p-3 rounded-xl transition-colors"
              style={{ background: "var(--surface-glass-faint)", border: "1px solid var(--border-glass)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-glass)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface-glass-faint)"; }}
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0"
                style={{ background: "color-mix(in srgb, var(--accent-flare) 15%, transparent)", color: "var(--accent-flare)" }}
              >
                {initials(s.name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate" style={{ color: "var(--text-primary)" }}>{s.name}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="chip chip-danger"><span className="chip-dot" />Unpaid</span>
                  <span className="text-xs capitalize" style={{ color: "var(--text-muted)" }}>{s.fee_model}</span>
                </div>
              </div>
              <div className="text-right shrink-0 mr-2">
                <p className="text-sm font-bold num" style={{ color: "var(--accent-flare)" }}>{formatINR(s.balance_due)}</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>outstanding</p>
              </div>
              <button
                onClick={() => recordFor(s.id)}
                className="btn-glass neumo-raised px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all"
                style={{ background: "var(--bg-surface-raised)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
                aria-label={`Record payment for ${s.name}`}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent-emerald)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
              >
                <Wallet className="w-4 h-4" style={{ color: "var(--accent-emerald)" }} /> Record
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
