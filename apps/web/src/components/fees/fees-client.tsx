"use client";

// Implements: 07_Fees_and_Payments.md §6 (Fees screen — the only surface allowed
// to write `ledger_entries`/`invoices`/`receipts`), §6.1 Overview mode (the KPI
// strip: what is DUE is derived from balances, what was COLLECTED is derived from
// the ledger), §6.2 per-student balance list, §6.4 Record Payment;
// 12_Business_Rules.md BR-CALC-09/10/11 (Expected/Collected/Arrears are ledger
// derivatives, not balance sums) and BR-M-01 (integer paise); 13_UI_Guidelines.md
// §10 (tablist semantics: `role="tab"` is only valid next to a `tabpanel`,
// `aria-controls`, and roving `tabIndex`); AGENTS.md §2 Rule 9 (a failed roster
// read is not an empty roster) and Rule 10 (keyboard parity on the tablist).
//
// FeesClient (TutorOS tabbed ledger screen) — five tabs: Ledger, Pending/Overdue,
// Collections, Extras, Import.
//
// THE COLLECTIONS TAB (defect: two numbers under one name). It shipped a tile
// labelled "Collected This Month" whose value was the sum of every NEGATIVE
// balance — a credit total, summed across all time. The Dashboard's "Collected" KPI
// is a different measure from a different query, so the same words meant two
// languages and two numbers on two screens a tutor compares. The honest collection
// measure for a period is `collectedForMonth()` (BR-CALC-10), which reads the
// ledger per student; the web client cannot supply that without one gateway request
// per student, so the tile is DELETED rather than renamed into a different lie.
// What remains is named for what it measures, and every figure derives from the
// roster this screen already read live.

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { getStudentsForFees } from "@/server/queries/fees";
import { useFeesStore } from "@/stores/fees-store";
import { LedgerTable } from "./ledger-table";
import { PendingTab } from "./payments-client";
import { ExtraFeeSheet } from "./extra-fee-sheet";
import { LedgerImport } from "./ledger-import";
import { RecordPaymentSheet } from "./record-payment-sheet";
import { GenerateInvoiceSheet } from "./generate-invoice-sheet";
import { BalanceStatusChip, BalanceLegend } from "./balance-status";
import { StudentSearchBox } from "@/components/search/student-search-box";
import type { SearchCandidate } from "@/components/search/student-search-box";
import { ErrorState, ScreenSkeleton } from "@/components/ui/screen-state";
import { toAppErrorState } from "@/lib/app-errors";
import { formatINR, fuzzySearch, paiseAdd, paiseSub } from "@buddysaradhi/shared";
import { cn } from "@/lib/utils";
import {
  Receipt,
  AlertCircle,
  CalendarRange,
  Sparkles,
  Upload,
  Wallet,
  Users,
  HandCoins,
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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const { data: studentsData, isLoading: rosterLoading, isFetching: rosterFetching, refetch: refetchRoster } = useQuery({
    queryKey: ["fees-students", ""],
    queryFn: () => getStudentsForFees(""),
  });
  // A failed read is NOT an empty roster: `getStudentsForFees` resolves to a
  // `{success:false}` envelope, so `isError` never fires and the branch has to
  // read the envelope. Rendering "No students yet" on a timeout tells the tutor
  // to go and create the students they already have (Rule 9).
  const rosterFailure =
    studentsData && studentsData.success === false ? studentsData.error : null;
  // No cast: the query's element already carries grade?/batch? (Rule 9).
  const students: StudentRow[] = studentsData && studentsData.success ? studentsData.data : [];
  /**
   * The payment subject is a fact about the ROSTER, not about the selection.
   *
   * This used to be `selectedStudentId ?? students[0]?.id ?? null`. That `??`
   * fallback was the defect: nothing ever reconciled `selectedStudentId` against
   * a reloaded or filtered roster, so once the selected student left the list the
   * payment silently retargeted whoever happened to be FIRST — and the sheet
   * rendered an empty Student field over an enabled Save button. A payment that
   * names nobody is worse than no payment (Rule 9). No selection that survives
   * the roster means no subject; the sheet blocks and says why.
   */
  const activeStudent = students.find((s) => s.id === selectedStudentId) ?? null;
  const activeStudentId = activeStudent?.id ?? null;

  /**
   * Roving-tabindex keyboard support (13_UI_Guidelines.md §10). `role="tab"` is
   * only honest next to arrow-key movement, `Home`/`End`, and exactly one
   * tabbable stop — five `tabIndex={0}` buttons is not a tablist, it is five
   * separate links that happen to sit in a row.
   */
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = TABS.length - 1;
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === -1) return;
    const target = TABS[next];
    if (!target) return;
    event.preventDefault();
    setTab(target.id);
    tabRefs.current[next]?.focus();
  };

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

      {/* Tabs — a real tablist: each control owns a panel, only the active one is
          in the tab order, and arrows/Home/End move between them. */}
      <div className="tabs overflow-x-auto no-scrollbar" role="tablist" aria-label="Fees sections">
        {TABS.map((t, index) => (
          <button
            key={t.id}
            ref={(el) => { tabRefs.current[index] = el; }}
            id={`fees-tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            aria-controls={`fees-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onKeyDown={(e) => onTabKeyDown(e, index)}
            onClick={() => setTab(t.id)}
            className={cn("tab flex items-center gap-2", tab === t.id && "tab-active")}
          >
            <t.Icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content — one panel, labelled by its own tab. */}
      <div
        role="tabpanel"
        id={`fees-panel-${tab}`}
        aria-labelledby={`fees-tab-${tab}`}
        className="flex-1 min-h-0"
      >
        {rosterLoading ? (
          <ScreenSkeleton shape="roster" label="your students and their balances" rows={6} />
        ) : rosterFailure ? (
          <ErrorState
            state={toAppErrorState(rosterFailure)}
            onRetry={() => { void refetchRoster(); }}
            isRetrying={rosterFetching}
            retryLabel="Load students again"
            dataStatus="Nothing was changed and no payment was recorded. This screen is NOT your roster — a failed load looks exactly like an empty one, so no student has been deleted."
          />
        ) : (
          <>
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
                {/* The chips below say "Credit" with nothing behind the word. The
                    legend is mounted ONCE for the roster — not per row — and the
                    long answer to "what is Credit" is one disclosure away. */}
                <BalanceLegend />
              </div>

              {/* Scrollable vertical list of students */}
              <div className="flex-1 overflow-y-auto no-scrollbar p-1 divide-y divide-[var(--border-default)]">
                {filteredStudents.map((s) => {
                  const isActive = s.id === activeStudentId;
                  const accent = studentAccent(s.id);
                  const subtitle = [s.grade, s.batch].filter(Boolean).join("·") || s.code || "—";

                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedStudentId(s.id)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-3 text-left transition-all min-h-[64px] rounded-lg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]",
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
                          title={s.name}
                        >
                          {s.name}
                        </p>
                        <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                          {subtitle}
                        </p>
                      </div>

                      {/* Status chip — the SAME classifier the master list and the
                          pending-dues list read, so "Due" means one thing app-wide. */}
                      <BalanceStatusChip balanceDuePaise={s.balance_due} />
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
              ) : students.length === 0 ? (
                <div className="glass-panel rounded-2xl h-full flex flex-col items-center justify-center gap-3" style={{ color: "var(--text-muted)" }}>
                  <Receipt className="w-8 h-8 opacity-50" aria-hidden="true" />
                  <p className="text-sm">No students yet. Add a student to start a ledger.</p>
                </div>
              ) : (
                // Reached when the roster holds students but none is selected —
                // including the case where a filter or a reload dropped the
                // previously selected one. Saying "No students yet" here would
                // send the tutor off to create students they already have.
                <div className="glass-panel rounded-2xl h-full flex flex-col items-center justify-center gap-3 px-6 text-center" style={{ color: "var(--text-muted)" }}>
                  <Receipt className="w-8 h-8 opacity-50" />
                  <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                    No student selected.
                  </p>
                  <p className="text-sm">
                    Pick a student from the list to see their ledger. A payment is always recorded
                    against a named student, so nothing can be recorded until you choose one.
                  </p>
                </div>
              )}
            </section>
          </div>
        )}

        {tab === "pending" && <PendingTab />}

        {tab === "collections" && <CollectionsTab students={students} />}

        {tab === "extras" && <ExtraFeeSheet />}

        {tab === "import" && <LedgerImport />}
          </>
        )}
      </div>

      <RecordPaymentSheet studentId={activeStudentId} studentName={activeStudent?.name} balanceDuePaise={activeStudent?.balance_due} />
      <GenerateInvoiceSheet studentId={activeStudentId} studentName={activeStudent?.name} />
    </div>
  );
}

/**
 * Collections — what the tutor scans for at month end: who owes, what is held on
 * account, and how many students are in scope.
 *
 * Every figure below is derived from the roster this screen already read live, and
 * every label names exactly what it measures.
 *
 * DELETED, deliberately:
 *   · A tile labelled "Collected This Month" that summed every NEGATIVE balance.
 *     That is a credit total across all time, so it was the wrong number under the
 *     right words — and the Dashboard's "Collected" KPI is a different measure
 *     again, from a different query. The real collection figure for a period is
 *     `collectedForMonth()` (BR-CALC-10, `packages/shared/src/feeCalc.ts`), which
 *     reads each student's ledger. The web client cannot compute it without one
 *     gateway round trip per student, so the tile is gone rather than renamed into
 *     a different lie. Reinstating it belongs with the gateway aggregate — see the
 *     worklog.
 *   · The "Collection Heatmap". It read `financial` off
 *     `GET /api/v1/analytics/dashboard`, which returns `{kpis, activity, dueToday,
 *     dataOrigin}` and has never carried that field — so the panel was permanently
 *     empty and rendered "No collection data for this month yet", an authoritative
 *     emptiness over a read that could not succeed. Dead UI, dead request: removed.
 *     Its month boundaries also used `toISOString()`, which shifts the 1st into the
 *     previous day east of UTC — gone with the query.
 */
function CollectionsTab({ students }: { students: StudentRow[] }) {
  // Rule 6 / BR-M-01: paise helpers only — no `+`/`-` on money (§14 #3).
  const dueTillDate = students.reduce(
    (acc, s) => (s.balance_due > 0 ? paiseAdd(acc, s.balance_due) : acc),
    0
  );
  const creditOnAccount = students.reduce(
    (acc, s) => (s.balance_due < 0 ? paiseAdd(acc, paiseSub(0, s.balance_due)) : acc),
    0
  );
  const studentsWithDues = students.filter((s) => s.balance_due > 0).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-panel p-5 rounded-xl flex flex-col justify-between" style={{ border: "1px solid color-mix(in srgb, var(--danger) 25%, transparent)" }}>
          <div className="flex items-center gap-2 mb-2" style={{ color: "var(--text-secondary)" }}>
            <AlertCircle className="w-4 h-4" aria-hidden="true" />
            <span className="text-xs uppercase tracking-wider font-semibold">Due Till Date</span>
          </div>
          <p className="text-2xl font-bold num" style={{ color: "var(--text-primary)" }}>{formatINR(dueTillDate)}</p>
        </div>
        <div className="glass-panel p-5 rounded-xl flex flex-col justify-between" style={{ border: "1px solid color-mix(in srgb, var(--info) 25%, transparent)" }}>
          <div className="flex items-center gap-2 mb-2" style={{ color: "var(--text-secondary)" }}>
            <HandCoins className="w-4 h-4" aria-hidden="true" />
            <span className="text-xs uppercase tracking-wider font-semibold">Credit On Account</span>
          </div>
          <p className="text-2xl font-bold num" style={{ color: "var(--text-primary)" }}>{formatINR(creditOnAccount)}</p>
        </div>
        <div className="glass-panel p-5 rounded-xl flex flex-col justify-between" style={{ border: "1px solid color-mix(in srgb, var(--warning) 25%, transparent)" }}>
          <div className="flex items-center gap-2 mb-2" style={{ color: "var(--text-secondary)" }}>
            <Wallet className="w-4 h-4" aria-hidden="true" />
            <span className="text-xs uppercase tracking-wider font-semibold">Students With Dues</span>
          </div>
          <p className="text-2xl font-bold num" style={{ color: "var(--text-primary)" }}>{studentsWithDues}</p>
        </div>
        <div className="glass-panel p-5 rounded-xl flex flex-col justify-between" style={{ border: "1px solid color-mix(in srgb, var(--success) 25%, transparent)" }}>
          <div className="flex items-center gap-2 mb-2" style={{ color: "var(--text-secondary)" }}>
            <Users className="w-4 h-4" aria-hidden="true" />
            <span className="text-xs uppercase tracking-wider font-semibold">Students In Scope</span>
          </div>
          <p className="text-2xl font-bold num" style={{ color: "var(--text-primary)" }}>{students.length}</p>
        </div>
      </div>

      <div className="glass-panel rounded-xl p-6">
        <h2 className="text-lg font-medium mb-2" style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
          Where To Collect
        </h2>
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          These are live balances, read now — not what has been collected this month.
          Payment history per student is on the Ledger tab.
        </p>
        {students.length === 0 ? (
          <p className="text-sm py-6 text-center" style={{ color: "var(--text-muted)" }}>
            No students yet. Add a student and their dues appear here.
          </p>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border-default)" }}>
            {[...students]
              .filter((s) => s.balance_due !== 0)
              // Ordered by comparison, not by arithmetic on money (Rule 6): the
              // biggest outstanding first, credits last.
              .sort((a, b) => (b.balance_due > a.balance_due ? 1 : b.balance_due < a.balance_due ? -1 : 0))
              .map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-4 py-3">
                  <span className="min-w-0 truncate text-sm" style={{ color: "var(--text-primary)" }}>
                    {s.name}
                  </span>
                  <BalanceStatusChip balanceDuePaise={s.balance_due} />
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}
