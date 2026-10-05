"use client";

// Implements: 07_Fees_and_Payments.md §6.2 (Pending / Overdue — who owes what,
// right now) + §6.4 (Record Payment is entered for ONE named student);
// 12_Business_Rules.md BR-FEE-01/BR-FEE-04 (a payment is attributed to a student,
// never to "whoever is first") and BR-M-01 (integer paise); 10_Security.md §4
// (a financial mutation names its subject before it is committed); 05_Students.md
// §6.3 as amended + AGENTS.md §2 Rule 2 (ranking is local — the real fzf engine,
// no request while the tutor types); AGENTS.md §2 Rule 9 (a failed read is not an
// empty one) and Rule 10 (44px targets, labelled controls, keyboard parity).
//
// THE HEADER BUTTON (the P0 this file used to ship):
// `bulkRecord` was commented "bulk record" but opened the Record Payment sheet for
// `due[0].id` and overwrote `selectedStudentId` as a side effect — so a tutor who
// had student #7 in view and clicked the most prominent control in the header wrote
// a payment into student #1's ledger, with nothing on screen naming #1. There is
// no honest version of a control whose label and whose behaviour disagree on whose
// money moves. It is now bound to the selected student and NAMES that student; with
// no student selected it is disabled with a stated reason. The only way to move
// money from this screen is a row whose student, balance and button are all visible
// together, or a header button that says whose books it is about to touch.
//
// A failed roster read renders `ErrorState` with an explicit `dataStatus`. It used
// to render "All dues collected. Clean slate." — on a timeout that sentence is a
// lie a tutor acts on (they stop chasing money that is owed). The search runs
// through the shared `fuzzySearch` engine, the same one the fees roster filter uses
// on this same screen; `String.includes` was a second, worse ranking of the same
// list.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getStudentsForFees } from "@/server/queries/fees";
import { useFeesStore } from "@/stores/fees-store";
import { formatINR, fuzzySearch, paiseAdd } from "@buddysaradhi/shared";
import { ErrorState } from "@/components/ui/screen-state";
import { toAppErrorState } from "@/lib/app-errors";
import {
  BalanceStatusChip,
  BalanceLegend,
  balanceStatusTitle,
} from "./balance-status";
import { Check, Loader2, Search, Wallet, CircleDollarSign } from "lucide-react";

interface StudentRow {
  id: string;
  name: string;
  code: string | null;
  fee_model: string;
  balance_due: number;
}

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

/** First name only — a header button has room for one word, not a full roster name. */
function shortName(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : name;
}

export function PendingTab() {
  const { selectedStudentId, setSelectedStudentId, setPaymentSheetOpen } = useFeesStore();
  const [query, setQuery] = useState("");

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["fees-students", ""],
    queryFn: () => getStudentsForFees(""),
  });

  // A failed read is NOT an empty roster. `data` is a `{success:false}` envelope,
  // so `isError` never fires — the branch below has to read the envelope itself.
  const failure = data && data.success === false ? data.error : null;

  // No cast: the query element already matches StudentRow (Rule 9).
  const students: StudentRow[] = useMemo(
    () => (data && data.success ? data.data : []),
    [data]
  );
  const due = useMemo(
    () => students.filter((s) => s.balance_due > 0),
    [students]
  );

  // One engine, one ranking (05_Students.md §6.3; Rule 2 — local, no request).
  const filtered = useMemo(() => {
    if (query.trim().length === 0) return due;
    const hits = fuzzySearch(
      due.map((s) => ({
        item: s,
        text: [s.name, s.code ?? "", s.fee_model].filter(Boolean).join(" "),
      })),
      query
    );
    return hits.map((hit) => hit.item);
  }, [due, query]);

  // Rule 6 / BR-M-01: paise helpers only — no `+` on money (§14 #3).
  const totalDue = due.reduce((acc, s) => paiseAdd(acc, s.balance_due), 0);

  // The header control's subject: the student the tutor has selected, and only if
  // that student actually owes. `null` means "no safe subject exists".
  const selectedDue = useMemo(
    () => due.find((s) => s.id === selectedStudentId) ?? null,
    [due, selectedStudentId]
  );

  const recordFor = (id: string) => {
    setSelectedStudentId(id);
    setPaymentSheetOpen(true);
  };

  const headerSubject = selectedDue ? shortName(selectedDue.name) : null;

  return (
    <div className="glass-panel rounded-xl p-6 flex flex-col min-h-[400px]">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-medium" style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
            Pending / Overdue
          </h2>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {due.length} students owe{" "}
            <span className="num font-semibold" style={{ color: "var(--danger)" }}>{formatINR(totalDue)}</span>
          </p>
        </div>
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
          <div className="relative">
            <label htmlFor="pending-dues-search" className="sr-only">
              Search students with dues by name, code, or fee model
            </label>
            <input
              id="pending-dues-search"
              type="search"
              placeholder="Search dues..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="neumo-inset w-full md:w-56 min-h-[44px] bg-[var(--surface-inset)] border border-[var(--border-default)] rounded-lg px-3 py-2 pl-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--info)] focus:ring-1 focus:ring-[var(--info)]"
            />
            <Search
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: "var(--text-muted)" }}
              aria-hidden="true"
            />
          </div>
          <div className="flex flex-col items-stretch md:items-end gap-1">
            <button
              type="button"
              onClick={() => selectedDue && recordFor(selectedDue.id)}
              disabled={!selectedDue}
              aria-describedby="pending-record-reason"
              className="btn-glass neumo-raised min-h-[44px] px-4 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: selectedDue
                  ? "linear-gradient(135deg, var(--success), var(--info))"
                  : "var(--surface-raised)",
                color: selectedDue ? "var(--accent-on-primary)" : "var(--text-muted)",
                border: "none",
              }}
            >
              <Wallet className="w-4 h-4" aria-hidden="true" />
              {headerSubject ? `Record payment for ${headerSubject}` : "Record payment"}
            </button>
            {/* The stated reason, in text — a `title` alone is not reachable by
                keyboard or screen reader, and a disabled control with no reason
                is the same defect as an unlabelled one. */}
            <p id="pending-record-reason" className="text-[11px] text-right max-w-[16rem]" style={{ color: "var(--text-muted)" }}>
              {selectedDue
                ? `Records against ${selectedDue.name}'s ledger.`
                : "Select a student below first — this button records against the selected student only."}
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-primary)" }} aria-hidden="true" />
          <span className="sr-only">Loading students with dues…</span>
        </div>
      ) : failure ? (
        <ErrorState
          state={toAppErrorState(failure)}
          onRetry={() => { void refetch(); }}
          isRetrying={isFetching}
          retryLabel="Load dues again"
          dataStatus="Nothing was changed and no payment was recorded. This list is NOT your dues — a load that failed looks exactly like an empty one, so do not treat it as a clean slate."
        />
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
          <CircleDollarSign className="w-8 h-8 opacity-40 mb-3" style={{ color: "var(--success)" }} aria-hidden="true" />
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {due.length === 0 ? "No student owes anything right now." : "No matches for your search."}
          </p>
        </div>
      ) : (
        <>
          {/* Once above the list, never per row: the three balance words are
              taught once per screen, not 200 times. This list renders the same
              `BalanceStatusChip` as the Fees and Students rosters, so without
              it a tutor meets "Credit" here first and undefined. */}
          <div className="px-1 pb-1">
            <BalanceLegend />
          </div>
          <ul className="space-y-2">
          {filtered.map((s) => {
            const isSubject = s.id === selectedDue?.id;
            return (
              <li
                key={s.id}
                className="flex items-center gap-3 p-3 rounded-xl transition-colors"
                style={{
                  background: "var(--surface-inset)",
                  border: isSubject
                    ? "1px solid var(--success)"
                    : "1px solid var(--border-default)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-raised)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface-inset)"; }}
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0"
                  style={{ background: "color-mix(in srgb, var(--danger) 15%, transparent)", color: "var(--danger)" }}
                  aria-hidden="true"
                >
                  {initials(s.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate" style={{ color: "var(--text-primary)" }}>{s.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <BalanceStatusChip balanceDuePaise={s.balance_due} />
                    <span className="text-xs capitalize truncate" style={{ color: "var(--text-muted)" }}>{s.fee_model}</span>
                    {/* Which row the header button is currently aimed at. Stated in
                        words, not by the ring alone. */}
                    {isSubject && (
                      <span
                        className="chip chip-success text-[10px] px-2 py-0.5"
                        title="The header Record payment button is aimed at this student."
                      >
                        <Check className="w-3 h-3" aria-hidden="true" />
                        Selected
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0 mr-2">
                  <p className="text-sm font-bold num" style={{ color: "var(--danger)" }}>{formatINR(s.balance_due)}</p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }} title={balanceStatusTitle(s.balance_due)}>
                    outstanding
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => recordFor(s.id)}
                  className="btn-glass neumo-raised min-h-[44px] px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all"
                  style={{ background: "var(--surface-raised)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
                  aria-label={`Record payment for ${s.name}, ${formatINR(s.balance_due)} outstanding`}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--success)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
                >
                  <Wallet className="w-4 h-4" style={{ color: "var(--success)" }} aria-hidden="true" /> Record
                </button>
              </li>
            );
          })}
          </ul>
        </>
      )}
    </div>
  );
}