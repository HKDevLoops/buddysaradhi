"use client";

import React, { useState } from "react";
import {
  User,
  IndianRupee,
  FileText,
  CalendarCheck,
  Trash2,
  AlertTriangle,
  Phone,
  CalendarDays,
  Calendar,
  CheckCircle,
  XCircle,
  X,
  TrendingUp,
  Mail,
  Building2,
  GraduationCap,
  Cake,
  Users,
  MapPin,
} from "lucide-react";
import { type Student, type StudentListRow, formatINR } from "@buddysaradhi/shared";
import { AttendanceTab } from "./attendance-tab";
import { RecordPaymentButton } from "./record-payment-button";
import { studentAccent } from "./student-master-list";
import { useStudentsStore } from "@/stores/students-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchStudentDetailAction } from "@/server/actions/students";
import { getStudentInvoices } from "@/server/queries/ledger";
import { LedgerTable } from "../fees/ledger-table";
import { deleteStudentAction } from "@/server/actions/students";
import { cn } from "@/lib/utils";

type TabKey = "overview" | "ledger" | "fees" | "attendance";

const TABS: { id: TabKey; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <User className="w-4 h-4" /> },
  { id: "ledger", label: "Ledger", icon: <FileText className="w-4 h-4" /> },
  { id: "fees", label: "Fees", icon: <IndianRupee className="w-4 h-4" /> },
  { id: "attendance", label: "Attendance", icon: <CalendarCheck className="w-4 h-4" /> },
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const queryClient = useQueryClient();

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

  // Monthly fee statistics
  const monthlyFee = student?.baseFeePaise || 0;
  const paidMonths = invoices.filter(inv => (inv.paid_amount_minor || 0) >= inv.total).length;
  const partialMonths = invoices.filter(inv => (inv.paid_amount_minor || 0) > 0 && (inv.paid_amount_minor || 0) < inv.total).length;
  const unpaidMonths = invoices.filter(inv => (inv.paid_amount_minor || 0) === 0).length;
  const totalMonths = invoices.length;
  const currentDueMonths = invoices.filter(inv => (inv.paid_amount_minor || 0) < inv.total).length;

  // Delete mutation — fully optimistic with rollback
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
    onError: (err, _id, context) => {
      if (context?.prev) queryClient.setQueryData(["students"], context.prev);
      setShowDeleteConfirm(true);
      alert(err instanceof Error ? err.message : "Failed to delete student");
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              aria-label="Delete student"
              className="p-2 -mr-2 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              style={{ color: "var(--accent-flare)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-flare)/10")}
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

        {/* Due + Collected + Monthly Fee chips */}
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
          <span className="chip chip-info num" title="Monthly fee">
            <IndianRupee className="w-3.5 h-3.5" aria-hidden="true" />
            Monthly: {formatINR(monthlyFee)}
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
            {/* Key Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                title="Monthly Fee"
                value={formatINR(monthlyFee)}
                icon={<IndianRupee className="w-5 h-5" />}
                accent="var(--accent-cyan)"
              />
              <MetricCard
                title="Months Paid"
                value={paidMonths}
                icon={<CheckCircle className="w-5 h-5" />}
                accent="var(--accent-emerald)"
                trend={{ dir: "up", label: `${paidMonths}/${totalMonths} months` }}
              />
              <MetricCard
                title="Months Due"
                value={currentDueMonths}
                icon={<XCircle className="w-5 h-5" />}
                accent="var(--accent-flare)"
                trend={{ dir: "down", label: `${currentDueMonths} outstanding` }}
              />
              <MetricCard
                title="Total Collected"
                value={formatINR(collected)}
                icon={<IndianRupee className="w-5 h-5" />}
                accent="var(--accent-emerald)"
              />
            </div>

            {/* Identity */}
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
              <div className="grid grid-cols-2 gap-y-4 gap-x-3">
                <IdentityField icon={<Phone className="w-4 h-4" />} label="Phone" value={student.phone} />
                <IdentityField icon={<Mail className="w-4 h-4" />} label="Email" value={(student as any).email} />
                <IdentityField icon={<Building2 className="w-4 h-4" />} label="School" value={(student as any).school} />
                <IdentityField icon={<GraduationCap className="w-4 h-4" />} label="Board" value={(student as any).board} />
                <IdentityField icon={<GraduationCap className="w-4 h-4" />} label="Grade" value={(student as any).grade} />
                <IdentityField
                  icon={<Cake className="w-4 h-4" />}
                  label="DOB"
                  value={(student as any).dob ? new Date((student as any).dob).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" }) : undefined}
                />
                <IdentityField icon={<Users className="w-4 h-4" />} label="Gender" value={(student as any).gender} />
                <IdentityField
                  icon={<CalendarDays className="w-4 h-4" />}
                  label="Admission"
                  value={student.admission_date ? new Date(student.admission_date).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" }) : undefined}
                />
              </div>
              <IdentityField
                icon={<MapPin className="w-4 h-4" />}
                label="Address"
                value={(student as any).address}
                block
              />
            </div>

            {/* Fee Period Summary */}
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
                Fee Period Summary
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <StatItem label="Total Periods" value={totalMonths} accent="var(--accent-cyan)" />
                <StatItem label="Paid" value={paidMonths} accent="var(--accent-emerald)" />
                <StatItem label="Partial" value={partialMonths} accent="var(--accent-amber)" />
                <StatItem label="Unpaid" value={unpaidMonths} accent="var(--accent-flare)" />
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
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-[#0C081A]/80 backdrop-blur-sm"
            onClick={() => setShowDeleteConfirm(false)}
          />
          <div className="relative glass-strong border border-[var(--border-default)] rounded-2xl w-full max-w-md shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "var(--accent-flare)/15", color: "var(--accent-flare)" }}>
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                Delete Student?
              </h3>
            </div>
            <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
              This will permanently delete <strong>{fullName}</strong> and all their
              attendance records, fee history, ledger entries, and receipts.
              This action cannot be undone.
            </p>
            <p className="text-xs mb-6 p-3 rounded-lg" style={{ background: "var(--accent-flare)/10", color: "var(--accent-flare)" }}>
              Dashboard totals and fee reports will be recalculated after deletion.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="btn-glass px-4 py-2 rounded-xl text-sm font-semibold flex-1"
                style={{ color: "var(--text-secondary)", borderColor: "var(--border-glass)" }}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="btn-glass px-4 py-2 rounded-xl text-sm font-semibold flex-1 min-h-[44px]"
                style={{ background: "var(--accent-flare)/15", color: "var(--accent-flare)", borderColor: "var(--accent-flare)/30" }}
              >
                {deleteMutation.isPending ? "Deleting…" : "Delete Permanently"}
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
  trend,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  accent: string;
  trend?: { dir: "up" | "down" | "flat"; label: string };
}) {
  return (
    <div
      className="glass p-4 rounded-xl flex flex-col justify-between transition-all hover:bg-[var(--surface-glass)]"
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
      {trend && (
        <p className={cn("text-xs mt-1 flex items-center gap-1 num",
          trend.dir === "up" && "text-[var(--accent-success)]",
          trend.dir === "down" && "text-[var(--accent-danger)]",
          trend.dir === "flat" && "text-[var(--text-muted)]")}>
          {trend.dir === "up" && <TrendingUp className="w-3 h-3" />}
          {trend.label}
        </p>
      )}
    </div>
  );
}

function IdentityField({ icon, label, value, block = false }: { icon: React.ReactNode; label: string; value: string | null | undefined; block?: boolean }) {
  return (
    <div className={`flex items-start gap-2 ${block ? "" : ""}`}>
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
    <div className="p-3 rounded-lg" style={{ background: "var(--bg-surface-inset)" }}>
      <div className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="num text-2xl font-bold mt-1" style={{ color: accent }}>{value}</div>
    </div>
  );
}