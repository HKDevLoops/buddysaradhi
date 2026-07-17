"use client";

// Implements: UI/web/06_Fees_and_Payments.md — FeesClient (TutorOS tabbed ledger screen)
// Five top-level tabs: Ledger, Pending/Overdue, Collections, Extras, Import.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getStudentsForFees } from "@/server/queries/fees";
import { getPaymentHeatmap } from "@/server/queries/dashboard-heatmaps";
import { useFeesStore } from "@/stores/fees-store";
import { LedgerTable } from "./ledger-table";
import { PendingTab } from "./payments-client";
import { ExtraFeeSheet } from "./extra-fee-sheet";
import { LedgerImport } from "./ledger-import";
import { RecordPaymentSheet } from "./record-payment-sheet";
import { GenerateInvoiceSheet } from "./generate-invoice-sheet";
import { formatINR } from "@buddysaradhi/shared";
import { cn } from "@/lib/utils";
import {
  Receipt,
  AlertCircle,
  CalendarRange,
  Sparkles,
  Upload,
  TrendingUp,
  Wallet,
  Loader2,
} from "lucide-react";

type FeesTab = "ledger" | "pending" | "collections" | "extras" | "import";

const TABS: { id: FeesTab; label: string; Icon: typeof Receipt }[] = [
  { id: "ledger", label: "Ledger", Icon: Receipt },
  { id: "pending", label: "Pending / Overdue", Icon: AlertCircle },
  { id: "collections", label: "Collections", Icon: CalendarRange },
  { id: "extras", label: "Extras", Icon: Sparkles },
  { id: "import", label: "Import", Icon: Upload },
];

interface StudentRow {
  id: string;
  name: string;
  code: string | null;
  fee_model: string;
  balance_due: number;
  grade?: string;
  batch?: string | null;
}

const ACCENTS = [
  "emerald",
  "cyan",
  "amber",
  "flare",
  "violet",
  "primary",
  "secondary",
  "tertiary",
] as const;

function studentAccent(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}


export function FeesClient() {
  const [tab, setTab] = useState<FeesTab>("ledger");
  const { selectedStudentId, setSelectedStudentId } = useFeesStore();
  const [studentSearch, setStudentSearch] = useState("");

  const { data: studentsData } = useQuery({
    queryKey: ["fees-students", ""],
    queryFn: () => getStudentsForFees(""),
  });
  const students = (studentsData?.data ?? []) as StudentRow[];
  const activeStudentId = selectedStudentId ?? students[0]?.id ?? null;
  const activeStudent = students.find((s) => s.id === activeStudentId);

  const filteredStudents = useMemo(() => {
    if (!studentSearch.trim()) return students;
    const q = studentSearch.toLowerCase();
    return students.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.code && s.code.toLowerCase().includes(q))
    );
  }, [students, studentSearch]);

  return (
    <div className="space-y-6 flex flex-col min-h-[100dvh]">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Fees &amp; Payments</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Every fee, every receipt, one append-only ledger.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs overflow-x-auto no-scrollbar" role="tablist" aria-label="Fees sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn("tab flex items-center gap-2", tab === t.id && "tab-active")}
          >
            <t.Icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        {tab === "ledger" && (
          <div className="flex flex-col md:flex-row gap-6 min-h-[500px] md:h-[calc(100dvh-280px)] relative">
            {/* Left pane — vertical student list */}
            <section
              className="flex flex-col w-full md:w-[280px] flex-shrink-0 min-h-0 glass-panel rounded-2xl overflow-hidden"
              aria-label="Students Ledger Navigation"
            >
              {/* Header/Search for students in fees list */}
              <div className="flex-none p-3 border-b border-[var(--border-glass)] space-y-2">
                <div className="text-xs uppercase tracking-wider font-semibold text-[var(--text-secondary)]">
                  Select Student
                </div>
                <div className="relative">
                  <input
                    type="search"
                    placeholder="Filter students..."
                    aria-label="Filter students by name"
                    className="neumo-inset w-full px-3 py-1.5 text-xs"
                    style={{
                      background: "var(--bg-surface-inset)",
                      border: "1px solid var(--border-default)",
                      color: "var(--text-primary)",
                      borderRadius: "var(--radius-md)",
                    }}
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                  />
                </div>
              </div>

              {/* Scrollable vertical list of students */}
              <div className="flex-1 overflow-y-auto no-scrollbar p-1 divide-y divide-[var(--border-glass)]">
                {filteredStudents.map((s) => {
                  const isActive = s.id === activeStudentId;
                  const accent = studentAccent(s.id);
                  const subtitle = [s.grade, s.batch].filter(Boolean).join("·") || s.code || "—";
                  const owes = s.balance_due > 0;
                  const credit = s.balance_due < 0;

                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedStudentId(s.id)}
                      className="w-full flex items-center gap-3 px-3 py-3 text-left transition-colors min-h-[64px]"
                      style={{
                        background: isActive
                          ? "color-mix(in srgb, var(--accent-primary) 10%, transparent)"
                          : "transparent",
                        borderLeft: isActive
                          ? "3px solid var(--accent-primary)"
                          : "3px solid transparent",
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) e.currentTarget.style.background = "var(--surface-glass-faint)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) e.currentTarget.style.background = "transparent";
                      }}
                      aria-pressed={isActive}
                    >
                      {/* Accent avatar with initials */}
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
                        style={{
                          background: `color-mix(in srgb, var(--accent-${accent}) 16%, var(--bg-surface-raised))`,
                          color: `var(--accent-${accent})`,
                          border: `1px solid color-mix(in srgb, var(--accent-${accent}) 35%, transparent)`,
                        }}
                        aria-hidden="true"
                      >
                        {initials(s.name)}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p
                          className="text-sm font-semibold truncate"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {s.name}
                        </p>
                        <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                          {subtitle}
                        </p>
                      </div>

                      {/* Status chip */}
                      {owes ? (
                        <span className="chip chip-warning num shrink-0 text-[10px] px-2 py-0.5" title="Outstanding dues">
                          <span className="chip-dot" aria-hidden="true" />
                          Due {formatINR(s.balance_due)}
                        </span>
                      ) : credit ? (
                        <span className="chip chip-info num shrink-0 text-[10px] px-2 py-0.5" title="Credit balance">
                          <span className="chip-dot" aria-hidden="true" />
                          Credit {formatINR(Math.abs(s.balance_due))}
                        </span>
                      ) : (
                        <span className="chip chip-success shrink-0 text-[10px] px-2 py-0.5" title="No dues">
                          <span className="chip-dot" aria-hidden="true" />
                          No dues
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Right pane — active student ledger table */}
            <section className="flex-1 min-w-0 min-h-0 h-full" aria-label="Student Ledger History">
              {activeStudent ? (
                <div className="glass-panel rounded-2xl p-0 flex flex-col overflow-hidden h-full">
                  <LedgerTable studentId={activeStudent.id} studentName={activeStudent.name} />
                </div>
              ) : (
                <div className="glass-panel rounded-2xl h-full flex flex-col items-center justify-center space-y-4" style={{ color: "var(--text-muted)" }}>
                  <Receipt className="w-8 h-8 opacity-50" />
                  <p className="text-sm">No students yet. Add a student to start a ledger.</p>
                </div>
              )}
            </section>
          </div>
        )}

        {tab === "pending" && <PendingTab />}

        {tab === "collections" && <CollectionsTab students={students} />}

        {tab === "extras" && <ExtraFeeSheet />}

        {tab === "import" && <LedgerImport />}
      </div>

      <RecordPaymentSheet studentId={activeStudentId} studentName={activeStudent?.name} />
      <GenerateInvoiceSheet studentId={activeStudentId} studentName={activeStudent?.name} />
    </div>
  );
}

function CollectionsTab({ students }: { students: StudentRow[] }) {
  const now = useMemo(() => new Date(), []);
  const startIso = useMemo(() => new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), [now]);
  const endIso = useMemo(() => now.toISOString(), [now]);

  const { data: heat, isLoading } = useQuery({
    queryKey: ["fees", "heatmap", startIso],
    queryFn: () => getPaymentHeatmap(startIso, endIso),
  });

  const collected = students.reduce((acc, s) => acc + (s.balance_due < 0 ? Math.abs(s.balance_due) : 0), 0);
  const dueTillDate = students.reduce((acc, s) => acc + (s.balance_due > 0 ? s.balance_due : 0), 0);

  const financial = (heat && "data" in heat && heat.data ? heat.data : []) as unknown[];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="glass p-5 rounded-xl flex flex-col justify-between" style={{ borderLeft: "3px solid var(--accent-emerald)" }}>
          <div className="flex items-center gap-2 mb-2" style={{ color: "var(--text-secondary)" }}>
            <TrendingUp className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wider font-semibold">Collected This Month</span>
          </div>
          <p className="text-2xl font-bold num" style={{ color: "var(--text-primary)" }}>{formatINR(collected)}</p>
        </div>
        <div className="glass p-5 rounded-xl flex flex-col justify-between" style={{ borderLeft: "3px solid var(--accent-flare)" }}>
          <div className="flex items-center gap-2 mb-2" style={{ color: "var(--text-secondary)" }}>
            <AlertCircle className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wider font-semibold">Due Till Date</span>
          </div>
          <p className="text-2xl font-bold num" style={{ color: "var(--text-primary)" }}>{formatINR(dueTillDate)}</p>
        </div>
        <div className="glass p-5 rounded-xl flex flex-col justify-between" style={{ borderLeft: "3px solid var(--accent-cyan)" }}>
          <div className="flex items-center gap-2 mb-2" style={{ color: "var(--text-secondary)" }}>
            <Wallet className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wider font-semibold">Active Students</span>
          </div>
          <p className="text-2xl font-bold num" style={{ color: "var(--text-primary)" }}>{students.length}</p>
        </div>
      </div>

      <div className="glass-panel rounded-xl p-6">
        <h2 className="text-lg font-medium mb-4" style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
          Collection Heatmap
        </h2>
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-primary)" }} />
          </div>
        ) : financial.length === 0 ? (
          <div className="text-sm text-center py-10" style={{ color: "var(--text-muted)" }}>
            No collection data for this month yet.
          </div>
        ) : (
          <Heatmap data={financial} />
        )}
      </div>
    </div>
  );
}

function Heatmap({ data }: { data: unknown[] }) {
  type Row = { student_name: string; week_start: string; cell_status: string; due_minor: number };
  const rows = data as Row[];
  const studentNames = Array.from(new Set(rows.map((d) => d.student_name))).sort();
  const weeks = Array.from(new Set(rows.map((d) => d.week_start))).sort();

  return (
    <div className="flex flex-col gap-2 min-w-max overflow-x-auto">
      {studentNames.map((s) => (
        <div key={s} className="flex items-center gap-4">
          <div className="w-28 truncate text-xs" style={{ color: "var(--text-secondary)" }} title={s}>{s}</div>
          <div className="flex gap-1.5">
            {weeks.map((w) => {
              const cell = rows.find((d) => d.student_name === s && d.week_start === w);
              let bg = "bg-[var(--bg-surface-inset)]";
              if (cell) {
                if (cell.cell_status === "paid") bg = "bg-[var(--accent-emerald)] shadow-[0_0_8px_var(--accent-emerald)]";
                else if (cell.cell_status === "partial") bg = "bg-[var(--accent-cyan)] shadow-[0_0_6px_var(--accent-cyan)]";
                else if (cell.cell_status === "unpaid") bg = "bg-[var(--accent-flare)] shadow-[0_0_6px_var(--accent-flare)]";
              }
              return (
                <div
                  key={w}
                  className={cn("w-4 h-4 rounded-sm transition-colors hover:ring-1 ring-white/30", bg)}
                  title={`${s} | ${cell ? cell.cell_status : "No dues"}`}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
