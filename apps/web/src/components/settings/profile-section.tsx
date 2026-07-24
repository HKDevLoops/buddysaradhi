/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateSettingAction, updateSettingsBatchAction } from "@/server/actions/settings";
import { Store, Loader2, Save, X } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";

import type { Settings } from "@/types/settings";

const profileSchema = z.object({
  instituteName: z.string().min(1, "Institute name is required").max(80),
  instituteAddress: z.string().max(200).nullable().optional(),
  institutePhone: z
    .string()
    .regex(/^\+?[0-9\s\-]{7,20}$/, "Invalid phone format (e.g., +91 98765 43210)")
    .nullable()
    .optional()
    .or(z.literal("")),
  instituteEmail: z.string().email("Invalid email").nullable().optional().or(z.literal("")),
  currencyCode: z.enum(["INR", "USD", "EUR", "GBP", "AED"]),
  locale: z.string().min(2).max(10),
  plan: z.enum(["free", "growth", "institute"]),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

interface ProfileSectionProps {
  settings: Settings;
}

export function ProfileSection({ settings }: ProfileSectionProps) {
  const { markDirty, markClean } = useSettingsStore();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      instituteName: settings?.instituteName || "My Tuition",
      instituteAddress: settings?.instituteAddress || "",
      institutePhone: settings?.institutePhone || "",
      instituteEmail: settings?.instituteEmail || "",
      currencyCode: (settings?.currencyCode as "INR" | "USD" | "EUR" | "GBP" | "AED") || "INR",
      locale: settings?.locale || "en-IN",
      plan: (settings?.plan as "free" | "growth" | "institute") || "free",
    },
  });

  useEffect(() => {
    if (settings && !isDirty) {
      reset({
        instituteName: settings?.instituteName || "My Tuition",
        instituteAddress: settings?.instituteAddress || "",
        institutePhone: settings?.institutePhone || "",
        instituteEmail: settings?.instituteEmail || "",
        currencyCode: (settings?.currencyCode as any) || "INR",
        locale: settings?.locale || "en-IN",
        plan: (settings?.plan as any) || "free",
      });
    }
  }, [settings, isDirty, reset]);

  useEffect(() => {
    if (isDirty) {
      markDirty("profile");
    } else {
      markClean("profile");
    }
  }, [isDirty, markDirty, markClean]);

  const updateMutation = useMutation({
    mutationFn: async (data: ProfileFormValues) => {
      if (data.plan !== "free" && data.plan !== settings?.plan) {
        const tenantId = settings?.tenantId || "local-dev";
        window.location.href = `http://localhost:3010/checkout?plan=${data.plan}&tenantId=${tenantId}`;
        return;
      }
      const res = await updateSettingsBatchAction({
        instituteName: data.instituteName,
        instituteAddress: data.instituteAddress || null,
        institutePhone: data.institutePhone || null,
        instituteEmail: data.instituteEmail || null,
        currencyCode: data.currencyCode,
        locale: data.locale,
        plan: data.plan,
      });
      if (!res.success) {
        throw new Error(res.error || "Failed to update settings");
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      markClean("profile");
      reset(variables);
    },
  });

  const onSubmit = (data: ProfileFormValues) => {
    updateMutation.mutate(data);
  };

  const inputCls =
    "neumo-inset w-full px-4 py-3 text-sm text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]";

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 flex gap-8">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 flex-1">
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Store className="w-5 h-5 text-[var(--accent-emerald)]" />
          Institute Profile
        </h3>

        <div className="space-y-4">
          <div>
            <label htmlFor="settings-instituteName" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Institute Name</label>
            <input id="settings-instituteName" {...register("instituteName")} className={inputCls} aria-invalid={!!errors.instituteName} />
            {errors.instituteName && <p className="text-[var(--accent-flare)] text-xs mt-1">{errors.instituteName.message}</p>}
          </div>

          <div>
            <label htmlFor="settings-instituteAddress" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Address</label>
            <textarea id="settings-instituteAddress" {...register("instituteAddress")} rows={3} className={inputCls} aria-invalid={!!errors.instituteAddress} />
            {errors.instituteAddress && <p className="text-[var(--accent-flare)] text-xs mt-1">{errors.instituteAddress.message}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="settings-institutePhone" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Phone</label>
              <input id="settings-institutePhone" {...register("institutePhone")} placeholder="+919876543210" className={inputCls} aria-invalid={!!errors.institutePhone} />
              {errors.institutePhone && <p className="text-[var(--accent-flare)] text-xs mt-1">{errors.institutePhone.message}</p>}
            </div>
            <div>
              <label htmlFor="settings-instituteEmail" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Email</label>
              <input id="settings-instituteEmail" {...register("instituteEmail")} type="email" className={inputCls} aria-invalid={!!errors.instituteEmail} />
              {errors.instituteEmail && <p className="text-[var(--accent-flare)] text-xs mt-1">{errors.instituteEmail.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Currency</label>
              <div className="relative">
                <select {...register("currencyCode")} className={`${inputCls} appearance-none pr-10 cursor-pointer`} aria-label="Currency">
                  <option value="INR" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">INR (₹)</option>
                  <option value="USD" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">USD ($)</option>
                  <option value="EUR" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">EUR (€)</option>
                  <option value="GBP" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">GBP (£)</option>
                  <option value="AED" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">AED (د.إ)</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-[var(--text-secondary)]">
                  <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Locale</label>
              <div className="relative">
                <select {...register("locale")} className={`${inputCls} appearance-none pr-10 cursor-pointer`} aria-label="Locale">
                  <option value="en-IN" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">English (India)</option>
                  <option value="en-US" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">English (US)</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-[var(--text-secondary)]">
                  <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Subscription Plan</label>
              <div className="relative">
                <select {...register("plan")} className={`${inputCls} appearance-none pr-10 cursor-pointer`} aria-label="Subscription Plan">
                  <option value="free" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Free Plan (Limit: 60 students)</option>
                  <option value="growth" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Growth Plan (Limit: 300 students)</option>
                  <option value="institute" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Institute Plan (Unlimited)</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-[var(--text-secondary)]">
                  <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-4">
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
            Save Changes
          </button>
        </div>
      </form>

      <div className="hidden lg:block w-72 shrink-0">
        <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-4">Receipt Preview</label>
        <div className="glass-card rounded-xl p-5 text-[var(--text-primary)]">
          <div className="text-center pb-3 border-b border-[var(--border-glass)]">
            <h4 className="font-bold text-lg text-[var(--text-primary)]">{settings?.instituteName || "My Tuition"}</h4>
            <p className="text-xs text-[var(--text-secondary)] mt-1">{settings?.instituteAddress || "No. 42, Glass Tower, Cosmic City"}</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {settings?.institutePhone ? `Tel: ${settings.institutePhone}` : "Tel: +91 98765 43210"}
              {" | "}
              {settings?.instituteEmail || "contact@institution.com"}
            </p>
          </div>
          <div className="pt-3 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-secondary)]">Receipt No:</span>
              <span className="font-mono font-medium text-[var(--text-primary)]">{settings?.receiptPrefix || "RCP-"}000042</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-secondary)]">Date:</span>
              <span className="font-mono font-medium text-[var(--text-primary)]">01 Sep 2026</span>
            </div>
            <div className="flex justify-between text-xs border-t border-dashed border-[var(--border-glass)] mt-2 pt-2">
              <span className="font-medium text-[var(--text-secondary)]">Total Amount</span>
              <span className="font-bold text-[var(--text-primary)]">{settings?.currencyCode === "USD" ? "$" : "₹"}1,500.00</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
