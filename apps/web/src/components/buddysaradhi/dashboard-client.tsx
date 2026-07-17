"use client";

import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  TrendingUp,
  AlertCircle,
  CalendarDays,
  FileText,
  CreditCard,
  UserPlus,
  CalendarCheck,
} from "lucide-react";
import { formatINR } from "@buddysaradhi/shared";
import { cn } from "@/lib/utils";
import { CountUp } from "@/components/ui/count-up";
import { useDashboardStore } from "@/stores/dashboard";
import { useStudentsStore } from "@/stores/students-store";
import { useShellStore } from "@/stores/shell-store";
import {
  fetchDashboardKPIsAction,
  fetchActivityFeedAction,
  fetchPaymentHeatmapAction,
  fetchAttendanceHeatmapAction,
  fetchDueTodayAction,
} from "@/server/actions/dashboard";

import { type DashboardKpis } from "@/server/queries/dashboard";

type Tab = "overview" | "collection" | "attendance";

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function DashboardClient() {
  const { periodFilter, setPeriodFilter } = useDashboardStore();
  const [now, setNow] = React.useState(() => Date.now());
  const [tab, setTab] = useState<Tab>("overview");
  const setActiveScreen = useShellStore((s) => s.setActiveScreen);

  const openAddStudent = () => {
    setActiveScreen("/students");
    setTimeout(() => {
      useStudentsStore.getState().openAddSheet();
    }, 0);
  };

  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  const periodStartIso = useMemo(() => {
    const d = new Date();
    if (periodFilter === "this_month") {
      d.setDate(1);
    } else if (periodFilter === "last_month") {
      d.setMonth(d.getMonth() - 1);
      d.setDate(1);
    } else if (periodFilter === "this_quarter") {
      d.setMonth(Math.floor(d.getMonth() / 3) * 3);
      d.setDate(1);
    }
    return d.toISOString();
  }, [periodFilter]);

  const { data, isLoading } = useQuery<DashboardKpis>({
    queryKey: ["dashboard", "kpis", { periodStartIso }],
    queryFn: async () => {
      const res = await fetchDashboardKPIsAction(periodStartIso);
      if (!res.ok) throw new Error(res.error.message);
      return res.value || {
        totalStudents: 0,
        studentsWithDues: 0,
        collectedThisMonthMinor: 0,
        dueTillDateMinor: 0,
        dueForMonthMinor: 0,
        paymentBreakdown: { paid: 0, partial: 0, unpaid: 0, noDues: 0 },
      };
    },
  });

  const { data: feedData } = useQuery({
    queryKey: ["dashboard", "feed"],
    queryFn: async () => {
      const res = await fetchActivityFeedAction(10);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
  });

  const { data: dueToday } = useQuery({
    queryKey: ["dashboard", "due-today"],
    queryFn: async () => {
      const res = await fetchDueTodayAction();
      if (!res.success) return [];
      return res.data;
    },
  });

  const { data: paymentHeatmap, isLoading: isPayHeatLoading } = useQuery({
    queryKey: ["dashboard", "heatmap", "pay", { periodFilter }],
    queryFn: async () => {
      const res = await fetchPaymentHeatmapAction(periodFilter);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
  });

  const { data: attendHeatmap, isLoading: isAttHeatLoading } = useQuery({
    queryKey: ["dashboard", "heatmap", "att", { periodFilter }],
    queryFn: async () => {
      const res = await fetchAttendanceHeatmapAction(periodFilter);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
  });

  const kpis: DashboardKpis = data ?? {
    totalStudents: 0,
    studentsWithDues: 0,
    collectedThisMonthMinor: 0,
    dueTillDateMinor: 0,
    dueForMonthMinor: 0,
    paymentBreakdown: { paid: 0, partial: 0, unpaid: 0, noDues: 0 },
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "collection", label: "Collection" },
    { id: "attendance", label: "Attendance" },
  ];

  return (
    <div className="space-y-6">
      {/* Header + period filter */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Dashboard</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">The truth of your tuition business, right now.</p>
        </div>
        <div className="neumo-inset p-1 rounded-lg flex items-center bg-[var(--bg-surface-inset)] border border-[var(--border-default)]">
          {(["this_month", "last_month", "this_quarter", "all_time"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriodFilter(p)}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm transition-all",
                periodFilter === p
                  ? "bg-[var(--surface-glass-strong)] text-[var(--text-primary)] shadow-sm ring-1 ring-white/10"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              )}
            >
              {p.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())}
            </button>
          ))}
        </div>
      </div>

      {/* KPI strip — matches TutorOS prototype */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Collected"
          value={kpis.collectedThisMonthMinor}
          formatFn={formatINR}
          icon={<TrendingUp className="w-5 h-5" />}
          accent="var(--accent-emerald)"
          delta={{ dir: "up", label: "18% vs last month" }}
          isLoading={isLoading}
        />
        <KPICard
          title="Due Till Date"
          value={kpis.dueTillDateMinor}
          formatFn={formatINR}
          icon={<AlertCircle className="w-5 h-5" />}
          accent="var(--accent-amber)"
          delta={{ dir: "flat", label: `${kpis.studentsWithDues} students owe` }}
          isLoading={isLoading}
        />
        <KPICard
          title="Active Students"
          value={kpis.totalStudents}
          icon={<Users className="w-5 h-5" />}
          accent="var(--accent-cyan)"
          isLoading={isLoading}
        />
        <KPICard
          title="Overdue"
          value={kpis.dueForMonthMinor - kpis.collectedThisMonthMinor > 0 ? kpis.dueForMonthMinor - kpis.collectedThisMonthMinor : 0}
          formatFn={formatINR}
          icon={<CalendarDays className="w-5 h-5" />}
          accent="var(--accent-flare)"
          delta={{ dir: "down", label: `${kpis.paymentBreakdown.unpaid} students` }}
          isLoading={isLoading}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--border-glass)]">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px",
              tab === t.id
                ? "text-[var(--accent-primary)] border-[var(--accent-primary)]"
                : "text-[var(--text-muted)] border-transparent hover:text-[var(--text-primary)]"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Due Today */}
          <div className="lg:col-span-2 glass-panel rounded-xl p-6 min-h-[300px] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium text-[var(--text-primary)]">Due Today</h2>
              <span className="text-xs text-[var(--text-muted)]">{dueToday?.length ?? 0} students</span>
            </div>
            {!dueToday || dueToday.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
                <CreditCard className="w-8 h-8 text-[var(--text-muted)] opacity-60 mb-3" />
                <p className="text-sm text-[var(--text-muted)]">No dues due today. Clean slate.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {dueToday.map((d) => (
                  <div
                    key={d.student_id}
                    className="flex items-center gap-3 p-3 rounded-xl bg-[var(--surface-glass-faint)] border border-[var(--border-glass)]"
                  >
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0"
                      style={{ background: "color-mix(in srgb, var(--accent-amber) 15%, transparent)", color: "var(--accent-amber)" }}>
                      {initials(d.student_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">{d.student_name}</p>
                      <p className="text-xs text-[var(--text-muted)] truncate">
                        {d.invoice_number ? `Inv ${d.invoice_number}` : "Fee due"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-[var(--accent-flare)] num">{formatINR(d.due_minor)}</p>
                      {d.due_date && (
                        <p className="text-xs text-[var(--text-muted)]">
                          {Math.max(0, Math.round((new Date(d.due_date).getTime() - now) / 86400000))}d
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Activity */}
          <div className="glass-panel rounded-xl p-6">
            <h2 className="text-lg font-medium text-[var(--text-primary)] mb-4">Activity</h2>
            <div className="space-y-4">
              {!feedData || feedData.length === 0 ? (
                <div className="text-sm text-[var(--text-muted)] py-4 text-center">No recent activity</div>
              ) : (
                feedData.map((item: unknown, i: number) => {
                  const typed = item as {
                    event_type: string; minor_amount: number; student_name: string;
                    invoice_number?: string; additional_data?: string; timestamp: string;
                  };
                  let title = "";
                  let subtitle = "";
                  let accent = "var(--accent-cyan)";
                  if (typed.event_type === "PAYMENT") {
                    title = `${formatINR(typed.minor_amount)} Collected`;
                    subtitle = `from ${typed.student_name}`;
                    accent = "var(--accent-emerald)";
                  } else if (typed.event_type === "INVOICE") {
                    title = `Invoice #${typed.invoice_number || ""}`;
                    subtitle = `${typed.student_name} owes ${formatINR(typed.minor_amount)}`;
                    accent = "var(--accent-amber)";
                  } else if (typed.event_type === "ATTENDANCE_LOCKED") {
                    title = "Attendance Marked";
                    const add = typed.additional_data ? JSON.parse(typed.additional_data) : {};
                    subtitle = `Batch ${typed.student_name} — ${add.present_count || 0} present`;
                    accent = "var(--accent-violet)";
                  } else {
                    title = typed.student_name;
                    subtitle = typed.additional_data || "";
                  }
                  const diffMins = Math.floor((now - new Date(typed.timestamp).getTime()) / 60000);
                  const timeStr = diffMins < 60 ? `${diffMins} mins ago`
                    : diffMins < 1440 ? `${Math.floor(diffMins / 60)} hrs ago`
                    : `${Math.floor(diffMins / 1440)} days ago`;
                  return (
                    <ActivityItem key={i} title={title} subtitle={subtitle} time={timeStr} accent={accent} />
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "collection" && (
        <div className="glass-panel rounded-xl p-6 min-h-[300px]">
          <h2 className="text-lg font-medium text-[var(--text-primary)] mb-4">Collection Trend & Heatmap</h2>
          <Heatmap data={paymentHeatmap} isLoading={isPayHeatLoading} />
        </div>
      )}

      {tab === "attendance" && (
        <div className="glass-panel rounded-xl p-6 min-h-[300px]">
          <h2 className="text-lg font-medium text-[var(--text-primary)] mb-4">Attendance Heatmap</h2>
          <Heatmap data={attendHeatmap} isLoading={isAttHeatLoading} />
        </div>
      )}

      {/* Quick actions — matches TutorOS prototype */}
      <div className="glass-card p-4 rounded-2xl flex items-center justify-center gap-3 mt-8 mb-6 max-w-2xl mx-auto flex-wrap border border-[var(--border-glass)]">
        <QuickAction icon={<CalendarCheck className="w-4 h-4" />} label="Mark Attendance" accent="var(--accent-cyan)" onClick={() => setActiveScreen("/attendance")} />
        <QuickAction icon={<CreditCard className="w-4 h-4" />} label="Record Payment" accent="var(--accent-emerald)" onClick={() => setActiveScreen("/fees")} />
        <QuickAction icon={<UserPlus className="w-4 h-4" />} label="Add Student" accent="var(--accent-amber)" onClick={openAddStudent} />
        <QuickAction icon={<FileText className="w-4 h-4" />} label="Generate Report" accent="var(--accent-violet)" onClick={() => setActiveScreen("/fees")} />
      </div>
    </div>
  );
}

function Heatmap({ data, isLoading }: { data: unknown | undefined; isLoading: boolean }) {
  if (isLoading) return <div className="text-sm text-[var(--text-muted)] text-center py-10">Loading heatmap...</div>;
  const rows: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { records?: unknown[] }).records)
      ? (data as { records: unknown[] }).records
      : [];
  if (rows.length === 0)
    return <div className="text-sm text-[var(--text-muted)] text-center py-10">No data for selected period</div>;
  type Row = { student_name: string; week_start: string; cell_status: string; due_minor: number };
  const students = Array.from(new Set((rows as Row[]).map((d) => d.student_name))).sort();
  const weeks = Array.from(new Set((rows as Row[]).map((d) => d.week_start))).sort();
  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex flex-col gap-2 min-w-max">
      {students.map((s) => (
        <div key={s} className="flex items-center gap-4">
          <div className="w-24 truncate text-xs text-[var(--text-secondary)]" title={s}>{s}</div>
          <div className="flex gap-1.5">
            {weeks.map((w) => {
              const cell = (rows as Row[]).find((d) => d.student_name === s && d.week_start === w);
              let bg = "bg-[var(--bg-surface-inset)]";
              if (cell) {
                if (cell.cell_status === "paid") bg = "bg-[var(--accent-violet)] shadow-[0_0_8px_var(--accent-violet)]";
                else if (cell.cell_status === "partial") bg = "bg-[var(--accent-cyan)] shadow-[0_0_6px_var(--accent-cyan)]";
                else if (cell.cell_status === "unpaid") bg = "bg-[var(--accent-amber)] shadow-[0_0_6px_var(--accent-amber)]";
              }
              return (
                <div key={w} className={cn("w-4 h-4 rounded-sm transition-colors hover:ring-1 ring-white/30", bg)}
                  title={`${s} | ${cell ? cell.cell_status : "No dues"}`} />
              );
            })}
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}

function KPICard({
  title, value, formatFn, icon, accent, delta, isLoading,
}: {
  title: string; value: number; formatFn?: (v: number) => string; icon: React.ReactNode;
  accent: string; delta?: { dir: "up" | "down" | "flat"; label: string }; isLoading: boolean;
}) {
  return (
    <div className="glass p-5 rounded-xl flex flex-col justify-between transition-all hover:bg-[var(--surface-glass)]" style={{ borderLeft: `3px solid ${accent}` }}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">{title}</p>
        <div className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ backgroundColor: `color-mix(in srgb, ${accent} 15%, transparent)`, color: accent }}>
          {icon}
        </div>
      </div>
      {isLoading ? (
        <div className="h-8 w-24 bg-[var(--surface-glass-strong)] animate-pulse rounded" />
      ) : (
        <p className="text-2xl font-bold text-[var(--text-primary)] tracking-tight num">
          <CountUp value={value} formatFn={formatFn} />
        </p>
      )}
      {delta && (
        <p className={cn("text-xs mt-1 flex items-center gap-1 num",
          delta.dir === "up" && "text-[var(--accent-success)]",
          delta.dir === "down" && "text-[var(--accent-danger)]",
          delta.dir === "flat" && "text-[var(--text-muted)]")}>
          {delta.dir === "up" && <TrendingUp className="w-3 h-3" />}
          {delta.label}
        </p>
      )}
    </div>
  );
}

function ActivityItem({ title, subtitle, time, accent }: { title: string; subtitle: string; time: string; accent: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-[var(--border-glass)] pb-4 last:border-0 last:pb-0">
      <div className="w-2 h-2 mt-1.5 rounded-full" style={{ backgroundColor: accent }} />
      <div className="flex-1">
        <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>
      </div>
      <span className="text-xs text-[var(--text-muted)] opacity-70">{time}</span>
    </div>
  );
}

function QuickAction({ icon, label, accent, onClick }: { icon: React.ReactNode; label: string; accent: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="btn-glass bg-[var(--surface-glass-faint)] border border-[var(--border-glass)] px-4 py-2.5 rounded-xl text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 hover:bg-[var(--surface-glass)] transition-all cursor-pointer"
      style={{ ["--qa" as string]: accent }}
      onMouseEnter={(e) => { e.currentTarget.style.color = accent; e.currentTarget.style.borderColor = `color-mix(in srgb, ${accent} 30%, transparent)`; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.borderColor = "var(--border-glass)"; }}
    >
      {icon} {label}
    </button>
  );
}
