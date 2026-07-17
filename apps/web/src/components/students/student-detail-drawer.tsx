"use client";

import React, { useState } from "react";
import {
  User,
  IndianRupee,
  FileText,
  CalendarCheck,
  BarChart3,
  X,
  Phone,
  CalendarDays,
} from "lucide-react";
import { type Student, type StudentListRow, formatINR } from "@buddysaradhi/shared";
import { AttendanceTab } from "./attendance-tab";
import { RecordPaymentButton } from "./record-payment-button";
import { studentAccent } from "./student-master-list";
import { useStudentsStore } from "@/stores/students-store";
import { useQuery } from "@tanstack/react-query";
import { fetchStudentDetailAction } from "@/server/actions/students";
import { getStudentInvoices } from "@/server/queries/ledger";
import { LedgerTable } from "../fees/ledger-table";

type TabKey = "overview" | "ledger" | "fees" | "attendance" | "reports";

const TABS: { id: TabKey; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <User className="w-4 h-4" /> },
  { id: "ledger", label: "Ledger", icon: <FileText className="w-4 h-4" /> },
  { id: "fees", label: "Fees", icon: <IndianRupee className="w-4 h-4" /> },
  { id: "attendance", label: "Attendance", icon: <CalendarCheck className="w-4 h-4" /> },
  { id: "reports", label: "Reports", icon: <BarChart3 className="w-4 h-4" /> },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface StudentDetailDrawerProps {
  selectedRow?: StudentListRow;
}

export function StudentDetailDrawer({ selectedRow }: StudentDetailDrawerProps) {
  const { selectedStudentId, closeDrawer } = useStudentsStore();
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  const { data, isLoading } = useQuery({
    queryKey: ["student", selectedStudentId],
    queryFn: () => fetchStudentDetailAction(selectedStudentId!),
    enabled: !!selectedStudentId,
  });

  const { data: invData } = useQuery({
    queryKey: ["invoices", selectedStudentId],
    queryFn: () => getStudentInvoices(selectedStudentId!),
    enabled: !!selectedStudentId,
  });

  const student: Student | undefined = data?.data;
  const invoices = invData?.data ?? [];
  const collected = invoices.reduce(
    (sum, inv) => sum + (inv.paid_amount_minor || 0),
    0
  );
  const due = selectedRow?.balance_due ?? 0;

  if (!selectedStudentId) {
    return (
      <div className="glass-panel rounded-2xl h-full flex flex-col items-center justify-center text-center p-8">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
          style={{ background: "var(--surface-glass-strong)" }}
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

  if (isLoading || !student) {
    return (
      <div className="glass-panel rounded-2xl h-full flex items-center justify-center">
        <div
          className="w-8 h-8 border-2 rounded-full animate-spin"
          style={{
            borderColor: "var(--border-glass)",
            borderTopColor: "var(--accent-cyan)",
          }}
        />
      </div>
    );
  }

  const accent = studentAccent(student.id);
  const fullName = `${student.first_name} ${student.last_name ?? ""}`.trim();
  const subtitle =
    [student.grade, student.board ?? student.school]
      .filter(Boolean)
      .join(" · ") || "—";

  return (
    <div
      key={student.id}
      className="glass-panel rounded-2xl h-full flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex-none p-6 border-b border-[var(--border-glass)]">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4 min-w-0">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center font-bold text-xl shrink-0"
              style={{
                background: `color-mix(in srgb, var(--accent-${accent}) 18%, var(--bg-surface-raised))`,
                color: `var(--accent-${accent})`,
                border: `2px solid color-mix(in srgb, var(--accent-${accent}) 40%, transparent)`,
              }}
              aria-hidden="true"
            >
              {initials(fullName)}
            </div>
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
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Close student detail"
            className="p-2 -mr-2 rounded-lg transition-colors"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Due + Collected chips */}
        <div className="flex flex-wrap gap-3 mt-5">
          {due > 0 ? (
            <span
              className="chip chip-warning num"
              title="Outstanding dues"
            >
              <IndianRupee className="w-3.5 h-3.5" aria-hidden="true" />
              Due: {formatINR(due)}
            </span>
          ) : (
            <span className="chip chip-success" title="No dues">
              <IndianRupee className="w-3.5 h-3.5" aria-hidden="true" />
              No dues
            </span>
          )}
          <span className="chip chip-success num" title="Total collected">
            <IndianRupee className="w-3.5 h-3.5" aria-hidden="true" />
            Collected: {formatINR(collected)}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-none px-3 border-b border-[var(--border-glass)] overflow-x-auto no-scrollbar">
        <div className="flex gap-1 min-w-max">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              aria-selected={activeTab === tab.id}
              role="tab"
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === "overview" && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div
                className="p-4 rounded-xl border"
                style={{
                  background: "var(--bg-surface-inset)",
                  borderColor: "var(--border-default)",
                }}
              >
                <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
                  Due
                </div>
                <div className="num text-lg font-semibold" style={{ color: "var(--accent-warning)" }}>
                  {formatINR(due)}
                </div>
              </div>
              <div
                className="p-4 rounded-xl border"
                style={{
                  background: "var(--bg-surface-inset)",
                  borderColor: "var(--border-default)",
                }}
              >
                <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
                  Collected
                </div>
                <div className="num text-lg font-semibold" style={{ color: "var(--accent-success)" }}>
                  {formatINR(collected)}
                </div>
              </div>
              <div
                className="p-4 rounded-xl border"
                style={{
                  background: "var(--bg-surface-inset)",
                  borderColor: "var(--border-default)",
                }}
              >
                <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
                  Monthly Fee
                </div>
                <div className="num text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                  {formatINR(student.baseFeePaise || 0)}
                </div>
              </div>
            </div>

            <div
              className="p-5 rounded-xl border space-y-4"
              style={{
                background: "var(--surface-glass-faint)",
                borderColor: "var(--border-default)",
              }}
            >
              <h3
                className="text-sm font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-secondary)" }}
              >
                Identity
              </h3>
              <div className="grid grid-cols-2 gap-y-4">
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
                  <div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Phone
                    </div>
                    <div className="text-sm" style={{ color: "var(--text-primary)" }}>
                      {student.phone || "—"}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
                  <div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Admission
                    </div>
                    <div className="text-sm" style={{ color: "var(--text-primary)" }}>
                      {student.admission_date
                        ? new Date(student.admission_date).toLocaleDateString("en-IN", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </div>
                  </div>
                </div>
              </div>
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

            {invoices.length === 0 ? (
              <div
                className="p-8 rounded-xl text-center border"
                style={{
                  background: "var(--bg-surface-inset)",
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
                  const paid = inv.paid_amount_minor || 0;
                  const outstanding = inv.total - paid;
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
                        background: "var(--bg-surface-inset)",
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
          <AttendanceTab studentId={student.id} />
        )}

        {activeTab === "reports" && (
          <div className="h-full flex flex-col items-center justify-center text-center py-12">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mb-4"
              style={{ background: "var(--bg-surface-inset)" }}
            >
              <BarChart3 className="w-6 h-6" style={{ color: "var(--text-muted)" }} />
            </div>
            <h3 className="text-lg font-medium" style={{ color: "var(--text-primary)" }}>
              Reports
            </h3>
            <p className="text-sm text-[var(--text-muted)] mt-2 max-w-[250px]">
              Progress and performance reports are coming in a future phase.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
