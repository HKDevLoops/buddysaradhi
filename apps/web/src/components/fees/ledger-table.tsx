"use client";

// Implements: UI/web/06_Fees_and_Payments.md — LedgerTable (TutorOS ledger feed)
// 07_Fees_and_Payments.md §6.3 (immutable per-student ledger with VOID rows +
// void linkage) + §9.10 (void receipt with PIN + typed reason) + §10.2
// BR-LED-02/BR-LED-03 (append-only, void linkage); 12_Business_Rules.md
// BR-LED-04/BR-LED-05 (reversing entry, never void-a-void), BR-M-01 (paise);
// 10_Security.md §4 (void = sensitive mutation, PIN) + §9 (void is a new row);
// 02_Core_Logic.md §13.6 (voidLedgerEntry); 14_Edge_Cases.md EC-F-05 (invoice
// reverts), EC-L-02 (void-of-void blocked), EC-L-07 (receipt gap intentional).
//
// Audit trail per student: every row shows entry type (chip + icon + word),
// business date, receipt number, the VOID linkage (`reverses_entry_id`,
// labelled in the tutor's terms — "↺ Reverses RCP-0012", falling back to
// "an earlier payment" when the original is not in this page of rows), and the
// derived running balance. The gateway already ships `reverses_entry_id` in this
// payload (no extra bytes — free-tier minimal); the local row type below
// declares it because the query's inline type omits it (queries are another
// workstream's scope — not widened here).
// Actor/`created_at` are NOT in this payload (gateway parity gap — reported).
//
// The header count used to read "12 entries · hash-chained & append-only" and
// the void chip used to print the original's id fragment. Both are
// implementation facts with no action attached: a tutor cannot verify a hash and
// cannot look up "a1b2c3d4" in a receipt book. The append-only property is still
// true and still enforced (Rule 1, BR-LED-04) — it is stated in this comment,
// and the void linkage that PROVES it to the tutor is now shown as a receipt
// number. No void behaviour changed: same action, same payload, same
// `reverses_entry_id`.
//
// Hardening (docs/design/overhaul-plan.md §2), VOID DIALOG ONLY — the money
// behaviour is untouched: same action, same `{entryId, reason}` payload, same
// Idempotency-Key intent key, same PIN presence gate, same reset-on-success.
// What changed is the interaction and the copy:
//   · `role="alertdialog"` + accessible name + `tabIndex` + `panelRef`, so it is
//     announced as the destructive thing it is and focus lands inside it.
//   · Escape and the scrim go through `useOverlayDismiss`; a typed reason or PIN
//     is `dirty`, so neither is discarded without a confirmation.
//   · A `{success:false}` envelope (which is how the gateway reports a wrong PIN
//     or a reason it rejects) used to be rendered verbatim to the tutor. It now
//     goes through `toAppErrorState`, so no stack, digest or gateway text reaches
//     the screen.
//   · Both outcomes are stated by name — a void posted, or a void refused —
//     because the panel closing (or staying open, silently) was the only signal.
//   · The rendered explanation dropped `Rule 1` and `BR-RC-01`. Those belong in
//     this comment, where a maintainer reads them, not on a receipt screen.
//
// Hardening (round 2), MONEY-CORRECTION PATH — the void dialog's eligibility rule
// and the table's failure state, both of which used to lie to the tutor:
//   · The PIN bound is now `pinFormatError()` from `packages/shared/src/pin.ts` —
//     the SAME fact `setPinAction` enforces (4-8 digits). It used to require
//     `>= 6` here while the server accepted 4, so a tutor with a 4- or 5-digit PIN
//     could never void, and voiding a reversing row is the only correction path an
//     append-only ledger has (Rule 1, BR-LED-04). The client no longer invents a
//     tighter bound than the server accepts. Server-side verification is unchanged.
//   · A FAILED ledger read renders `ErrorState`, not "No ledger entries yet. Charge
//     a fee or record a payment to begin." — which sat beside a timed-out read and
//     invited a duplicate charge against charges we could not see (Rule 9). The
//     header's entry count says "Ledger not loaded" for the same reason.
//   · The running-balance magnitude uses `paiseSub(0, n)` instead of `Math.abs` so
//     the money path never leaves the paise helpers (Rule 6).

import { useCallback, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getLedgerForStudent } from "@/server/queries/fees";
import { voidReceiptAction } from "@/server/actions/fees";
import { useFeesStore } from "@/stores/fees-store";
import { formatINR, paiseAdd, paiseSub, pinFormatError, PIN_INPUT_MAX_LENGTH, PIN_MAX_LENGTH, PIN_MIN_LENGTH } from "@buddysaradhi/shared";
import { VoidReasonSchema } from "./payment-contract";
import { mintIntentKey } from "@/lib/intent-key";
import { toAppErrorState } from "@/lib/app-errors";
import { useToast } from "@/components/ui/toast";
import { ErrorState } from "@/components/ui/screen-state";
import {
  useOverlayDismiss,
  DiscardChangesPrompt,
} from "@/components/ui/overlay";
import { Explain } from "@/components/ui/explain";
import { format, parseISO } from "date-fns";
import { Loader2, Plus, Ban, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Receipt,
  Sparkles,
  Wallet,
  Undo2,
  SlidersHorizontal,
  Tag,
  Circle,
  Eraser,
  ArrowDownToLine,
} from "lucide-react";

type LedgerQueryData = Awaited<ReturnType<typeof getLedgerForStudent>>;
type LedgerQueryRow = LedgerQueryData["data"][number];

// The gateway GET /api/v1/ledger payload carries these fields even though
// the query's inline type omits them (free-tier: already in the payload, so
// declaring them costs zero extra bytes). No cast — an intersection over the
// inferred row type.
type LedgerEntry = LedgerQueryRow & {
  reverses_entry_id?: string | null;
  balance_after?: number | null;
};

interface LedgerTableProps {
  studentId: string;
  studentName: string;
}

/**
 * A void refusal used to reach the tutor verbatim — either the gateway's mapped
 * text or a raw `err.message`. Two of the cases are worth naming precisely
 * because the tutor can act on them (a wrong PIN, a receipt that is already
 * struck through); everything else falls through the shared taxonomy mapper,
 * which returns static literals and never renders a stack, digest or upstream
 * payload. Every string ends with the same fact: nothing was written.
 */
function voidErrorCopy(raw: unknown): string {
  const text =
    typeof raw === "string"
      ? raw
      : raw instanceof Error
        ? raw.message
        : String(raw ?? "");
  const trimmed = text.trim();
  if (/invalid\s*pin|wrong\s*pin|incorrect\s*pin/i.test(trimmed))
    return "That PIN isn't right. Enter it again — nothing was written.";
  if (/already\s*(been\s*)?void|is\s*void|void\s*of\s*a\s*void/i.test(trimmed))
    return "This receipt is already voided, so there is nothing left to reverse. Nothing was written.";
  return `${toAppErrorState(text).message} Nothing was written — your reason and PIN are still here, so you can try again.`;
}

type EntryMeta = {
  label: string;
  accent: string;
  Icon: typeof Receipt;
};

/**
 * The ledger grammar, all seven types, each with its own word, icon and accent
 * (07 §10.2 BR-LED-01: "The LedgerTable renders all 7 entry types with distinct
 * icons and colours"; §7 `TypeChip // FEE_CHARGED | PAYMENT_RECEIVED |
 * DISCOUNT_GRANTED | REFUND_ISSUED | ADJUSTMENT | WRITEOFF | VOID`).
 *
 * This map used to key on `"REFUND"` and `"DISCOUNT"` — two spellings that do
 * not exist in the grammar (`packages/core/src/ledger.ts` `LEDGER_ENTRY_TYPES`
 * is `REFUND_ISSUED` and `DISCOUNT_GRANTED`) — and it had no case for
 * `WRITEOFF` at all. Every one of those three rows therefore fell to the default
 * branch and rendered its raw enum string (`REFUND_ISSUED`, `DISCOUNT_GRANTED`,
 * `WRITEOFF`) as the chip label, in muted grey, behind a blank circle icon. On
 * the money table that is the one word a tutor reads first, and it was the
 * database's word, not the product's. `WRITEOFF` is a BR-FEE-13 waiver — a
 * PIN-gated erasure of a due — so it now says so.
 */
function entryMeta(type: string): EntryMeta {
  switch (type) {
    case "FEE_CHARGED":
      return { label: "Fee", accent: "var(--warning)", Icon: Receipt };
    case "EXTRA_FEE":
      return { label: "Extra", accent: "var(--danger)", Icon: Sparkles };
    case "PAYMENT_RECEIVED":
      return { label: "Payment", accent: "var(--success)", Icon: Wallet };
    case "REFUND_ISSUED":
      return { label: "Refund", accent: "var(--info)", Icon: Undo2 };
    case "ADJUSTMENT":
      return { label: "Adjust", accent: "var(--info)", Icon: SlidersHorizontal };
    case "DISCOUNT_GRANTED":
      return { label: "Discount", accent: "var(--info)", Icon: Tag };
    case "WRITEOFF":
      return { label: "Written off", accent: "var(--text-muted)", Icon: Eraser };
    case "VOID":
      return { label: "Void", accent: "var(--danger)", Icon: Ban };
    default:
      return { label: type || "Entry", accent: "var(--text-muted)", Icon: Circle };
  }
}

/**
 * Is this ledger row DEAD?
 *
 * Two independent facts in the payload say so, and the row is dead if EITHER
 * does:
 *
 *   1. `row.isVoid` — the gateway's own flag, derived server-side from the same
 *      `void_of_id` linkage.
 *   2. `voidingRowByTarget.has(row.id)` — the linkage itself, read here from the
 *      reversing rows already in this page.
 *
 * This used to consult (1) alone. On the QA tenant that rendered EVERY
 * already-voided receipt exactly like a live one — no strike-through, no
 * "Voided" word, and an enabled "Void" button (measured: 6 voided payments in
 * the tenant, 0 of them flagged). 07 §6.3 and §10.2 BR-LED-03 both require the
 * original to be visibly struck, and a dead receipt that still looks live is the
 * worst state this table can be in: a tutor reads it as money they are owed, and
 * pressing Void then only reaches the gateway's BR-LED-04/05 409.
 *
 * Reading both makes the state correct from the payload alone. The two can only
 * disagree if the gateway's derivation is wrong, and where they agree the union
 * is the same answer — so this is defence in depth on the financial spine, not
 * a second opinion that could mask a fault. A row the LINKAGE names is voided
 * whether or not a flag happens to agree.
 *
 * Exported for direct test: `void-sequence.test.ts` pins the linkage arm, and
 * `ledger-table.void-state.test.ts` pins the flag arm and the union.
 */
export function isLedgerRowVoided(
  row: { id: string; isVoid?: boolean },
  voidingRowByTarget: ReadonlyMap<string, string>,
): boolean {
  return row.isVoid === true || voidingRowByTarget.has(row.id);
}

export function LedgerTable({ studentId, studentName }: LedgerTableProps) {
  const { setPaymentSheetOpen, setInvoiceSheetOpen } = useFeesStore();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [voidEntryId, setVoidEntryId] = useState<string | null>(null);
  const [voidPin, setVoidPin] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);
  // RFC-004 C1: one intent key per modal open — double-click confirm, aborted
  // POST retried, or the same void echoed from another device all replay
  // instead of double-voiding (gateway idempotency store is the enforcer).
  const [voidKey, setVoidKey] = useState<string>("");

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["ledger", studentId],
    queryFn: () => getLedgerForStudent(studentId),
  });

  // One reset path for every exit — Cancel, Escape, the scrim, and the
  // post-success clear. The intent key is re-minted on the NEXT open, never
  // reused, so a reopen cannot replay the previous confirmation.
  const closeVoidDialog = useCallback(() => {
    setVoidEntryId(null);
    setVoidPin("");
    setVoidReason("");
    setVoidError(null);
    setVoidKey("");
  }, []);

  const { panelRef, onScrimClick, confirmThenClose, setDiscardOpen, discardOpen, discardQuestion } =
    useOverlayDismiss({
      open: voidEntryId !== null,
      onClose: closeVoidDialog,
      dirty: voidPin.length > 0 || voidReason.trim().length > 0,
      label: "void form",
    });

  // No cast: LedgerEntry only ADDS optional members over the inferred row, so
  // the query array assigns directly (Rule 9 — no silent `as` forcing).
  const ledgerFailure = data && data.success === false ? data.error : null;
  const queryRows: LedgerEntry[] =
    ledgerFailure !== null || data === undefined ? [] : data.data;
  const rawEntries = queryRows;
  /**
   * The running balance, oldest → newest (Rule 6: paise helpers only — no
   * `+`/`-` on money per AGENTS §14 checklist #3).
   *
   * It used to be folded from `runningBalance = 0` across whatever rows came
   * back, and the gateway caps a student's ledger read at 200 rows
   * (`apps/gateway/routes/ledger.ts`). A tutor with 250 entries therefore saw
   * every balance from the 201st row onwards computed against nothing: the
   * 201st row showed `₹0` and the column walked up from there, so the number a
   * tutor read next to a receipt was not the student's balance. 07 §9.4 is
   * explicit that the per-student balance is read from the
   * trigger-maintained `balance_after_paise` cache, and the gateway already
   * ships that field on every row (it was in this payload, undeclared-as-used).
   *
   * The row's own stored `balance_after` is therefore the source of truth, and
   * the fold is kept ONLY for a row that has none — the optimistic row
   * `record-payment-sheet.tsx` writes into this cache, which by definition has
   * no server balance yet.
   */
  const entries: Array<LedgerEntry & { balance: number }> = [];
  let runningBalance = 0;
  for (let i = rawEntries.length - 1; i >= 0; i--) {
    const e = rawEntries[i];
    if (!e) continue;
    runningBalance = paiseSub(paiseAdd(runningBalance, e.debit ?? 0), e.credit ?? 0);
    const stored = e.balance_after;
    const balance =
      typeof stored === "number" && Number.isSafeInteger(stored) ? stored : runningBalance;
    entries.unshift({ ...e, balance });
  }

  const voidTarget = voidEntryId ? entries.find((e) => e.id === voidEntryId) : undefined;

  /**
   * Void linkage in the tutor's own terms. A void posts a reversing row whose
   * `reverses_entry_id` points at the ORIGINAL entry, so the row on screen is a
   * correction and must name what it corrects. The original's row id is an
   * implementation handle — "↺ reverses a1b2c3d4" is a string a tutor cannot
   * look up in a receipt book — so the label carries the original's RECEIPT
   * NUMBER instead, and falls back to words when the original is not in this
   * page of rows. This is a read of `reverses_entry_id` that the gateway already
   * ships; nothing here mutates the ledger (Rule 1, BR-LED-04).
   */
  const receiptByEntryId = new Map<string, string>();
  for (const e of entries) {
    if (e.receipt_no) receiptByEntryId.set(e.id, e.receipt_no);
  }
  /**
   * Which reversing row killed which original, from `reverses_entry_id`
   * (07 §6.3: "the original row shows a small '↺ voided by entry xxx' link";
   * §10.2 BR-LED-03: "the original `PAYMENT_RECEIVED` row gets a strike-through
   * and a '↺ voided by VOID entry xxx' link"). A tutor needs to see BOTH halves:
   * the payment, struck through, and the correction that struck it. The
   * gateway's `isVoid` flag (added in `routes/ledger.ts` GET /api/v1/ledger)
   * says the original is voided; this map says which row did it, so the chip on
   * the original can point at the same receipt the reversing row names.
   */
  const voidingRowByTarget = new Map<string, string>();
  for (const e of entries) {
    const target = e.reverses_entry_id ?? null;
    if (target) voidingRowByTarget.set(target, e.id);
  }
  const reasonError = (() => {
    const r = VoidReasonSchema.safeParse(voidReason);
    return r.success ? null : r.error.issues[0]?.message ?? "Invalid reason";
  })();
  /**
   * ONE PIN rule, from the shared module (`packages/shared/src/pin.ts`).
   *
   * This panel used to gate Confirm Void on `voidPin.trim().length >= 6`, while
   * `setPinAction` accepted 4-8 digits. A tutor who set a 4- or 5-digit PIN could
   * therefore never void a receipt — and voiding a reversing row is the ONLY
   * correction path an append-only ledger has (Rule 1, BR-LED-04). That is a tutor
   * permanently locked out of their own books, caused by the client inventing a
   * tighter bound than the server accepts. The client now states the same bound the
   * server enforces (`pinFormatError`), adds no gate of its own, and keeps every
   * substantive check: server-side PIN verification, the non-VOID target rule, the
   * typed reason, and the in-flight lock.
   */
  const pinError = voidPin.length > 0 ? pinFormatError(voidPin) : null;

  const voidMutation = useMutation({
    mutationFn: () => voidReceiptAction(voidEntryId ?? "", voidPin, voidReason, { intentKey: voidKey }),
    onSuccess: (res) => {
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: ["ledger"] });
        queryClient.invalidateQueries({ queryKey: ["fees-students"] });
        // Rule 9: name what changed. A void is a NEW reversing row, so the tutor
        // needs both halves of the outcome — the original is struck through, and
        // the receipt number it consumed is retired for good.
        toast.success(
          voidTarget?.receipt_no ? `Receipt ${voidTarget.receipt_no} voided` : "Receipt voided",
          "A reversing entry now sits against it in the ledger. That receipt number is retired — it is never issued again.",
        );
        closeVoidDialog();
      } else {
        // A rejection is not a throw, so it has to be surfaced here or it is a
        // silent failure (Rule 9). The dialog stays open with the reason and PIN
        // intact so the tutor can correct one field and retry.
        const copy = voidErrorCopy(res.error ?? "");
        setVoidError(copy);
        toast.error("Receipt not voided", copy);
      }
    },
    onError: (err) => {
      const copy = voidErrorCopy(err);
      setVoidError(copy);
      toast.error("Receipt not voided", copy);
    },
  });

  /**
   * EC-L-02 / BR-LED-05: a void cannot be voided. The row button already hides
   * itself for a voided original (the state a second void would target), and this
   * is the same rule stated where the decision is made, so the two can never
   * disagree — a dialog that opens on a dead payment is a dialog whose only
   * outcome is a 409.
   */
  const canConfirmVoid =
    voidTarget !== undefined &&
    voidTarget.type !== "VOID" &&
    voidTarget.isVoid !== true &&
    pinError === null &&
    reasonError === null &&
    !voidMutation.isPending;

  const openVoid = (id: string) => {
    setVoidEntryId(id);
    setVoidPin("");
    setVoidReason("");
    setVoidError(null);
    setVoidKey(mintIntentKey());
  };

  return (
    <div className="flex flex-col h-full">
      <div
        className="p-4 flex items-center justify-between gap-3 flex-wrap"
        style={{
          borderBottom: "1px solid var(--border-default)",
          background: "var(--surface-inset)",
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center font-bold shrink-0"
            style={{
              background: "linear-gradient(135deg, var(--accent-primary), var(--accent-text))",
              color: "var(--accent-on-primary)",
            }}
          >
            {studentName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2
              className="text-lg font-bold truncate"
              style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}
            >
              {studentName}&apos;s Ledger
            </h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {ledgerFailure
                ? "Ledger not loaded"
                : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setInvoiceSheetOpen(true)}
            className="btn-glass neumo-raised min-h-[44px] px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all"
            style={{ background: "var(--surface-raised)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--info)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
          >
            <Plus className="w-4 h-4" style={{ color: "var(--info)" }} /> Charge Fee
          </button>
          <button
            onClick={() => setPaymentSheetOpen(true)}
            className="btn-glass neumo-raised min-h-[44px] px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all shadow-[0_4px_12px_rgba(0,0,0,0.1)]"
            style={{ background: "linear-gradient(135deg, var(--success), var(--info))", color: "var(--accent-on-primary)", border: "none" }}
          >
            <ArrowDownToLine className="w-4 h-4" /> Record Payment
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto no-scrollbar p-3 sm:p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-primary)" }} aria-hidden="true" />
            <span className="sr-only">Loading {studentName}&apos;s ledger…</span>
          </div>
        ) : ledgerFailure ? (
          /* A failed ledger read is NOT an empty ledger. It used to render
             "No ledger entries yet. Charge a fee or record a payment to begin."
             beside a timed-out read — an invitation to duplicate-charge a student
             whose charges we simply could not see. AGENTS.md §2 Rule 9: an error
             throws or renders a typed state; it is never an empty list. */
          <ErrorState
            state={toAppErrorState(ledgerFailure)}
            onRetry={() => { void refetch(); }}
            isRetrying={isFetching}
            retryLabel="Load ledger again"
            dataStatus={`Nothing was changed and nothing was written to ${studentName}'s ledger. This is NOT an empty ledger — do not charge a fee on the strength of it.`}
          />
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-sm" style={{ color: "var(--text-muted)" }}>
            <Receipt className="w-8 h-8 opacity-40 mb-3" />
            <p>No ledger entries yet. Charge a fee or record a payment to begin.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => {
              const meta = entryMeta(entry.type);
              const isInflow = (entry.credit ?? 0) > 0;
              const amount = isInflow ? entry.credit : entry.debit;
              const amountColor = isInflow ? "var(--success)" : "var(--danger)";
              const sign = isInflow ? "+" : "−";
              const reverses = entry.reverses_entry_id ?? null;
              /**
               * Two DIFFERENT facts, previously conflated into one dim:
               *   · `isVoided` — a later row reverses THIS row. It is the original
               *     payment, dead. 07 §6.3 strikes it through and links it to the
               *     reversing entry; the gateway sends the flag, so the two used to
               *     disagree and the screen showed a voided receipt as live.
               *   · `isReversal` — THIS row is the void, i.e. it carries
               *     `reverses_entry_id`. It is a real, live correcting entry and is
               *     the one 07 §6.3 gives a flare-red left border. Dimming it would
               *     hide the audit trail BR-LED-04 exists to keep.
               */
              /**
               * Is this row dead? See `isLedgerRowVoided` above for why BOTH the
               * gateway flag and the in-payload reversing-row linkage are read —
               * trusting the flag alone shipped every voided receipt on the QA
               * tenant looking live, with an enabled Void button on it.
               */
              const isVoided = isLedgerRowVoided(entry, voidingRowByTarget);
              const isReversal = reverses !== null;
              const voidingRowId = voidingRowByTarget.get(entry.id);
              const voidedByReceipt = voidingRowId ? receiptByEntryId.get(voidingRowId) : undefined;
              return (
                <li
                  key={entry.id}
                  className={cn(
                    "group flex items-center gap-3 p-3 rounded-xl transition-colors",
                    isVoided && "opacity-60"
                  )}
                  style={{
                    background: "var(--surface-inset)",
                    border: isReversal
                      ? "1px solid color-mix(in srgb, var(--danger) 55%, transparent)"
                      : "1px solid var(--border-default)",
                    // 07 §6.3: "VOID rows — visually distinct: flare-red left
                    // border". A border on all four sides cannot say "this is the
                    // correction"; the left rail is the convention the spec names.
                    borderLeftWidth: isReversal ? "3px" : undefined,
                    borderLeftColor: isReversal ? "var(--danger)" : undefined,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-raised)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface-inset)"; }}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{
                      background: `color-mix(in srgb, ${meta.accent} 14%, transparent)`,
                      color: meta.accent,
                      border: `1px solid color-mix(in srgb, ${meta.accent} 28%, transparent)`,
                    }}
                    aria-hidden="true"
                  >
                    <meta.Icon className="w-5 h-5" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wide"
                        style={{
                          background: `color-mix(in srgb, ${meta.accent} 12%, transparent)`,
                          color: meta.accent,
                        }}
                      >
                        <meta.Icon className="w-3 h-3" aria-hidden="true" />
                        {meta.label}
                      </span>
                      <p
                        className={cn("font-semibold text-sm truncate", isVoided && "line-through")}
                        style={{ color: isVoided ? "var(--text-muted)" : "var(--text-primary)" }}
                      >
                        {entry.description || meta.label}
                      </p>
                      {isVoided && (
                        /* Rule 10 (colour is never the only signal) + 07 §6.3: the
                           strike is not enough on its own. The word VOIDED names the
                           state, and it is the word a tutor reads out loud to a
                           parent disputing a receipt. */
                        <span
                          className="text-[11px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0"
                          style={{ color: "var(--danger)", border: "1px solid var(--danger)" }}
                        >
                          Voided
                        </span>
                      )}
                      {entry.receipt_no && (
                        <span className="text-xs px-1.5 py-0.5 rounded font-mono shrink-0" style={{ color: "var(--text-muted)", border: "1px solid var(--border-default)" }}>
                          {entry.receipt_no}
                        </span>
                      )}
                    </div>
                    <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                      {format(parseISO(entry.occurred_on), "dd MMM yyyy")}
                      {entry.balance !== undefined && (
                        <span className="ml-2" style={{ color: "var(--text-secondary)" }}>
                          {/* Magnitude via a paise helper, never `Math.abs` on money (Rule 6). */}
                          Bal {formatINR(entry.balance >= 0 ? entry.balance : paiseSub(0, entry.balance))}{" "}
                          {entry.balance > 0 ? "Dr" : entry.balance < 0 ? "Cr" : ""}
                        </span>
                      )}
                      {reverses && (
                        /* A void is a NEW reversing row (Rule 1, BR-LED-04), so the
                           row a tutor is looking at is the correction and it has to
                           name what it corrects. "↺ reverses a1b2c3d4" showed them an
                           implementation handle they cannot look up in a receipt
                           book; the receipt number is the thing they CAN. When the
                           original is not in this page of rows, say so in words
                           rather than printing an id they could never resolve. */
                        <span className="ml-2 px-1.5 py-0.5 rounded" style={{ color: "var(--danger)", border: "1px solid var(--danger)" }}>
                          ↺ Reverses {receiptByEntryId.get(reverses) ?? "an earlier payment"}
                        </span>
                      )}
                      {isVoided && (
                        /* 07 §6.3: the ORIGINAL names the row that reversed it, so a
                           tutor can walk payment → correction without leaving the
                           ledger. Named by receipt number, same vocabulary as the
                           reversing row above. */
                        <span className="ml-2 px-1.5 py-0.5 rounded" style={{ color: "var(--text-muted)" }}>
                          ↳ reversed by {voidedByReceipt ?? "a later entry"}
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold num" style={{ color: amountColor }}>
                      {sign}
                      {formatINR(amount ?? 0)}
                    </p>
                    {entry.type === "PAYMENT_RECEIVED" && !isVoided && (
                      <button
                        onClick={() => openVoid(entry.id)}
                        // The Void action used to be `opacity-0 group-hover:opacity-100`,
                        // which made it invisible on a touch device (no hover) and
                        // invisible to a keyboard — on the one action in this table
                        // that touches the immutable ledger. It now rests at low
                        // opacity, comes to full on hover AND on keyboard focus, and
                        // rests at FULL strength on coarse pointers, where hover
                        // never fires (`.reveal-on-hover` in globals.css — the
                        // comment here used to claim such a rule existed; it did not).
                        className="reveal-on-hover mt-1 min-h-[44px] flex items-center gap-1 text-[11px] px-2 py-0.5 rounded transition-colors focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)] motion-safe:hover:opacity-100"
                        style={{ color: "var(--text-muted)", border: "1px solid var(--border-default)" }}
                        aria-label={`Void receipt for ${entry.description || "payment"}`}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--danger)"; e.currentTarget.style.borderColor = "var(--danger)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border-default)"; }}
                      >
                        <Ban className="w-3 h-3" /> Void
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {voidEntryId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Scrim — asks first while a reason or PIN is typed. */}
          <div
            className="absolute inset-0 [backdrop-filter:var(--mat-filter)]"
            style={{ background: "color-mix(in srgb, var(--canvas) 80%, transparent)" }}
            onClick={onScrimClick}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="void-receipt-title"
            aria-describedby="void-receipt-consequence"
            tabIndex={-1}
            className="relative rounded-2xl w-full max-w-sm p-6"
            style={{
              background: "var(--surface-overlay)",
              // docs/design/material-modes.md §2 — the void confirmation is a
              // modal (an interruptive, protected-focus surface), so it reads the
              // material token instead of a hand-written 24px blur.
              backdropFilter: "var(--mat-filter)",
              WebkitBackdropFilter: "var(--mat-filter)",
              border: "1px solid var(--danger)",
              boxShadow: "0 12px 40px var(--shadow-overlay)",
            }}
          >
            <div className="text-center space-y-4">
              <AlertTriangle className="w-12 h-12 mx-auto opacity-80" style={{ color: "var(--danger)" }} aria-hidden="true" />
              <h3 id="void-receipt-title" className="text-lg font-bold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
                Void Receipt
              </h3>
              <p id="void-receipt-consequence" className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {voidTarget?.receipt_no ? `Receipt ${voidTarget.receipt_no} · ` : ""}
                {voidTarget ? formatINR(voidTarget.credit ?? 0) : ""} — this posts a reversing
                entry against the original payment, so the entry stays in the ledger and stays
                struck through.                 The receipt number is used up for good and will never be issued
                to anyone again.
              </p>
              {/* The paragraph above states the consequence in the grammar of a
                  receipt; it does not tell the tutor what to DO afterwards, and
                  "the balance comes back" is the one fact that decides whether
                  they void or post a correction. The disclosure answers it in
                  place, under the sentence it qualifies. No void behaviour
                  changed: same action, same `{entryId, reason}` payload, same
                  intent key, same PIN gate, same eligibility rule. */}
              <Explain concept="void" className="text-left" />
              <div className="pt-2 text-left space-y-3">
                <div>
                  <label htmlFor="void-reason" className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                    Reason (required)
                  </label>
                  <textarea
                    id="void-reason"
                    value={voidReason}
                    onChange={(e) => {
                      setVoidReason(e.target.value);
                      setVoidError(null);
                    }}
                    placeholder="e.g. Wrong student — should be Ananya STU-0011"
                    rows={3}
                    aria-describedby={voidReason.length > 0 && reasonError ? "void-reason-error" : undefined}
                    aria-invalid={voidReason.length > 0 && reasonError ? true : undefined}
                    className="neumo-inset w-full px-4 py-3 min-h-[44px] text-sm focus:outline-none resize-none"
                    style={{ background: "var(--surface-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
                  />
                  {voidReason.length > 0 && reasonError && (
                    <p id="void-reason-error" className="text-xs mt-1" style={{ color: "var(--danger)" }}>{reasonError}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="void-pin" className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                    PIN ({PIN_MIN_LENGTH}–{PIN_MAX_LENGTH} digits)
                  </label>
                  <input
                    id="void-pin"
                    type="password"
                    value={voidPin}
                    onChange={(e) => {
                      setVoidPin(e.target.value);
                      setVoidError(null);
                    }}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={PIN_INPUT_MAX_LENGTH}
                    placeholder="••••••"
                    aria-describedby={voidError ? "void-error" : pinError ? "void-pin-error" : undefined}
                    aria-invalid={voidError ? true : pinError ? true : undefined}
                    className="neumo-inset w-full px-4 py-3 min-h-[44px] text-xl text-center tracking-[0.5em] font-mono focus:outline-none"
                    style={{ background: "var(--surface-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
                  />
                  {pinError && (
                    <p id="void-pin-error" className="text-xs mt-1" style={{ color: "var(--danger)" }}>{pinError}</p>
                  )}
                </div>
                {voidError && (
                  <p id="void-error" role="alert" className="text-xs" style={{ color: "var(--danger)" }}>{voidError}</p>
                )}
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={confirmThenClose}
                  className="flex-1 min-h-[44px] py-2 rounded-lg text-sm font-semibold transition-colors"
                  style={{ color: "var(--text-secondary)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => voidMutation.mutate()}
                  disabled={!canConfirmVoid}
                  aria-busy={voidMutation.isPending}
                  className="flex-1 min-h-[44px] neumo-raised py-2 rounded-lg text-sm font-bold transition-colors disabled:opacity-50"
                  style={{ background: "var(--surface-raised)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--danger)"; e.currentTarget.style.borderColor = "var(--danger)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.borderColor = "var(--border-default)"; }}
                >
                  {voidMutation.isPending ? "Voiding…" : "Confirm Void"}
                </button>
              </div>
            </div>
          </div>

          <DiscardChangesPrompt
            open={discardOpen}
            question={discardQuestion}
            onKeep={() => setDiscardOpen(false)}
            onDiscard={() => {
              setDiscardOpen(false);
              closeVoidDialog();
            }}
          />
        </div>
      )}
    </div>
  );
}
