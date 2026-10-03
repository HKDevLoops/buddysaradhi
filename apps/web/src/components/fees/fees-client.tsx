"use client";

// Implements: UI/web/06_Fees_and_Payments.md — FeesClient (TutorOS tabbed ledger screen)
// Five top-level tabs: Ledger, Pending/Overdue, Collections, Extras, Import.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getStudentsForFees } from "@/server/queries/fees";
import { gatewayGet } from "@/server/get-db";
import { useFeesStore } from "@/stores/fees-store";
import { LedgerTable } from "./ledger-table";
import { PendingTab } from "./payments-client";
import { ExtraFeeSheet } from "./extra-fee-sheet";
import { LedgerImport } from "./ledger-import";
import { RecordPaymentSheet } from "./record-payment-sheet";
import { GenerateInvoiceSheet } from "./generate-invoice-sheet";
import { StudentSearchBox } from "@/components/search/student-search-box";
import type { SearchCandidate } from "@/components/search/student-search-box";
import { formatINR, fuzzySearch, paiseAdd, paiseSub } from "@buddysaradhi/shared";
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
  "success",
  "info",
  "warning",
  "danger",
  "accent-primary",
  "accent-text",
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
  // No cast: the query's element already carries grade?/batch? (Rule 9).
  const students: StudentRow[] = studentsData?.data ?? [];
  const activeStudentId = selectedStudentId ?? students[0]?.id ?? null;
  const activeStudent = students.find((s) => s.id === activeStudentId);

  // docs/design/overhaul-plan.md §3: one engine everywhere. The pane already holds the
  // whole roster, so the filter ranks that list locally through `fuzzySearch` instead of
  // the old `String.includes` — same component, same keyboard path, no request.
  const studentCandidates = useMemo<SearchCandidate<string>[]>(
    () =>
      students.map((s) => ({
        item: s.id,
        text: [s.name, s.code, s.grade ?? "", s.batch ?? ""]
          .filter((part) => part !== null && part !== "")
          .join(" "),
        meta: s.code ?? s.grade ?? s.batch ?? "—",
      })),
    [students],
  );

  const rankedStudents = useMemo(
    () => fuzzySearch(studentCandidates, studentSearch).map((hit) => hit.item),
    [studentCandidates, studentSearch],
  );
  const rankedOrder = useMemo(
    () => new Map(rankedStudents.map((id, index) => [id, index])),
    [rankedStudents],
  );
  const filteredStudents = useMemo(
    () =>
      [...students]
        .filter((s) => rankedOrder.has(s.id))
        .sort((a, b) => (rankedOrder.get(a.id) as number) - (rankedOrder.get(b.id) as number)),
    [students, rankedOrder],
  );

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
              <div className="flex-none p-3 border-b border-[var(--border-default)] space-y-2">
                <div className="text-xs uppercase tracking-wider font-semibold text-[var(--text-secondary)]">
                  Select Student
                </div>
                <StudentSearchBox
                  label="Filter students by name"
                  value={studentSearch}
                  onValueChange={setStudentSearch}
                  onSelect={(id) => setSelectedStudentId(id)}
                  candidates={studentCandidates}
                  placeholder="Filter students…"
                  emptyLabel="No student matches that filter"
                />
              </div>

              {/* Scrollable vertical list of students */}
              <div className="flex-1 overflow-y-auto no-scrollbar p-1 divide-y divide-[var(--border-default)]">
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
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-3 text-left transition-all min-h-[64px] rounded-lg cursor-pointer",
                        isActive
                          ? "bg-[var(--surface-overlay)] shadow-sm ring-1 ring-[var(--success)]/30"
                          : "hover:bg-[var(--surface-inset)]"
                      )}
                      aria-pressed={isActive}
                    >
                      {/* Accent avatar with initials */}
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
                        style={{
                          background: `color-mix(in srgb, var(--${accent}) 16%, var(--surface-raised))`,
                          color: `var(--${accent})`,
                          border: `1px solid color-mix(in srgb, var(--${accent}) 35%, transparent)`,
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
                           Credit {formatINR(paiseSub(0, s.balance_due))}
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

      <RecordPaymentSheet studentId={activeStudentId} studentName={activeStudent?.name} balanceDuePaise={activeStudent?.balance_due} />
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
    queryFn: async () => {
      const res = await gatewayGet<{ financial: unknown[] }>(
        "/api/v1/analytics/dashboard",
        { periodStartIso: startIso, periodEndIso: endIso }
      );
      if (!res.success) return { success: false, data: [] };
      return { success: true, data: res.data.financial ?? [] };
    },
  });

  // Rule 6 / BR-M-01: paise helpers only — no `+`/`-` on money (§14 #3).
  const collected = students.reduce(
    (acc, s) => (s.balance_due < 0 ? paiseAdd(acc, paiseSub(0, s.balance_due)) : acc),
    0
  );
  const dueTillDate = students.reduce(
    (acc, s) => (s.balance_due > 0 ? paiseAdd(acc, s.balance_due) : acc),
    0
  );

  const financial: unknown[] = heat && "data" in heat && heat.data ? heat.data : [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="glass-panel p-5 rounded-xl flex flex-col justify-between" style={{ border: "1px solid color-mix(in srgb, var(--success) 25%, transparent)" }}>
          <div className="flex items-center gap-2 mb-2" style={{ color: "var(--text-secondary)" }}>
            <TrendingUp className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wider font-semibold">Collected This Month</span>
          </div>
          <p className="text-2xl font-bold num" style={{ color: "var(--text-primary)" }}>{formatINR(collected)}</p>
        </div>
        <div className="glass-panel p-5 rounded-xl flex flex-col justify-between" style={{ border: "1px solid color-mix(in srgb, var(--danger) 25%, transparent)" }}>
          <div className="flex items-center gap-2 mb-2" style={{ color: "var(--text-secondary)" }}>
            <AlertCircle className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wider font-semibold">Due Till Date</span>
          </div>
          <p className="text-2xl font-bold num" style={{ color: "var(--text-primary)" }}>{formatINR(dueTillDate)}</p>
        </div>
        <div className="glass-panel p-5 rounded-xl flex flex-col justify-between" style={{ border: "1px solid color-mix(in srgb, var(--info) 25%, transparent)" }}>
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
  // SAFETY: gateway analytics rows are shaped { student_name, week_start,
  // cell_status, due_minor }; a malformed row yields no cell match and renders
  // the neutral tile — never a crash, never money.
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
              let bg = "bg-[var(--surface-inset)]";
              if (cell) {
                if (cell.cell_status === "paid") bg = "bg-[var(--success)] shadow-[0_0_8px_var(--success)]";
                else if (cell.cell_status === "partial") bg = "bg-[var(--info)] shadow-[0_0_6px_var(--info)]";
                else if (cell.cell_status === "unpaid") bg = "bg-[var(--danger)] shadow-[0_0_6px_var(--danger)]";
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
