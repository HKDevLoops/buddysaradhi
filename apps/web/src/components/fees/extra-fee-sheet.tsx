"use client";

// Implements: UI/web/06_Fees_and_Payments.md — Extras tab (TutorOS)
// Extra-fee catalog / categories. Presentational catalog; "Charge" reuses the
// existing invoice action via the Generate Invoice sheet.

import { useState } from "react";
import { useFeesStore } from "@/stores/fees-store";
import { Sparkles, BookOpen, Bus, FlaskConical, Dumbbell, Music, Plus, Info } from "lucide-react";

interface ExtraCategory {
  key: string;
  label: string;
  description: string;
  accent: string;
  Icon: typeof Sparkles;
}

const CATEGORIES: ExtraCategory[] = [
  { key: "exam", label: "Exam Fee", description: "Term / board examination charges", accent: "var(--accent-flare)", Icon: BookOpen },
  { key: "late", label: "Late Fee", description: "Overdue instalment penalty", accent: "var(--accent-amber)", Icon: Info },
  { key: "transport", label: "Transport", description: "Bus / van routing charges", accent: "var(--accent-cyan)", Icon: Bus },
  { key: "lab", label: "Lab / Material", description: "Practical & consumable costs", accent: "var(--accent-violet)", Icon: FlaskConical },
  { key: "sports", label: "Sports", description: "Coaching & ground fees", accent: "var(--accent-emerald)", Icon: Dumbbell },
  { key: "activity", label: "Activity", description: "Music, art & events", accent: "var(--accent-cyan)", Icon: Music },
];

export function ExtraFeeSheet() {
  const { setInvoiceSheetOpen } = useFeesStore();
  const [notice, setNotice] = useState(false);

  return (
    <div className="glass-panel rounded-xl p-6 flex flex-col min-h-[400px]">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-medium" style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
            Extra Fees
          </h2>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Reusable charge categories billed on top of the monthly fee.
          </p>
        </div>
        <button
          onClick={() => setNotice((v) => !v)}
          className="btn-glass neumo-raised px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all"
          style={{ background: "var(--bg-surface-raised)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
        >
          <Plus className="w-4 h-4" style={{ color: "var(--accent-violet)" }} /> Add Category
        </button>
      </div>

      {notice && (
        <div className="mb-4 p-3 rounded-lg flex items-center gap-2 text-sm" style={{ background: "color-mix(in srgb, var(--accent-info) 10%, transparent)", color: "var(--accent-info)", border: "1px solid color-mix(in srgb, var(--accent-info) 25%, transparent)" }}>
          <Info className="w-4 h-4 shrink-0" />
          Extra-fee categories are managed in Settings → Fee Rules. Select a category below to charge it to a student.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {CATEGORIES.map((c) => (
          <div
            key={c.key}
            className="flex flex-col p-4 rounded-xl transition-colors"
            style={{ background: "var(--surface-glass-faint)", border: "1px solid var(--border-glass)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-glass)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface-glass-faint)"; }}
          >
            <div className="flex items-center gap-3 mb-2">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `color-mix(in srgb, ${c.accent} 14%, transparent)`, color: c.accent, border: `1px solid color-mix(in srgb, ${c.accent} 28%, transparent)` }}
              >
                <c.Icon className="w-5 h-5" />
              </div>
              <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>{c.label}</p>
            </div>
            <p className="text-xs flex-1" style={{ color: "var(--text-muted)" }}>{c.description}</p>
            <button
              onClick={() => setInvoiceSheetOpen(true)}
              className="btn-glass neumo-raised mt-3 px-3 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{ background: "var(--bg-surface-raised)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
              aria-label={`Charge ${c.label} to a student`}
              onMouseEnter={(e) => { e.currentTarget.style.color = c.accent; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
            >
              Charge
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
