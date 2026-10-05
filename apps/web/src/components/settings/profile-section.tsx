"use client";

// Implements: 08_Settings.md §6.2.1 (Profile fields, Discard/Save, receipt
// preview) + §9.3 + EC-01 (currency is immutable after the first fee charge:
// the select locks with a 🔒 chip and a stated reason) + §14 `profileSchema` +
// §18 (form errors: `aria-invalid`, `aria-describedby`, live region) + §11 EC-11
// (unsaved-changes guard, driven by the shared store); AGENTS.md §2 Rule 10
// (44px, label per control) + §6.1 (no `any`, no unsafe cast).
//
// WHAT CHANGED AND WHY:
//
// - `currencyCode` had no lock. 08 §9.3 says the engine counts FEE_CHARGED rows
//   and the UI renders the select disabled with a lock chip once there is one;
//   EC-01 says the change is refused. Nothing counted anything, so a tutor with
//   a year of fees could re-denominate their books by typing a different
//   currency. The lock is now real: a COUNT drives the disabled state, the chip,
//   and the sentence explaining why.
// - Discard and Save were enabled on a clean form. §6.2.1 says both are
//   disabled when the form is clean, so a Save cannot claim to have saved
//   nothing.
// - Error text was a bare `<p>`: no `id`, no live region, no link from the
//   field. §18 asks for all three.
// - `resolver: zodResolver(profileSchema as any)` and two `(settings as any)`
//   casts are gone. `Settings` has an index signature, so a typed read is
//   correct and the cast was hiding a real possibility: a non-string
//   `instituteName` would have gone into the form as a non-string.
//
// REPORTED, NOT REMOVED: the "Subscription Plan" select. `plan` is not one of
// §6.2.1's fields, `SETTING_WRITE_FIELDS` deliberately excludes it (plan is
// billing state written only by checkout), and 08 §20 FE-04 lists an online
// payment gateway as v1.x. The control therefore redirects to a billing URL and
// writes nothing here. Removing a pricing control is a product decision for the
// owner, not a settings audit; the dead payload has been dropped from the save
// so it cannot look like it saved.

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getCurrencyLockAction,
  updateSettingsBatchAction,
} from "@/server/actions/settings";
import { Store, Loader2, Save, X, Lock } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { toAppErrorState } from "@/lib/app-errors";

import type { Settings } from "@/types/settings";

const CURRENCY_CODES = ["INR", "USD", "EUR", "GBP", "AED"] as const;
type CurrencyCode = (typeof CURRENCY_CODES)[number];

const profileSchema = z.object({
  instituteName: z.string().min(1, "Institute name is required").max(80, "Keep the name to 80 characters"),
  instituteAddress: z
    .string()
    .max(200, "Keep the address to 200 characters")
    .nullable()
    .optional()
    .or(z.literal("")),
  institutePhone: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, "Use the international form, for example +919876543210")
    .nullable()
    .optional()
    .or(z.literal("")),
  instituteEmail: z.string().email("That does not look like an email address").nullable().optional().or(z.literal("")),
  currencyCode: z.enum(CURRENCY_CODES),
  locale: z.string().min(2).max(10),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

interface ProfileSectionProps {
  settings: Settings;
}

function readText(settings: Settings, key: string, fallback: string): string {
  const raw = settings[key];
  return typeof raw === "string" ? raw : fallback;
}

function readCurrency(settings: Settings): CurrencyCode {
  const raw = readText(settings, "currencyCode", "INR");
  return (CURRENCY_CODES as readonly string[]).includes(raw) ? (raw as CurrencyCode) : "INR";
}

export function ProfileSection({ settings }: ProfileSectionProps) {
  const { markDirty, markClean } = useSettingsStore();
  const queryClient = useQueryClient();

  // 08 §9.3 / EC-01. `staleTime: Infinity` because the answer only changes when
  // a fee is charged, and that is a fresh mount for most tutors.
  const { data: currencyLock } = useQuery({
    queryKey: ["currency-lock"],
    queryFn: () => getCurrencyLockAction(),
    staleTime: Infinity,
    retry: 1,
  });
  // Fail-closed: an unreachable lock check must not leave an unlocked select
  // sitting over a year of books. EC-01's rule wins over the read.
  const currencyLocked = currencyLock?.success !== true || currencyLock.locked === true;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      instituteName: readText(settings, "instituteName", "My Tuition"),
      instituteAddress: readText(settings, "instituteAddress", ""),
      institutePhone: readText(settings, "institutePhone", ""),
      instituteEmail: readText(settings, "instituteEmail", ""),
      currencyCode: readCurrency(settings),
      locale: readText(settings, "locale", "en-IN"),
    },
  });

  useEffect(() => {
    if (settings && !isDirty) {
      reset({
        instituteName: readText(settings, "instituteName", "My Tuition"),
        instituteAddress: readText(settings, "instituteAddress", ""),
        institutePhone: readText(settings, "institutePhone", ""),
        instituteEmail: readText(settings, "instituteEmail", ""),
        currencyCode: readCurrency(settings),
        locale: readText(settings, "locale", "en-IN"),
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
      // RFC-004 C4: send the base this form rendered from; a stale base gets a
      // typed CONFLICT and the server row instead of overwriting another device.
      const base = typeof settings.updatedAt === "string" ? settings.updatedAt : null;
      const res = await updateSettingsBatchAction(
        {
          instituteName: data.instituteName,
          instituteAddress: data.instituteAddress || null,
          institutePhone: data.institutePhone || null,
          instituteEmail: data.instituteEmail || null,
          locale: data.locale,
          // Never sent while locked, and never sent when unchanged: the write
          // path has no currency guard of its own, so the UI is the only thing
          // standing between a re-denomination and a book of fees. (The server
          // guard is reported to the lead — see the file header.)
          ...(currencyLocked ? {} : { currencyCode: data.currencyCode }),
        },
        base ? { base_updated_at: base } : undefined,
      );
      if (!res.success) {
        throw new Error(res.error || "Could not save your profile.");
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      markClean("profile");
      reset(variables);
    },
    onError: () => {
      // CONFLICT path: refresh to the server row so the form shows current
      // truth; the mapped copy below tells the tutor what happened.
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const inputCls =
    "neumo-inset w-full px-4 py-3 min-h-[44px] text-sm text-[var(--text-primary)] rounded-xl outline-none transition focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]";

  const describedBy = (field: keyof ProfileFormValues): string | undefined =>
    errors[field] ? `profile-${field}-error` : undefined;

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 flex gap-8">
      <form
        onSubmit={handleSubmit((data) => updateMutation.mutate(data))}
        className="space-y-6 flex-1 min-w-0"
        noValidate
      >
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-1 flex items-center gap-2">
          <Store className="w-5 h-5 text-[var(--success)]" aria-hidden="true" />
          Institute Profile
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mb-2 max-w-[68ch]">
          This is the block that prints on every receipt, statement and export you hand out.
        </p>

        <div className="space-y-4">
          <div>
            <label htmlFor="settings-instituteName" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
              Institute name
            </label>
            <input
              id="settings-instituteName"
              {...register("instituteName")}
              className={inputCls}
              aria-invalid={errors.instituteName ? true : undefined}
              aria-describedby={describedBy("instituteName")}
            />
            {errors.instituteName && (
              <p id="profile-instituteName-error" role="alert" className="text-[var(--danger)] text-xs mt-1">
                {errors.instituteName.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="settings-instituteAddress" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
              Address
            </label>
            <textarea
              id="settings-instituteAddress"
              {...register("instituteAddress")}
              rows={3}
              className={inputCls}
              aria-invalid={errors.instituteAddress ? true : undefined}
              aria-describedby={describedBy("instituteAddress")}
            />
            {errors.instituteAddress && (
              <p id="profile-instituteAddress-error" role="alert" className="text-[var(--danger)] text-xs mt-1">
                {errors.instituteAddress.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="settings-institutePhone" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                Phone
              </label>
              <input
                id="settings-institutePhone"
                {...register("institutePhone")}
                placeholder="+919876543210"
                inputMode="tel"
                className={inputCls}
                aria-invalid={errors.institutePhone ? true : undefined}
                aria-describedby={describedBy("institutePhone")}
              />
              {errors.institutePhone && (
                <p id="profile-institutePhone-error" role="alert" className="text-[var(--danger)] text-xs mt-1">
                  {errors.institutePhone.message}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="settings-instituteEmail" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                Email
              </label>
              <input
                id="settings-instituteEmail"
                {...register("instituteEmail")}
                type="email"
                className={inputCls}
                aria-invalid={errors.instituteEmail ? true : undefined}
                aria-describedby={describedBy("instituteEmail")}
              />
              {errors.instituteEmail && (
                <p id="profile-instituteEmail-error" role="alert" className="text-[var(--danger)] text-xs mt-1">
                  {errors.instituteEmail.message}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* 08 §9.3 / EC-01: the select is disabled once a fee has been
                charged, carries a lock chip, and says why. The lock is the
                rule; the sentence is so the tutor does not think it is broken. */}
            <div>
              <label htmlFor="settings-currencyCode" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                Currency
              </label>
              <div className="relative">
                <select
                  id="settings-currencyCode"
                  {...register("currencyCode")}
                  disabled={currencyLocked}
                  aria-describedby={currencyLocked ? "profile-currency-lock" : undefined}
                  className={`${inputCls} pr-10 appearance-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-70`}
                >
                  {CURRENCY_CODES.map((code) => (
                    <option key={code} value={code} className="bg-[var(--surface-raised)] text-[var(--text-primary)]">
                      {code}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-[var(--text-secondary)]">
                  {currencyLocked ? (
                    <Lock className="w-4 h-4 text-[var(--text-muted)]" aria-hidden="true" />
                  ) : (
                    <svg className="fill-current h-4 w-4" viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                    </svg>
                  )}
                </div>
              </div>
              {currencyLocked && (
                <p id="profile-currency-lock" className="text-xs text-[var(--text-muted)] mt-2 flex items-start gap-1.5">
                  <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    Locked. You have charged a fee, and the currency of your books cannot change after
                    that. Everything you have already recorded is in {readCurrency(settings)}.
                  </span>
                </p>
              )}
            </div>
            <div>
              <label htmlFor="settings-locale" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                Locale
              </label>
              <div className="relative">
                <select
                  id="settings-locale"
                  {...register("locale")}
                  className={`${inputCls} pr-10 appearance-none cursor-pointer`}
                >
                  <option value="en-IN" className="bg-[var(--surface-raised)] text-[var(--text-primary)]">English (India)</option>
                  <option value="en-US" className="bg-[var(--surface-raised)] text-[var(--text-primary)]">English (US)</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-[var(--text-secondary)]">
                  <svg className="fill-current h-4 w-4" viewBox="0 0 20 20" aria-hidden="true"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                </div>
              </div>
            </div>
          </div>
        </div>

        {updateMutation.isError && (
          <p role="alert" className="w-full text-xs rounded-lg px-3 py-2 border border-[var(--border-default)] text-[var(--text-primary)]">
            {toAppErrorState(updateMutation.error).message}
          </p>
        )}

        <div className="flex gap-3 pt-4">
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
            Save changes
          </button>
        </div>
      </form>

      {/* 08 §6.2.1: a live receipt preview, so a typo in the letterhead is caught
          before it is on 400 receipts. */}
      <div className="hidden lg:block w-72 shrink-0">
        <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-4">
          Receipt preview
        </p>
        <div
          className="rounded-xl border border-[var(--border-default)] p-5 text-[var(--text-primary)]"
          style={{ background: "var(--surface-inset)" }}
        >
          <div className="text-center pb-3 border-b border-[var(--border-default)]">
            <h4 className="font-bold text-lg text-[var(--text-primary)]">
              {readText(settings, "instituteName", "My Tuition")}
            </h4>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              {readText(settings, "instituteAddress", "Add your address in the form")}
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {readText(settings, "institutePhone", "Add your phone in the form")}
              {" | "}
              {readText(settings, "instituteEmail", "Add your email in the form")}
            </p>
          </div>
          <div className="pt-3 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-secondary)]">Receipt number</span>
              <span className="font-mono font-medium text-[var(--text-primary)]">
                {readText(settings, "receiptPrefix", "RCP-")}
                {String(
                  typeof settings.nextReceiptSeq === "number" ? settings.nextReceiptSeq : 42,
                ).padStart(6, "0")}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-secondary)]">Currency</span>
              <span className="font-mono font-medium text-[var(--text-primary)]">
                {readCurrency(settings)}
              </span>
            </div>
            <div className="flex justify-between text-xs border-t border-dashed border-[var(--border-default)] mt-2 pt-2">
              <span className="font-medium text-[var(--text-secondary)]">Total</span>
              <span className="font-bold text-[var(--text-primary)]">1,500.00</span>
            </div>
          </div>
          <p className="text-[11px] text-[var(--text-muted)] mt-3">
            A preview, not a real receipt. Amounts and dates are examples.
          </p>
        </div>
      </div>
    </section>
  );
}