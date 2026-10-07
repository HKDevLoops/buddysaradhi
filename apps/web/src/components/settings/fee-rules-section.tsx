"use client";

// Implements: 08_Settings.md §6.2.4 (Fee Rules fields, prefix audit, read-only
// sequence displays) + §14 `feeRulesSchema` + §11 EC-17 (a non-alphanumeric
// prefix is refused) + EC-18; §9.2 (one write, one audit row, one
// transaction); 12_Business_Rules.md BR-FEE-02 (new students inherit the
// default), BR-FEE-04 / BR-RC-01 (monotonic sequences, never recycled);
// AGENTS.md §2 Rule 10 (44px, label per control) + §6.1 (no `any`).
//
// WHAT CHANGED AND WHY (four defects, every one reachable by a tutor):
//
// - `invoicePrefix` / `receiptPrefix` had `min(1).max(10)` and no character
//   rule. These two strings are pasted into every receipt and invoice number
//   for the rest of the business, so a stray quote or a space would have become
//   a permanent part of the numbering. 08 §14 requires `/^[A-Za-z0-9-]+$/` and
//   EC-17 requires a refusal message; both now exist.
// - Saving fired three separate `updateSettingAction` calls. If the second
//   failed the first was already committed, so the invoice prefix would have
//   moved while the receipt prefix had not, with three audit rows claiming
//   three changes. One `updateSettingsBatchAction` is one transaction with one
//   audit row (Rule 7 + §9.2).
// - `defaultFeeModel` offered prepaid and postpaid only. §14's enum has three
//   values and `mixed` is how an institute with a mix of both actually runs.
// - The read-only `nextInvoiceSeq` / `nextReceiptSeq` counters §6.2.4 asks for
//   were absent, so a tutor could not see how far their numbering had got.

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateSettingAction, updateSettingsBatchAction } from "@/server/actions/settings";
import { Receipt, Loader2, Save, X, CalendarClock, Zap, Hash } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { toAppErrorState } from "@/lib/app-errors";
import { cn } from "@/lib/utils";
import { NeumoToggle } from "./neumo-toggle";

import type { Settings } from "@/types/settings";

const PREFIX_RULE = /^[A-Za-z0-9-]+$/;

const feeRulesSchema = z.object({
  invoicePrefix: z
    .string()
    .min(1, "An invoice prefix is required")
    .max(10, "Keep the prefix to 10 characters")
    .regex(PREFIX_RULE, "Letters, digits and hyphens only"),
  receiptPrefix: z
    .string()
    .min(1, "A receipt prefix is required")
    .max(10, "Keep the prefix to 10 characters")
    .regex(PREFIX_RULE, "Letters, digits and hyphens only"),
  graceDays: z
    .number({ message: "Days must be a whole number" })
    .int("Days must be a whole number")
    .min(0, "Cannot be negative")
    .max(30, "The grace period tops out at 30 days"),
});

type FeeRulesFormValues = z.infer<typeof feeRulesSchema>;

const FEE_MODELS = [
  { id: "prepaid", label: "Prepaid", body: "Fees are collected before the month begins." },
  { id: "postpaid", label: "Postpaid", body: "Fees are billed at the end of the month." },
  { id: "mixed", label: "Mixed", body: "Each student is on their own plan. New students start on postpaid." },
] as const;

type FeeModelId = (typeof FEE_MODELS)[number]["id"];

interface FeeRulesSectionProps {
  settings: Settings;
}

/** Settings arrive with both spellings on some reads; take the first number. */
function readNumber(settings: Settings, camel: string, snake: string, fallback: number): number {
  const raw = settings[camel] ?? settings[snake];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

export function FeeRulesSection({ settings }: FeeRulesSectionProps) {
  const { markDirty, markClean } = useSettingsStore();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<FeeRulesFormValues>({
    resolver: zodResolver(feeRulesSchema),
    defaultValues: {
      invoicePrefix: settings?.invoicePrefix || "INV-",
      receiptPrefix: settings?.receiptPrefix || "RCP-",
      graceDays: readNumber(settings, "graceDays", "grace_days", 0),
    },
  });

  useEffect(() => {
    if (settings && !isDirty) {
      reset({
        invoicePrefix: settings?.invoicePrefix || "INV-",
        receiptPrefix: settings?.receiptPrefix || "RCP-",
        graceDays: readNumber(settings, "graceDays", "grace_days", 0),
      });
    }
  }, [settings, isDirty, reset]);

  useEffect(() => {
    if (isDirty) {
      markDirty("fee-rules");
    } else {
      markClean("fee-rules");
    }
  }, [isDirty, markDirty, markClean]);

  // One action, one transaction, one audit row (08 §9.2, Rule 7).
  const updateMutation = useMutation({
    mutationFn: async (data: FeeRulesFormValues) => {
      const res = await updateSettingsBatchAction({
        invoicePrefix: data.invoicePrefix,
        receiptPrefix: data.receiptPrefix,
        graceDays: data.graceDays,
      });
      if (!res.success) throw new Error(res.error || "Could not save the fee rules.");
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      markClean("fee-rules");
      reset(variables);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: unknown }) => {
      const res = await updateSettingAction(field, value);
      if (!res.success) throw new Error(res.error || "Could not save that change.");
    },
    onMutate: async ({ field, value }) => {
      await queryClient.cancelQueries({ queryKey: ["settings"] });
      const previous = queryClient.getQueryData<{ data?: Record<string, unknown> }>(["settings"]);
      queryClient.setQueryData(["settings"], (old: { data?: Record<string, unknown> } | undefined) => {
        if (!old) return old;
        return { ...old, data: { ...(old.data ?? {}), [field]: value } };
      });
      return { previous };
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(["settings"], context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const defaultFeeModel = (settings?.defaultFeeModel || "postpaid") as FeeModelId;
  const autoInvoice = settings?.autoInvoice === 1;
  const nextInvoiceSeq = readNumber(settings, "nextInvoiceSeq", "next_invoice_seq", 1);
  const nextReceiptSeq = readNumber(settings, "nextReceiptSeq", "next_receipt_seq", 1);
  const invoicePrefix = settings?.invoicePrefix || "INV-";
  const receiptPrefix = settings?.receiptPrefix || "RCP-";

  const inputCls =
    "neumo-inset w-full px-4 py-3 min-h-[44px] text-sm text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]";

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">
      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-1 flex items-center gap-2">
          <Receipt className="w-5 h-5 text-[var(--warning)]" aria-hidden="true" />
          Default Fee Model
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mb-4 max-w-[68ch]">
          What a new student gets when you add them. Every existing student keeps their own plan, so
          changing this never rewrites anyone&apos;s history.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" role="group" aria-label="Default fee model">
          {FEE_MODELS.map((model) => {
            const active = defaultFeeModel === model.id;
            return (
              <button
                key={model.id}
                type="button"
                onClick={() => toggleMutation.mutate({ field: "defaultFeeModel", value: model.id })}
                aria-pressed={active}
                className={cn(
                  "neumo-inset min-h-[44px] p-4 rounded-xl flex flex-col items-start gap-1 text-left cursor-pointer border transition-colors",
                  active
                    ? "border-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_14%,transparent)]"
                    : "border-transparent hover:border-[var(--border-default)]",
                )}
              >
                <span
                  className={cn(
                    "text-sm font-semibold",
                    active ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
                  )}
                >
                  {model.label}
                  {active ? <span className="sr-only"> (current default)</span> : null}
                </span>
                <span className="text-xs text-[var(--text-muted)] leading-relaxed">{model.body}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="h-px bg-[var(--border-default)] w-full" />

      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-1 flex items-center gap-2">
          <Zap className="w-5 h-5 text-[var(--info)]" aria-hidden="true" />
          Automations
        </h3>
        <div
          className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border-default)] p-5"
          style={{ background: "var(--surface-inset)" }}
        >
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">Auto-Generate Invoices</p>
            <p className="text-xs text-[var(--text-muted)] mt-1 max-w-[48ch]">
              Draft next month&apos;s invoice for each active student instead of charging one at a
              time.
            </p>
          </div>
          <NeumoToggle
            label="Auto-generate invoices"
            checked={autoInvoice}
            onChange={() => toggleMutation.mutate({ field: "autoInvoice", value: autoInvoice ? 0 : 1 })}
          />
        </div>
      </div>

      <div className="h-px bg-[var(--border-default)] w-full" />

      <form onSubmit={handleSubmit((data) => updateMutation.mutate(data))} className="space-y-6">
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-1 flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-[var(--accent-primary)]" aria-hidden="true" />
          Invoicing &amp; Grace Periods
        </h3>
        <p className="text-sm text-[var(--text-secondary)] max-w-[68ch]">
          A prefix is the fixed front of every number you hand out. Letters, digits and hyphens
          only: it is printed on a receipt, and it cannot be edited later without leaving a gap in
          your records.
        </p>

        {updateMutation.isError && (
          <p role="alert" className="text-[var(--danger)] text-sm font-semibold">
            {/* Rule 9 + 10_Security.md: mapped, never a raw echo. The mutation
                error carries whatever the server returned, and rendering
                `error.message` verbatim puts driver text and payload fragments
                in the DOM. `toAppErrorState` is the boundary; for a VALIDATION
                refusal it now carries the field's own reason through the bounded
                `detail` allowlist, so the tutor still learns WHY. */}
            {toAppErrorState(updateMutation.error).message}
          </p>
        )}

        <div className="space-y-4 max-w-lg">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="fee-invoicePrefix"
                className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2"
              >
                Invoice prefix
              </label>
              <input
                id="fee-invoicePrefix"
                {...register("invoicePrefix")}
                className={inputCls}
                aria-invalid={errors.invoicePrefix ? true : undefined}
                aria-describedby={errors.invoicePrefix ? "fee-invoicePrefix-error" : undefined}
              />
              {errors.invoicePrefix && (
                <p id="fee-invoicePrefix-error" role="alert" className="text-[var(--danger)] text-xs mt-1">
                  {errors.invoicePrefix.message}
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="fee-receiptPrefix"
                className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2"
              >
                Receipt prefix
              </label>
              <input
                id="fee-receiptPrefix"
                {...register("receiptPrefix")}
                className={inputCls}
                aria-invalid={errors.receiptPrefix ? true : undefined}
                aria-describedby={errors.receiptPrefix ? "fee-receiptPrefix-error" : undefined}
              />
              {errors.receiptPrefix && (
                <p id="fee-receiptPrefix-error" role="alert" className="text-[var(--danger)] text-xs mt-1">
                  {errors.receiptPrefix.message}
                </p>
              )}
            </div>
          </div>

          <div>
            <label
              htmlFor="fee-graceDays"
              className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2"
            >
              Grace period (days)
            </label>
            <div className="flex flex-wrap items-center gap-4">
              <input
                id="fee-graceDays"
                type="number"
                min={0}
                max={30}
                {...register("graceDays", { valueAsNumber: true })}
                className={`${inputCls} w-28`}
                aria-invalid={errors.graceDays ? true : undefined}
                aria-describedby={errors.graceDays ? "fee-graceDays-error" : undefined}
              />
              <span className="text-sm text-[var(--text-muted)]">
                After the due date, before a fee counts as late
              </span>
            </div>
            {errors.graceDays && (
              <p id="fee-graceDays-error" role="alert" className="text-[var(--danger)] text-xs mt-1">
                {errors.graceDays.message}
              </p>
            )}
          </div>
        </div>

        {/* 08 §6.2.4: the counters are read-only by design (BR-FEE-04 /
            BR-RC-01 — a sequence is monotonic and a void never rewinds one, so
            a gap is evidence rather than a mistake). The next number is shown so
            the effect of a prefix change is legible before it is saved. */}
        <div
          className="rounded-xl border border-[var(--border-default)] p-4 max-w-lg"
          style={{ background: "var(--surface-inset)" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Hash className="w-4 h-4 text-[var(--text-secondary)]" aria-hidden="true" />
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">Numbering so far</h4>
          </div>
          <dl className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-xs text-[var(--text-muted)]">Next invoice number</dt>
              <dd className="text-sm font-mono text-[var(--text-primary)]">
                {invoicePrefix}
                {String(nextInvoiceSeq).padStart(6, "0")}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-xs text-[var(--text-muted)]">Next receipt number</dt>
              <dd className="text-sm font-mono text-[var(--text-primary)]">
                {receiptPrefix}
                {String(nextReceiptSeq).padStart(6, "0")}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-[var(--text-muted)] mt-3 max-w-[52ch]">
            Voiding a receipt leaves a gap rather than reusing the number, so the same number is never
            handed to two people. Do not close a gap.
          </p>
        </div>

        <div className="flex gap-3 max-w-lg">
          <button
            type="button"
            onClick={() => reset()}
            disabled={updateMutation.isPending || !isDirty}
            className="flex-1 py-3 min-h-[44px] rounded-xl text-sm font-medium text-[var(--text-muted)] cursor-pointer border border-[var(--border-default)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <X className="w-4 h-4" aria-hidden="true" /> Discard
          </button>
          <button
            type="submit"
            disabled={updateMutation.isPending || !isDirty}
            aria-busy={updateMutation.isPending}
            className="flex-1 neumo-raised py-3 min-h-[44px] rounded-xl text-sm font-bold text-[var(--success)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer transition-colors hover:brightness-110"
          >
            {updateMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <Save className="w-4 h-4" aria-hidden="true" />
            )}
            Save rules
          </button>
        </div>
      </form>
    </section>
  );
}