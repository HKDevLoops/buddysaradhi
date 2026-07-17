"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateSettingAction } from "@/server/actions/settings";
import { Receipt, Loader2, Save, X, CalendarClock, Zap } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { cn } from "@/lib/utils";
import { NeumoToggle } from "./neumo-toggle";

const feeRulesSchema = z.object({
  invoicePrefix: z.string().min(1).max(10),
  receiptPrefix: z.string().min(1).max(10),
  graceDays: z.number().min(0).max(30),
});

type FeeRulesFormValues = z.infer<typeof feeRulesSchema>;

import type { Settings } from "@/types/settings";

interface FeeRulesSectionProps {
  settings: Settings;
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
      graceDays: settings?.graceDays ?? 0,
    },
  });

  useEffect(() => {
    if (isDirty) {
      markDirty("fee-rules");
    } else {
      markClean("fee-rules");
    }
  }, [isDirty, markDirty, markClean]);

  const updateMutation = useMutation({
    mutationFn: async (data: FeeRulesFormValues) => {
      await updateSettingAction("invoicePrefix", data.invoicePrefix);
      await updateSettingAction("receiptPrefix", data.receiptPrefix);
      await updateSettingAction("graceDays", data.graceDays);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      reset(variables);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: unknown }) => {
      await updateSettingAction(field, value);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });

  const onSubmit = (data: FeeRulesFormValues) => {
    updateMutation.mutate(data);
  };

  const defaultFeeModel = settings?.defaultFeeModel || "postpaid";
  const autoInvoice = settings?.autoInvoice === 1;

  const inputCls =
    "neumo-inset w-full px-4 py-3 text-sm text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]";

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">
      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Receipt className="w-5 h-5 text-[var(--accent-amber)]" />
          Default Fee Model
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => toggleMutation.mutate({ field: "defaultFeeModel", value: "prepaid" })}
            aria-pressed={defaultFeeModel === "prepaid"}
            className={cn(
              "glass-card p-5 rounded-xl flex flex-col items-start gap-2 transition-all cursor-pointer border text-left",
              defaultFeeModel === "prepaid"
                ? "border-[var(--accent-amber)] bg-[var(--surface-glass-strong)] shadow-[0_0_12px_rgba(245,158,11,0.15)]"
                : "bg-[var(--surface-glass-faint)] hover:bg-[var(--surface-glass)]"
            )}
          >
            <span className={cn("text-sm font-semibold", defaultFeeModel === "prepaid" ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>Prepaid</span>
            <span className="text-xs text-[var(--text-muted)] leading-relaxed">Fees are collected before the month begins.</span>
          </button>
          <button
            type="button"
            onClick={() => toggleMutation.mutate({ field: "defaultFeeModel", value: "postpaid" })}
            aria-pressed={defaultFeeModel === "postpaid"}
            className={cn(
              "glass-card p-5 rounded-xl flex flex-col items-start gap-2 transition-all cursor-pointer border text-left",
              defaultFeeModel === "postpaid"
                ? "border-[var(--accent-amber)] bg-[var(--surface-glass-strong)] shadow-[0_0_12px_rgba(245,158,11,0.15)]"
                : "bg-[var(--surface-glass-faint)] hover:bg-[var(--surface-glass)]"
            )}
          >
            <span className={cn("text-sm font-semibold", defaultFeeModel === "postpaid" ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>Postpaid</span>
            <span className="text-xs text-[var(--text-muted)] leading-relaxed">Fees are billed at the end of the month.</span>
          </button>
        </div>
      </div>

      <div className="h-px bg-[var(--border-glass)] w-full" />

      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Zap className="w-5 h-5 text-[var(--accent-cyan)]" />
          Automations
        </h3>
        <div className="flex items-center justify-between glass-card p-5 rounded-xl">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">Auto-Generate Invoices</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Automatically draft invoices on the billing cycle date.</p>
          </div>
          <NeumoToggle
            label="Auto-generate invoices"
            checked={autoInvoice}
            onChange={() => toggleMutation.mutate({ field: "autoInvoice", value: autoInvoice ? 0 : 1 })}
          />
        </div>
      </div>

      <div className="h-px bg-[var(--border-glass)] w-full" />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-[var(--accent-primary)]" />
          Invoicing & Grace Periods
        </h3>

        <div className="space-y-4 max-w-lg">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Invoice Prefix</label>
              <input {...register("invoicePrefix")} className={inputCls} aria-invalid={!!errors.invoicePrefix} />
              {errors.invoicePrefix && <p className="text-[var(--accent-flare)] text-xs mt-1">{errors.invoicePrefix.message}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Receipt Prefix</label>
              <input {...register("receiptPrefix")} className={inputCls} aria-invalid={!!errors.receiptPrefix} />
              {errors.receiptPrefix && <p className="text-[var(--accent-flare)] text-xs mt-1">{errors.receiptPrefix.message}</p>}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Grace Period (Days)</label>
            <div className="flex items-center gap-4">
              <input type="number" {...register("graceDays", { valueAsNumber: true })} className={`${inputCls} w-24`} aria-invalid={!!errors.graceDays} />
              <span className="text-sm text-[var(--text-muted)]">Days after due date before marking as overdue</span>
            </div>
            {errors.graceDays && <p className="text-[var(--accent-flare)] text-xs mt-1">{errors.graceDays.message}</p>}
          </div>
        </div>

        <div className="flex gap-3 pt-4 max-w-lg">
          <button
            type="button"
            onClick={() => reset()}
            disabled={updateMutation.isPending}
            className="flex-1 py-3 rounded-xl text-sm font-medium text-[var(--text-muted)] btn-glass bg-[var(--surface-glass-faint)] border border-[var(--border-glass)] hover:bg-[var(--surface-glass)] hover:text-[var(--text-primary)] disabled:opacity-30 flex items-center justify-center gap-2 cursor-pointer"
          >
            <X className="w-4 h-4" /> Discard
          </button>
          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="flex-1 neumo-raised py-3 rounded-xl text-sm font-bold text-[var(--accent-emerald)] shadow-[0_0_14px_rgba(0,255,157,0.25)] hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
          >
            {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Rules
          </button>
        </div>
      </form>
    </section>
  );
}
