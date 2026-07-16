import type { PrismaClient } from "../prisma-client";

export type CellStatus = "paid" | "partial" | "unpaid" | "no_dues";
export interface HeatRow {
  student_name: string;
  week_start: string;
  cell_status: CellStatus;
  due_minor: number;
}

function weekStart(iso: string): string {
  const d = new Date(iso);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

function weekEnd(ws: string): string {
  const d = new Date(ws);
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

function listWeeks(startIso: string, endIso: string): string[] {
  const weeks: string[] = [];
  let cur = weekStart(startIso);
  const end = weekStart(endIso);
  // Safety cap to avoid runaway loops on bad input
  for (let i = 0; i < 520 && cur <= end; i++) {
    weeks.push(cur);
    const d = new Date(cur);
    d.setDate(d.getDate() + 7);
    cur = d.toISOString().slice(0, 10);
  }
  return weeks;
}

/**
 * Builds a per-student, per-week heatmap over the given ISO range.
 *
 * - mode "dues":  cell_status reflects the student's outstanding balance at the
 *   end of each week (no_dues / partial / unpaid).
 * - mode "financial": cell_status reflects whether a payment landed that week
 *   (paid) else outstanding balance (unpaid / no_dues).
 *
 * due_minor is the running balance (floored at 0) as of that week's end.
 */
export async function buildHeatmap(
  db: PrismaClient,
  tenantId: string,
  startIso: string,
  endIso: string,
  mode: "dues" | "financial"
): Promise<HeatRow[]> {
  const weeks = listWeeks(startIso, endIso);
  const students = await db.student.findMany({
    where: { tenantId, status: "active", archivedAt: null },
    select: { id: true, firstName: true, lastName: true, balancePaise: true },
    orderBy: { firstName: "asc" },
  });

  const rows: HeatRow[] = [];
  for (const s of students) {
    const name = [s.firstName, s.lastName].filter(Boolean).join(" ");
    const entries = await db.ledgerEntry.findMany({
      where: {
        tenantId,
        studentId: s.id,
        occurredOn: { gte: startIso.slice(0, 10), lte: endIso.slice(0, 10) },
      },
      orderBy: { occurredOn: "asc" },
    });

    for (const ws of weeks) {
      const we = weekEnd(ws);
      const weekEntries = entries.filter(
        (e) =>
          e.occurredOn.slice(0, 10) >= ws && e.occurredOn.slice(0, 10) <= we
      );
      let balance = s.balancePaise;
      for (const e of weekEntries) balance = e.balanceAfterPaise;
      const hasPayment = weekEntries.some((e) => e.creditPaise > 0);

      let cell_status: CellStatus;
      if (mode === "financial") {
        if (hasPayment) cell_status = "paid";
        else if (balance > 0) cell_status = "unpaid";
        else cell_status = "no_dues";
      } else {
        if (balance <= 0) cell_status = "no_dues";
        else if (hasPayment) cell_status = "partial";
        else cell_status = "unpaid";
      }
      rows.push({ student_name: name, week_start: ws, cell_status, due_minor: Math.max(0, balance) });
    }
  }
  return rows;
}
