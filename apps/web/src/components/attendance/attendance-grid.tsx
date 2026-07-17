"use client";

// Implements: UI/web/05_Attendance.md — AttendanceGrid
// Renders the student list for marking attendance using Cyan Lagoon palette vars.

import { useAttendanceStore } from "@/stores/attendance-store";
import { type StudentAttendanceRow, type AttendanceSession, type AttendanceStatus, type UpdateAttendancePayload } from "@buddysaradhi/shared";
import { AttendanceStatusToggle } from "./attendance-status-toggle";
import { updateAttendanceAction } from "@/server/actions/attendance";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { GlassCard } from "@/components/ui/glass-card";

const SUMMARY_META: { key: AttendanceStatus; label: string; accent: string }[] = [
  { key: "present", label: "Present", accent: "var(--accent-emerald)" },
  { key: "absent", label: "Absent", accent: "var(--accent-flare)" },
  { key: "late", label: "Late", accent: "var(--accent-amber)" },
  { key: "excused", label: "Leave", accent: "var(--accent-cyan)" },
];

interface AttendanceGridProps {
  records: StudentAttendanceRow[];
  session: AttendanceSession | null;
}

export function AttendanceGrid({ records, session }: AttendanceGridProps) {
  const { searchQuery, selectedDateIso, selectedBatch } = useAttendanceStore();
  const queryClient = useQueryClient();
  const [errorToast, setErrorToast] = useState<string | null>(null);

  const isLocked = session?.locked_at != null;

  const mutation = useMutation({
    mutationFn: (payload: UpdateAttendancePayload) => updateAttendanceAction(payload),
    onMutate: async (newPayload) => {
      await queryClient.cancelQueries({ queryKey: ["attendance"] });
      const previousData = queryClient.getQueryData(["attendance", selectedDateIso, selectedBatch]);

      queryClient.setQueryData(
        ["attendance", selectedDateIso, selectedBatch],
        (old: { data?: { records: StudentAttendanceRow[] } } | undefined) => {
          if (!old || !old.data || !old.data.records) return old;
          const newRecords = [...old.data.records];
          newPayload.updates.forEach((u) => {
            const idx = newRecords.findIndex((r: StudentAttendanceRow) => r.student_id === u.student_id);
            if (idx !== -1) newRecords[idx] = { ...newRecords[idx], status: u.status };
          });
          return { ...old, data: { ...old.data, records: newRecords } };
        }
      );

      return { previousData };
    },
    onError: (err, newPayload, context) => {
      queryClient.setQueryData(["attendance", selectedDateIso, selectedBatch], context?.previousData);
      setErrorToast(err.message || "Failed to update attendance");
      setTimeout(() => setErrorToast(null), 3000);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
  });

  const handleToggle = (studentId: string, status: AttendanceStatus) => {
    if (isLocked) return;
    mutation.mutate({
      session_date: selectedDateIso,
      batch_id: selectedBatch === "all" ? null : selectedBatch,
      updates: [{ student_id: studentId, status }],
    });
  };

  const handleBulk = (status: AttendanceStatus) => {
    if (isLocked) return;
    const updates = filteredRecords.map((r) => ({ student_id: r.student_id, status }));
    mutation.mutate({
      session_date: selectedDateIso,
      batch_id: selectedBatch === "all" ? null : selectedBatch,
      updates,
    });
  };

  const filteredRecords = records.filter((r) =>
    searchQuery ? r.name.toLowerCase().includes(searchQuery.toLowerCase()) : true
  );

  const counts = SUMMARY_META.reduce(
    (acc, m) => {
      acc[m.key] = records.filter((r) => r.status === m.key).length;
      return acc;
    },
    {} as Record<AttendanceStatus, number>
  );

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Summary pills — neumorphic, color-coded, count + word (color is never the only signal) */}
      <div className="flex flex-wrap items-center gap-3" aria-label="Attendance summary">
        {SUMMARY_META.map((m) => (
          <div
            key={m.key}
            className="neumo-inset px-4 py-2 rounded-full flex items-center gap-2 min-h-[44px]"
            style={{ border: `1px solid color-mix(in srgb, ${m.accent} 30%, transparent)` }}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: m.accent }} aria-hidden="true" />
            <span className="text-sm font-semibold num" style={{ color: m.accent }}>
              {counts[m.key]}
            </span>
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              {m.label}
            </span>
          </div>
        ))}
      </div>

      {/* Bulk Action Bar — M1 glass-strong sticky */}
      <div
        className="p-4 rounded-xl flex items-center justify-between sticky top-0 z-20 shadow-sm"
        style={{
          background: "var(--surface-glass-strong)",
          backdropFilter: "blur(24px) saturate(160%)",
          border: "1px solid var(--border-glass-strong)",
        }}
      >
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-heading)" }}>
          {filteredRecords.length} Students {searchQuery && "found"}
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleBulk("present")}
            disabled={isLocked}
            className="neumo-raised px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors disabled:opacity-50 min-h-[44px]"
            style={{
              background: "var(--bg-surface-raised)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-default)",
              boxShadow: !isLocked ? "0 0 12px color-mix(in srgb, var(--accent-success) 20%, transparent)" : undefined,
            }}
            onMouseEnter={(e) => {
              if (!isLocked) e.currentTarget.style.color = "var(--accent-success)";
            }}
            onMouseLeave={(e) => {
              if (!isLocked) e.currentTarget.style.color = "var(--text-primary)";
            }}
          >
            <Check className="w-4 h-4" style={{ color: "var(--accent-success)" }} /> Mark all Present
          </button>
          <button
            onClick={() => handleBulk("absent")}
            disabled={isLocked}
            className="neumo-raised px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors disabled:opacity-50 min-h-[44px]"
            style={{
              background: "var(--bg-surface-raised)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-default)",
            }}
            onMouseEnter={(e) => {
              if (!isLocked) e.currentTarget.style.color = "var(--accent-danger)";
            }}
            onMouseLeave={(e) => {
              if (!isLocked) e.currentTarget.style.color = "var(--text-primary)";
            }}
          >
            <X className="w-4 h-4" style={{ color: "var(--accent-danger)" }} /> Mark all Absent
          </button>
        </div>
      </div>

      {errorToast && (
        <div
          className="px-4 py-2 rounded-lg text-sm flex items-center gap-2"
          style={{
            background: "color-mix(in srgb, var(--accent-danger) 15%, transparent)",
            border: "1px solid var(--accent-danger)",
            color: "var(--text-primary)",
          }}
        >
          <AlertTriangle className="w-4 h-4" style={{ color: "var(--accent-danger)" }} /> {errorToast}
        </div>
      )}

      {/* Grid wrapper */}
      <GlassCard className="p-0 overflow-hidden flex-grow pb-20">
        <div className="overflow-y-auto h-full no-scrollbar">
          {filteredRecords.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-sm" style={{ color: "var(--text-muted)" }}>
              No students found for this batch.
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--border-glass)" }}>
              {filteredRecords.map((record) => (
                <div
                  key={record.student_id}
                  className="flex items-center justify-between px-6 py-3 transition-colors group h-16"
                  style={{ borderBottom: "1px solid var(--border-glass)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--surface-glass-faint)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <div className="flex items-center">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shadow-lg shrink-0"
                      style={{
                        background: "linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))",
                        color: "var(--text-on-accent)",
                      }}
                    >
                      {record.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="ml-4">
                      <p
                        className="text-sm font-semibold transition-colors group-hover:text-[var(--accent-primary)]"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {record.name}
                      </p>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {record.batch || "No batch"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-center w-full md:w-[260px]">
                    <AttendanceStatusToggle
                      status={record.status}
                      onChange={(s) => handleToggle(record.student_id, s)}
                      isLocked={isLocked}
                      studentName={record.name}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}
