"use client";

// Implements: 05_Students.md §6.4 (Detail Drawer — profile, ledger, invoices,
// attendance) + §9.4 (Invoices by Student, `paid_amount_minor` per period);
// AGENTS.md §2 Rule 9 (no silent failures — a failed invoice read is NEVER an
// empty one), Rule 6 (integer paise via `paiseAdd`/`paiseSub`, never `+`/`-`),
// Rule 10 + 13_UI_Guidelines.md §10 (a real tablist: one tab stop, arrow /
// Home / End movement, each tab owning a panel); 07_Fees_and_Payments.md §6.3
// (per-student immutable ledger via `LedgerTable`); 14_Edge_Cases.md EC-F-02
// (a read that failed must not read as "nothing owed").
//
// Every invoice-derived figure on this surface comes from ONE read
// (`getStudentInvoices`). Two invariants hold everywhere below:
//   1. Nothing derived from that read is rendered unless the read SUCCEEDED —
//      the query resolves a `{success:false}` envelope instead of throwing, so
//      React Query's `isError` never fires for it (see `FeeHistoryFailure`).
//   2. Each quantity appears once. The month counts live in the Fee Period
//      Summary only; the header owns the balance; the metric strip owns the
//      plan figure a tutor acts on. Restating a number under a second label is
//      how two of them drifted apart silently.

import React, { useRef, useState } from "react";
import {
  User,
  IndianRupee,
  FileText,
  CalendarCheck,
  Trash2,
  AlertTriangle,
  Phone,
  CalendarDays,
  X,
  Mail,
  Building2,
  GraduationCap,
  Cake,
  Users,
  MapPin,
} from "lucide-react";
import {
  type Student,
  type StudentListRow,
  formatINR,
  paiseAdd,
  paiseSub,
} from "@buddysaradhi/shared";
import { AttendanceTab } from "./attendance-tab";
import { RecordPaymentButton } from "./record-payment-button";
import { Avatar } from "@/components/ui/avatar";
import { useStudentsStore } from "@/stores/students-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchStudentDetailAction } from "@/server/actions/students";
import { getStudentInvoices } from "@/server/queries/ledger";
import { toAppErrorState } from "@/lib/app-errors";
import { log } from "@/lib/logger";
import { LedgerTable } from "../fees/ledger-table";
import { deleteStudentAction } from "@/server/actions/students";
import { useToast } from "@/components/ui/toast";
import { useOverlayDismiss } from "@/components/ui/overlay";
import { ErrorState } from "@/components/ui/screen-state";

type TabKey = "overview" | "ledger" | "fees" | "attendance";

/** The invoice row the drawer's money figures are derived from. */
type InvoiceRows = Awaited<ReturnType<typeof getStudentInvoices>>["data"];
type InvoiceRow = InvoiceRows[number];

/**
 * The gateway types `paid_amount_minor` as a number, but a row that arrives
 * without one must not poison `paiseAdd`'s safe-integer guard (which throws, by
 * design — Rule 6). Coerced ONCE here so the header, the breakdown and the
 * invoice list all read the same value.
 */
function paidOf(inv: InvoiceRow): number {
  return inv.paid_amount_minor || 0;
}

/**
 * The drawer renders dates as `dd Mon yyyy` in the tutor's locale (en-IN), and
 * renders nothing for an absent date so `IdentityField` shows its em dash. Two
 * call sites, so one formatter — `toLocaleDateString` with a fresh options
 * object was duplicated inline, and `new Date(iso)` on an unvalidated string is
 * an Invalid Date if the field ever arrives malformed (13_UI_Guidelines.md §7.1
 * — an empty state is a state, not an exception).
 */
function formatDayMonthYear(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * The invoice read's failure surface — one shape for both tabs that read it.
 *
 * `getStudentInvoices` RESOLVES `{success:false, data:[], error}` rather than
 * throwing, so React Query never sees a rejection and `isError` stays false.
 * Every consumer therefore has to read the envelope; this module concentrates
 * the retry wiring and the "nothing was written" sentence so the two tabs
 * cannot drift into telling a tutor different things about the same failure.
 * (`codebase-design` deletion test: delete it and the refetch pair plus the
 * data-status sentence reappear inline at each call site.)
 */
function FeeHistoryFailure({
  error,
  onRetry,
  isRetrying,
  consequence,
}: {
  error: string;
  onRetry: () => void;
  isRetrying: boolean;
  consequence: string;
}) {
  return (
    <ErrorState
      state={toAppErrorState(error)}
      onRetry={onRetry}
      isRetrying={isRetrying}
      retryLabel="Load fee history again"
      dataStatus={consequence}
    />
  );
}

const TABS: { id: TabKey; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <User className="w-4 h-4" /> },
  { id: "ledger", label: "Ledger", icon: <FileText className="w-4 h-4" /> },
  { id: "fees", label: "Fees", icon: <IndianRupee className="w-4 h-4" /> },
  { id: "attendance", label: "Attendance", icon: <CalendarCheck className="w-4 h-4" /> },
];

interface StudentDetailDrawerProps {
  selectedRow?: StudentListRow;
}

export function StudentDetailDrawer({ selectedRow }: StudentDetailDrawerProps) {
  const { selectedStudentId, closeDrawer } = useStudentsStore();
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  // One tabbable stop at a time (roving tabindex) — see `onTabKeyDown`.
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  // The delete confirmation is a modal interrupt on the record's own data, so
  // it takes Escape and returns focus; there is no draft to protect.
  const deleteConfirm = useOverlayDismiss({
    open: showDeleteConfirm,
    onClose: () => setShowDeleteConfirm(false),
    label: "confirmation",
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["student", selectedStudentId],
    queryFn: () => fetchStudentDetailAction(selectedStudentId!),
    enabled: !!selectedStudentId,
    retry: 1,
  });

  const {
    data: invData,
    isLoading: invLoading,
    isFetching: invFetching,
    refetch: refetchInvoices,
  } = useQuery({
    queryKey: ["invoices", selectedStudentId],
    queryFn: () => getStudentInvoices(selectedStudentId!),
    enabled: !!selectedStudentId,
  });

  const student: Student | undefined = data?.data;

  // The invoices read failed. It did NOT return an empty list — that was the
  // defect: on a gateway timeout this surface used to render "₹0.00 collected
  // to date", "0/0 months", "Months Due 0" and "No fee periods recorded yet.",
  // Four confident statements that a tutor reads as "this student owes
  // nothing" — on the one screen whose entire job is telling them otherwise
  // (AGENTS.md §2 Rule 9; 14_Edge_Cases.md EC-F-02).
  const invoiceFailure =
    invData !== undefined && invData.success === false ? invData.error : null;
  const invoices: InvoiceRows =
    invData !== undefined && invData.success ? invData.data : [];
  /** True only when the invoice-derived figures below are facts, not guesses. */
  const feeHistoryReadable = !invLoading && invoiceFailure === null;

  // Rule 6: paise helpers only, never `+`/`-` on money (AGENTS.md §14 #3).
  const collected = invoices.reduce((sum, inv) => paiseAdd(sum, paidOf(inv)), 0);
  const billed = invoices.reduce((sum, inv) => paiseAdd(sum, inv.total), 0);

  // `balance_due` lives on the ROSTER row, not the detail row. When the drawer
  // is opened without one there is no balance to state, and the `No dues` chip
  // would be a fabricated money figure in exactly the same way the old
  // invoice-zeroes were.
  const dueKnown = selectedRow !== undefined;
  const due = selectedRow?.balance_due ?? 0;

  // Monthly fee statistics — ONE home each, rendered once in the Fee Period
  // Summary. They used to sit a second time as "Months Paid" / "Months Due"
  // metric cards, and "Months Due" restated `partial + unpaid` as a third
  // number the tutor had to reconcile against the two it was derived from.
  const monthlyFee = student?.baseFeePaise || 0;
  const paidMonths = invoices.filter((inv) => paidOf(inv) >= inv.total).length;
  const partialMonths = invoices.filter(
    (inv) => paidOf(inv) > 0 && paidOf(inv) < inv.total,
  ).length;
  const unpaidMonths = invoices.filter((inv) => paidOf(inv) === 0).length;
  const totalMonths = invoices.length;

  /**
   * Roving-tabindex keyboard support (13_UI_Guidelines.md §10), matched to
   * `fees-client.tsx`. `role="tab"` is only honest next to arrow-key movement,
   * `Home`/`End`, and exactly one tabbable stop — four `tabIndex={0}` buttons
   * is not a tablist, it is four separate links that happen to sit in a row.
   */
  const onTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const last = TABS.length - 1;
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === -1) return;
    const target = TABS[next];
    if (!target) return;
    event.preventDefault();
    setActiveTab(target.id);
    tabRefs.current[next]?.focus();
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteStudentAction(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["students"] });
      const prev = queryClient.getQueryData(["students"]);
      const current = queryClient.getQueryData<{ students: StudentListRow[] }>(["students"]);
      if (current) {
        queryClient.setQueryData(["students"], {
          ...current,
          students: current.students.filter((s) => s.id !== id),
        });
      }
      queryClient.removeQueries({ queryKey: ["student", id] });
      closeDrawer();
      setShowDeleteConfirm(false);
      return { prev };
    },
    onSuccess: () => {
      const name = student
        ? `${student.first_name} ${student.last_name ?? ""}`.trim()
        : "Student";
      toast.success(
        `${name} deleted`,
        "Their attendance, invoices and receipts went with them, and your dashboard has been recalculated.",
      );
    },
    onError: (err, _id, context) => {
      if (context?.prev) queryClient.setQueryData(["students"], context.prev);
      const mapped = toAppErrorState(err);
      setDeleteError(mapped.message);
      setShowDeleteConfirm(true);
      log.error("student_delete_failed", mapped.title);
      toast.error("Not deleted", `${mapped.message} Nothing was removed — the student is still on your roster.`);
    },
    onSettled: (_data, _err, _id) => {
      queryClient.invalidateQueries({ queryKey: ["students"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  if (!selectedStudentId) {
    return (
      <div className="glass-panel rounded-2xl h-full flex flex-col items-center justify-center text-center p-8">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
          style={{ background: "var(--surface-overlay)" }}
        >
          <User className="w-8 h-8" style={{ color: "var(--text-muted)" }} />
        </div>
        <p className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          Select a student
        </p>
        <p className="text-sm mt-1 max-w-xs" style={{ color: "var(--text-secondary)" }}>
          Choose a student from the list to view their profile, fees, ledger and attendance.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        className="glass-panel rounded-2xl h-full flex items-center justify-center"
        role="status"
        aria-live="polite"
      >
        <div
          className="w-8 h-8 border-2 rounded-full animate-spin"
          style={{
            borderColor: "var(--border-default)",
            borderTopColor: "var(--info)",
          }}
          aria-hidden="true"
        />
        <span className="sr-only">Loading student…</span>
      </div>
    );
  }

  if (isError || !student) {
    // G-ERR: never render raw server text (message, digest, stack). The mapper
    // returns static copy plus one recovery affordance per failure class.
    const state = toAppErrorState(error ?? "NOT_FOUND: student record unavailable");
    const retryDetail = () => {
      void queryClient.invalidateQueries({ queryKey: ["student", selectedStudentId] });
    };
    return (
      <div className="glass-panel rounded-2xl h-full flex flex-col items-center justify-center text-center p-8">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
          style={{ background: "var(--danger)/15", color: "var(--danger)" }}
        >
          <AlertTriangle className="w-8 h-8" aria-hidden="true" />
        </div>
        <p className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          {state.title}
        </p>
        <p className="text-sm mt-1 max-w-xs" style={{ color: "var(--text-secondary)" }}>
          {state.message}
        </p>
        <div className="mt-4 flex flex-col gap-2 w-full max-w-xs">
          {state.action === "re-login" && (
            <a
              href="/login"
              className="px-4 py-2 rounded-xl text-sm font-semibold btn-glass min-h-[44px] flex items-center justify-center"
              style={{ color: "var(--info)", borderColor: "var(--border-default)" }}
            >
              Re-login
            </a>
          )}
          {state.action === "provision" && (
            <a
              href="/login"
              className="px-4 py-2 rounded-xl text-sm font-semibold btn-glass min-h-[44px] flex items-center justify-center"
              style={{ color: "var(--info)", borderColor: "var(--border-default)" }}
            >
              Re-connect database
            </a>
          )}
          {state.action === "retry" && (
            <button
              type="button"
              onClick={retryDetail}
              className="px-4 py-2 rounded-xl text-sm font-semibold btn-glass min-h-[44px]"
              style={{ color: "var(--info)", borderColor: "var(--border-default)" }}
            >
              Retry
            </button>
          )}
          <button
            type="button"
            onClick={closeDrawer}
            className="px-4 py-2 rounded-xl text-sm font-semibold btn-glass min-h-[44px]"
            style={{ color: "var(--text-secondary)", borderColor: "var(--border-default)" }}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const fullName = `${student.first_name} ${student.last_name ?? ""}`.trim();
  const subtitle =
    [student.grade, student.board ?? student.school]
      .filter(Boolean)
      .join(" · ") || "—";

  const handleDelete = () => {
    if (deleteMutation.isPending) return;
    deleteMutation.mutate(student.id);
  };

  return (
    <div
      key={student.id}
      className="glass-panel rounded-2xl h-full flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex-none p-6 border-b border-[var(--border-default)]">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4 min-w-0">
            <Avatar name={fullName} id={student.id} size="lg" />
            <div className="min-w-0">
              <h2
                className="text-2xl font-bold truncate"
                style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}
              >
                {fullName}
              </h2>
              <p className="text-sm mt-1 truncate" style={{ color: "var(--text-secondary)" }}>
                {subtitle}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDeleteError(null);
                setShowDeleteConfirm(true);
              }}
              aria-label="Delete student"
              className="p-2 -mr-2 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              style={{ color: "var(--danger)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--danger)/10")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <Trash2 className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={closeDrawer}
              aria-label="Close student detail"
              className="p-2 -mr-2 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              style={{ color: "var(--text-muted)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* One financial headline, one secondary figure. This used to be three chips
            (Due / Collected / Monthly) sitting directly above four metric cards
            that repeated Collected and Monthly a second time — the same three
            numbers, twice, in two visual languages, with no stated priority.
            What a tutor opens this drawer for is the outstanding amount, so it is
            the dominant figure and the rest is one line of supporting text.

            Neither figure is allowed to assert a number it does not have. The
            balance comes from the roster row and is absent when the drawer is
            opened without one; "collected to date" is only stated once the
            invoice read has succeeded (Rule 9). */}
        <div className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {due > 0 ? (
            <>
              <span
                className="num text-2xl font-bold"
                style={{ color: "var(--warning)" }}
              >
                {formatINR(due)}
              </span>
              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                outstanding
              </span>
            </>
          ) : dueKnown ? (
            <span className="chip chip-success">
              <span className="chip-dot" aria-hidden="true" />
              No dues
            </span>
          ) : (
            <span className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
              Balance unavailable
            </span>
          )}
          <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {feeHistoryReadable
              ? `${formatINR(collected)} collected to date`
              : invLoading
                ? "Reading fee history…"
                : "Fee history not loaded — open the Fees tab"}
          </span>
        </div>
      </div>

      {/* Tabs — a real tablist (13_UI_Guidelines.md §10), matched to
          `fees-client.tsx`: the role sits on the element that OWNS the tabs, each
          tab points at the panel it controls, only the active tab is in the tab
          order, and arrows/Home/End move between them. */}
      <div className="flex-none px-3 border-b border-[var(--border-default)] overflow-x-auto no-scrollbar">
        <div
          className="flex gap-1 min-w-max"
          role="tablist"
          aria-label="Student detail sections"
        >
          {TABS.map((tab, index) => (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              id={`student-tab-${tab.id}`}
              type="button"
              role="tab"
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(e) => onTabKeyDown(e, index)}
              aria-selected={activeTab === tab.id}
              aria-controls={`student-panel-${activeTab}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all border-b-2 ${
                activeTab === tab.id
                  ? "border-[var(--accent-primary)]"
                  : "border-transparent"
              }`}
              style={{
                color:
                  activeTab === tab.id ? "var(--accent-primary)" : "var(--text-secondary)",
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content — one panel, labelled by its own tab. */}
      <div
        className="flex-1 overflow-y-auto p-6"
        role="tabpanel"
        id={`student-panel-${activeTab}`}
        aria-labelledby={`student-tab-${activeTab}`}
        tabIndex={0}
      >
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* The plan figure a tutor acts on, and everything ever invoiced —
                the one number that reconciles against the header's "collected".
                The month counts deliberately live in the breakdown below and
                nowhere else; they used to be restated here as "Months Paid" and
                "Months Due", the latter re-deriving `partial + unpaid` a third
                time. */}
            <div className="grid grid-cols-2 gap-4">
              <MetricCard
                title="Monthly Fee"
                value={formatINR(monthlyFee)}
                icon={<IndianRupee className="w-5 h-5" />}
                accent="var(--info)"
              />
              <MetricCard
                title="Billed to date"
                value={feeHistoryReadable ? formatINR(billed) : "—"}
                icon={<FileText className="w-5 h-5" />}
                accent="var(--accent-primary)"
              />
            </div>

            {/* Identity */}
            <div
              className="p-5 rounded-xl border space-y-4"
              style={{
                background: "var(--surface-inset)",
                borderColor: "var(--border-default)",
              }}
            >
              <h3
                className="text-sm font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-secondary)" }}
              >
                Identity
              </h3>
              <div className="grid grid-cols-2 gap-y-4 gap-x-3">
                <IdentityField icon={<Phone className="w-4 h-4" />} label="Phone" value={student.phone} />
                <IdentityField icon={<Mail className="w-4 h-4" />} label="Email" value={student.email} />
                <IdentityField icon={<Building2 className="w-4 h-4" />} label="School" value={student.school} />
                <IdentityField icon={<GraduationCap className="w-4 h-4" />} label="Board" value={student.board} />
                <IdentityField icon={<GraduationCap className="w-4 h-4" />} label="Grade" value={student.grade} />
                <IdentityField
                  icon={<Cake className="w-4 h-4" />}
                  label="DOB"
                  value={formatDayMonthYear(student.dob)}
                />
                <IdentityField icon={<Users className="w-4 h-4" />} label="Gender" value={student.gender} />
                <IdentityField
                  icon={<CalendarDays className="w-4 h-4" />}
                  label="Admission"
                  value={formatDayMonthYear(student.admission_date)}
                />
              </div>
              <IdentityField
                icon={<MapPin className="w-4 h-4" />}
                label="Address"
                value={student.address}
              />
            </div>

            {/* Fee Period Summary — the single home of the four month counts, and
                the one place in the drawer that is allowed to say them at all
                when the read behind them failed. */}
            <div
              className="p-5 rounded-xl border space-y-4"
              style={{
                background: "var(--surface-inset)",
                borderColor: "var(--border-default)",
              }}
            >
              <h3
                className="text-sm font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-secondary)" }}
              >
                Fee Period Summary
              </h3>
              {invoiceFailure ? (
                <FeeHistoryFailure
                  error={invoiceFailure}
                  onRetry={() => {
                    void refetchInvoices();
                  }}
                  isRetrying={invFetching}
                  consequence={`Nothing was changed and nothing was written to ${fullName}'s account. These counts are unknown, not zero — a failed read looks exactly like an empty one, so do not read "no short months" here.`}
                />
              ) : invLoading ? (
                <p role="status" className="text-sm py-2" style={{ color: "var(--text-muted)" }}>
                  Reading fee history…
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <StatItem label="Total Periods" value={totalMonths} accent="var(--info)" />
                  <StatItem label="Paid" value={paidMonths} accent="var(--success)" />
                  <StatItem label="Partial" value={partialMonths} accent="var(--warning)" />
                  <StatItem label="Unpaid" value={unpaidMonths} accent="var(--danger)" />
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "ledger" && student.id && (
          <LedgerTable studentId={student.id} studentName={fullName} />
        )}

        {activeTab === "fees" && student.id && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium" style={{ color: "var(--text-primary)" }}>
                Fee Schedule
              </h3>
              <RecordPaymentButton studentId={student.id} studentName={fullName} />
            </div>

            {invoiceFailure ? (
              <FeeHistoryFailure
                error={invoiceFailure}
                onRetry={() => {
                  void refetchInvoices();
                }}
                isRetrying={invFetching}
                consequence={`Nothing was changed and no invoice or payment was written. An empty list and a failed read look identical here, so do not charge a fee or record a payment against ${fullName} until this list has loaded.`}
              />
            ) : invLoading ? (
              <p
                role="status"
                className="p-8 rounded-xl text-center border text-sm"
                style={{
                  background: "var(--surface-inset)",
                  borderColor: "var(--border-default)",
                  color: "var(--text-muted)",
                }}
              >
                Reading fee periods…
              </p>
            ) : invoices.length === 0 ? (
              <div
                className="p-8 rounded-xl text-center border"
                style={{
                  background: "var(--surface-inset)",
                  borderColor: "var(--border-default)",
                }}
              >
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  No fee periods recorded yet.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {invoices.map((inv) => {
                  const paid = paidOf(inv);
                  // Rule 6: paise helpers, never `-` on money (§14 checklist #3).
                  const outstanding = paiseSub(inv.total, paid);
                  const state =
                    paid >= inv.total
                      ? "Paid"
                      : paid > 0
                      ? "Partial"
                      : "Unpaid";
                  const chipClass =
                    state === "Paid"
                      ? "chip-success"
                      : state === "Partial"
                      ? "chip-warning"
                      : "chip-danger";
                  return (
                    <li
                      key={inv.id}
                      className="flex items-center justify-between p-4 rounded-xl border"
                      style={{
                        background: "var(--surface-inset)",
                        borderColor: "var(--border-default)",
                      }}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                          {inv.number}
                        </p>
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {inv.issue_date
                            ? new Date(inv.issue_date).toLocaleDateString("en-IN", {
                                month: "short",
                                year: "numeric",
                              })
                            : ""}
                          {inv.due_date
                            ? ` · due ${new Date(inv.due_date).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                              })}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="num text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                            {formatINR(inv.total)}
                          </div>
                          {outstanding > 0 && (
                            <div className="num text-xs" style={{ color: "var(--text-muted)" }}>
                              {formatINR(outstanding)} due
                            </div>
                          )}
                        </div>
                        <span className={`chip ${chipClass}`}>{state}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {activeTab === "attendance" && student.id && (
          <AttendanceTab studentId={student.id} studentName={fullName} />
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0" onClick={deleteConfirm.onScrimClick} aria-hidden="true" />
          <div
            ref={deleteConfirm.panelRef}
            role="alertdialog"
            aria-modal="true"
            aria-label="Delete student"
            tabIndex={-1}
            className="relative glass-strong border border-[var(--border-default)] rounded-2xl w-full max-w-md p-6"
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
                style={{
                  background: "color-mix(in srgb, var(--danger) 15%, transparent)",
                  color: "var(--danger)",
                }}
              >
                <AlertTriangle className="w-6 h-6" aria-hidden="true" />
              </div>
              <h3 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                Delete {fullName}?
              </h3>
            </div>
            <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
              Their attendance records, invoices, ledger entries and receipts are deleted with them.
              The number is consumed, never reused, so an old receipt can never be reissued.
            </p>
            <p
              className="text-xs mb-6 p-3 rounded-lg"
              style={{ background: "color-mix(in srgb, var(--warning) 12%, transparent)", color: "var(--warning)" }}
            >
              This rewrites your month totals and cannot be undone. Consider voiding a mistaken payment
              instead, which leaves the history intact.
            </p>
            {deleteError && (
              <p role="alert" className="text-xs mb-4 text-center" style={{ color: "var(--danger)" }}>
                {deleteError}
              </p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 min-h-[44px] px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
              >
                Keep {student.first_name.split(" ")[0]}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                aria-busy={deleteMutation.isPending}
                className="flex-1 min-h-[44px] px-4 py-2 rounded-xl text-sm font-semibold"
                style={{
                  background: "color-mix(in srgb, var(--danger) 18%, transparent)",
                  color: "var(--danger)",
                  border: "1px solid color-mix(in srgb, var(--danger) 40%, transparent)",
                }}
              >
                {deleteMutation.isPending ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  title,
  value,
  icon,
  accent,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div
      className="glass p-4 rounded-xl flex flex-col justify-between transition-all hover:bg-[var(--surface-raised)]"
      style={{ border: `1px solid color-mix(in srgb, ${accent} 25%, transparent)` }}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">{title}</p>
        <div className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ backgroundColor: `color-mix(in srgb, ${accent} 15%, transparent)`, color: accent }}>
          {icon}
        </div>
      </div>
      <p className="text-xl font-bold text-[var(--text-primary)] tracking-tight num">{value}</p>
    </div>
  );
}

function IdentityField({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5" style={{ color: "var(--text-muted)" }}>{icon}</div>
      <div className="min-w-0">
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          {label}
        </div>
        <div className="text-sm break-words" style={{ color: "var(--text-primary)" }}>
          {value ? value : "—"}
        </div>
      </div>
    </div>
  );
}

function StatItem({ label, value, accent = "var(--text-primary)" }: { label: string; value: number; accent?: string }) {
  return (
    <div className="p-3 rounded-lg" style={{ background: "var(--surface-inset)" }}>
      <div className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="num text-2xl font-bold mt-1" style={{ color: accent }}>{value}</div>
    </div>
  );
}