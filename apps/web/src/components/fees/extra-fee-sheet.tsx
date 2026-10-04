"use client";

// Implements: UI/web/06_Fees_and_Payments.md — Extras tab (TutorOS)
// 07_Fees_and_Payments.md §6.5 (an invoice is a charge against ONE named
// student) + 12_Business_Rules.md BR-M-01 (money crosses as integer paise, the
// description is plain text) and AGENTS.md §2 Rule 9 (no silent failures — a
// control must not quietly do something other than what it says).
//
// THE CATEGORY IS REAL. Each of the six cards used to open a generic invoice
// sheet that hardcoded the description "Monthly Tuition Fee", so a tutor who
// picked "Lab fee" and pressed Charge billed a Monthly Tuition Fee — six
// controls doing one undisclosed thing, in a money app. That is the same defect
// class as a "Record" button that writes against whichever row happened to be
// first. So the category now travels: it is handed to the store as the
// invoice's opening description, the tutor can edit it before it saves, and what
// they edit is what reaches the ledger row.
//
// There is no "Add Category" button any more. It toggled a notice and changed
// nothing, which is an affordance that lies. Adding a category means a schema
// change and a Settings surface that does not exist yet; until it does, the
// catalog states the truth — the six categories the app supports — rather than
// offering a control for a feature that is not there.

import { BookOpen, Bus, FlaskConical, Dumbbell, Music, Info, type LucideIcon } from "lucide-react";
import { useFeesStore } from "@/stores/fees-store";

interface ExtraCategory {
  key: string;
  label: string;
  description: string;
  accent: string;
  Icon: LucideIcon;
}

const CATEGORIES: ExtraCategory[] = [
  { key: "exam", label: "Exam Fee", description: "Term / board examination charges", accent: "var(--danger)", Icon: BookOpen },
  { key: "late", label: "Late Fee", description: "Overdue instalment penalty", accent: "var(--warning)", Icon: Info },
  { key: "transport", label: "Transport", description: "Bus / van routing charges", accent: "var(--info)", Icon: Bus },
  { key: "lab", label: "Lab / Material", description: "Practical & consumable costs", accent: "var(--info)", Icon: FlaskConical },
  { key: "sports", label: "Sports", description: "Coaching & ground fees", accent: "var(--success)", Icon: Dumbbell },
  { key: "activity", label: "Activity", description: "Music, art & events", accent: "var(--info)", Icon: Music },
];

export function ExtraFeeSheet() {
  const { setInvoiceSheetOpen, setInvoiceDescriptionSeed } = useFeesStore();

  /**
   * The category becomes the description, so the sheet opens already naming what
   * is being charged. The seed is cleared when the sheet closes, so an invoice
   * opened from the ledger later starts from the default rather than inheriting
   * a stale category.
   */
  const chargeCategory = (label: string) => {
    // Only from CLOSED. A seed arriving while the sheet is open would overwrite
    // the description the tutor is already editing — the sheet adopts the seed on
    // open, once, and never again.
    if (useFeesStore.getState().isInvoiceSheetOpen) return;
    setInvoiceDescriptionSeed(label);
    setInvoiceSheetOpen(true);
  };

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
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {CATEGORIES.map((c) => (
          <div
            key={c.key}
            className="flex flex-col p-4 rounded-xl transition-colors"
            style={{ background: "var(--surface-inset)", border: "1px solid var(--border-default)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-raised)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface-inset)"; }}
          >
            <div className="flex items-center gap-3 mb-2">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `color-mix(in srgb, ${c.accent} 14%, transparent)`, color: c.accent, border: `1px solid color-mix(in srgb, ${c.accent} 28%, transparent)` }}
              >
                <c.Icon className="w-5 h-5" aria-hidden="true" />
              </div>
              <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>{c.label}</p>
            </div>
            <p className="text-xs flex-1" style={{ color: "var(--text-muted)" }}>{c.description}</p>
            <button
              type="button"
              onClick={() => chargeCategory(c.label)}
              className="btn-glass neumo-raised mt-3 min-h-[44px] px-3 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{ background: "var(--surface-raised)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
              aria-label={`Charge ${c.label} to a student — opens an invoice already described as ${c.label}`}
              onMouseEnter={(e) => { e.currentTarget.style.color = c.accent; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
            >
              Charge {c.label}
            </button>
          </div>
        ))}
      </div>

      {/* The one fact a tutor needs before the first Charge: what the sheet is
          going to do, and what it needs from them. A control that names its own
          requirement does not need a modal to explain itself. */}
      <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
        Charging opens the invoice sheet with <span style={{ color: "var(--text-secondary)" }}>this category as the description</span>, against the
        student selected on this screen. Edit the description before saving if that is not what you meant.
      </p>
    </div>
  );
}