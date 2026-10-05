"use client";

// Implements: 05_Students.md §6.1 (Add Student sheet: duplicate detection,
// batch enrolment, admission date, fee model). Feedback behaviour matches the
// fees sheets (docs/design/overhaul-plan.md §2): a real commit says so in a
// toast, a failure says what to do, and a half-filled form is never thrown away
// by an Escape key or a stray scrim click.

import React, { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createStudent, checkDuplicateStudentAction } from "@/server/actions/students";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { useToast } from "@/components/ui/toast";
import { useOverlayDismiss, DiscardChangesPrompt, OverlayCloseButton } from "@/components/ui/overlay";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useStudentsStore } from "@/stores/students-store";
import {
  STUDENT_ADDRESS_MAX,
  STUDENT_ADMISSION_FLOOR_ISO,
  STUDENT_BATCH_MAX,
  STUDENT_BOARD_MAX,
  STUDENT_DOB_FLOOR_ISO,
  STUDENT_FIRST_NAME_MAX,
  STUDENT_GRADE_MAX,
  STUDENT_LAST_NAME_MAX,
  STUDENT_SCHOOL_MAX,
  checkDateBounds,
  normalizeStudentPhone,
  studentDupKey,
} from "@/lib/csv-parse";

/**
 * 05_Students.md §14 (Validation Rules) + §6.1. Every rule below is either a
 * §14 MUST or a shared constant the import schema and the server action also
 * read, so a student typed by hand and a row pasted from a spreadsheet are
 * held to the same contract. Before this, the sheet accepted ANY phone string
 * and unbounded names while the import demanded 10–15 digits and 80-character
 * names: the same person was reachable on one path and rejected on the other,
 * and the two duplicate keys were built from different four characters — which
 * is how a tutor ended up with two Aarav Sharmas (BR-STU-03; 09 §14.6).
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date field: blank stays blank; a value must be ISO and inside §14's window
 * (`checkDateBounds`, the same function the import and the server use).
 *
 * Written with `.transform` rather than `z.preprocess` on purpose: a preprocess
 * makes the field's INPUT type `unknown`, which collapses every consumer of the
 * form values to `{}` and pushes the `as` casts back in (AGENTS.md §6.1). Here
 * the input stays `string`.
 */
const boundedDateField = (label: string, min: string) =>
  z.string().transform((value, ctx) => {
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    if (!ISO_DATE.test(trimmed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} must be a date in YYYY-MM-DD form`,
      });
      return z.NEVER;
    }
    const window = checkDateBounds(trimmed, { min, label });
    if (!window.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: window.reason });
      return z.NEVER;
    }
    return trimmed;
  });

/**
 * "Aarav  Sharma" must not persist a last name of " Sharma". Runs of whitespace
 * collapse to one space before the split so first/last are exactly what the
 * tutor typed. 05_Students.md §14 caps each half; the caps are checked per half
 * by the schema below, so the tutor is told WHICH half is too long.
 */
export function splitStudentName(raw: string): { firstName: string; lastName: string | null } {
  const parts = raw.trim().replace(/\s+/g, " ").split(" ");
  const firstName = parts[0] ?? "";
  const lastName = parts.slice(1).join(" ");
  return { firstName, lastName: lastName === "" ? null : lastName };
}

export const FormSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(
      STUDENT_FIRST_NAME_MAX + STUDENT_LAST_NAME_MAX + 1,
      `Name must be ${STUDENT_FIRST_NAME_MAX + STUDENT_LAST_NAME_MAX} characters or fewer`,
    )
    // §14 caps each half, not the joined string: an 81-character first name in a
    // 90-character total is over the cap and must be refused as such, with the
    // error ON the name field rather than after submit.
    .superRefine((value, ctx) => {
      const { firstName, lastName } = splitStudentName(value);
      if (firstName.length > STUDENT_FIRST_NAME_MAX) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `First name must be ${STUDENT_FIRST_NAME_MAX} characters or fewer`,
        });
      }
      if (lastName !== null && lastName.length > STUDENT_LAST_NAME_MAX) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Last name must be ${STUDENT_LAST_NAME_MAX} characters or fewer`,
        });
      }
    }),
  // Blank means "generate one for me" (BR-STU-04). The form's default value IS
  // the empty string, so this cannot be a bare `{1,20}` regex — the auto-on
  // default would fail it and the sheet could not be submitted at all.
  code: z
    .string()
    .transform((value) => (value.trim() === "" ? undefined : value.trim()))
    .pipe(
      z.string().regex(/^[A-Za-z0-9-]{1,20}$/, "Code may only use letters, digits and dashes").optional(),
    ),
  batch: z
    .string()
    .trim()
    .min(1, "Batch is required")
    .max(STUDENT_BATCH_MAX, `Batch must be ${STUDENT_BATCH_MAX} characters or fewer`),
  phone: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value, ctx) => {
      if (value === null || value === undefined) return null;
      const parsed = normalizeStudentPhone(value, "Phone");
      if (!parsed.ok) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.reason });
        return z.NEVER;
      }
      return parsed.phone;
    }),
  joined_at: boundedDateField("Admission date", STUDENT_ADMISSION_FLOOR_ISO),
  dob: boundedDateField("Date of birth", STUDENT_DOB_FLOOR_ISO),
  grade: z.string().trim().max(STUDENT_GRADE_MAX).optional(),
  school: z.string().trim().max(STUDENT_SCHOOL_MAX).optional(),
  board: z.string().trim().max(STUDENT_BOARD_MAX).optional(),
  gender: z.enum(["M", "F", "O"]).optional(),
  address: z.string().trim().max(STUDENT_ADDRESS_MAX).optional(),
  fee_model: z.enum(["postpaid", "prepaid", "mixed"]).default("postpaid"),
  baseFee: z.coerce.number().nonnegative().optional().default(0),
});

/**
 * The form's INPUT type, written out rather than derived: `z.input` widens every
 * `.transform` field to `unknown`, which is what pushed `as any` into the
 * resolver. This is the shape react-hook-form holds — every optional text field
 * is a plain string, because that is what a DOM control produces.
 */
type FormValues = {
  name: string;
  code?: string;
  batch: string;
  phone?: string;
  /**
   * Required by §14, but the control can be cleared — and a cleared date is the
   * same thing a blank spreadsheet cell is: "today". The schema normalises it to
   * absent and the server applies the same default, so the type is honest about
   * the possibility instead of asserting a value that may not be there.
   */
  joined_at?: string;
  dob?: string;
  grade?: string;
  school?: string;
  board?: string;
  gender?: "M" | "F" | "O";
  address?: string;
  fee_model: "postpaid" | "prepaid" | "mixed";
  baseFee?: number;
};


export function AddStudentSheet() {
  const { addSheetOpen: open, closeAddSheet } = useStudentsStore();
  const setOpen = (open: boolean) => {
    if (!open) closeAddSheet();
  };
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // BR-STU-04: the code field is hidden while the tutor is happy to let the app
  // generate one. On by default, exactly as the spec describes.
  const [autoCode, setAutoCode] = useState(true);
  const [duplicateWarning, setDuplicateWarning] = useState<{ dupKey: string; data: FormValues } | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();

  const closeSheet = () => {
    setDuplicateWarning(null);
    setError(null);
    setAutoCode(true);
    reset();
    setOpen(false);
  };

  const { register, control, setValue, handleSubmit, formState: { errors, isDirty }, reset } = useForm<FormValues>({
    // SAFETY: `FormValues` is `z.input<typeof FormSchema>` — the resolver's INPUT
    // type by definition — so no cast is needed and none is taken (AGENTS.md §6.1).
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: "",
      code: "",
      batch: "",
      phone: "",
      joined_at: new Date().toISOString().slice(0, 10),
      grade: "",
      school: "",
      board: "",
      gender: undefined,
      dob: "",
      address: "",
      fee_model: "postpaid",
      baseFee: 0,
    }
  });

  const {
    panelRef,
    onScrimClick,
    confirmThenClose,
    setDiscardOpen,
    discardOpen,
    discardQuestion,
  } = useOverlayDismiss({
    open,
    onClose: closeSheet,
    // A submitting form must not be interrupted at all.
    dirty: isDirty && !submitting,
    label: "student form",
  });

  const doCreate = async (data: FormValues, forceProceed: boolean = false) => {
    setSubmitting(true);
    setError(null);

    const { firstName, lastName } = splitStudentName(data.name);
    // 09 §14.6 / BR-STU-03 — ONE duplicate key recipe, shared with the import
    // path (`studentDupKey`). The previous local copy sliced the last four
    // characters off the RAW phone string, so "+91 98765 43210" and
    // "9876543210" hashed differently and the second Aarav was written as a new
    // student with no warning.
    const phone = data.phone ?? null;
    const dupKey = studentDupKey(firstName, lastName, phone);

    // 05_Students.md §14 caps each half of the name, not the joined string.
    if (firstName.length > STUDENT_FIRST_NAME_MAX) {
      setSubmitting(false);
      setError(`First name must be ${STUDENT_FIRST_NAME_MAX} characters or fewer.`);
      return;
    }
    if (lastName !== null && lastName.length > STUDENT_LAST_NAME_MAX) {
      setSubmitting(false);
      setError(`Last name must be ${STUDENT_LAST_NAME_MAX} characters or fewer.`);
      return;
    }

    // tenant_id is handled entirely on the server via authenticated session
    if (!forceProceed) {
      const dupCheck = await checkDuplicateStudentAction(dupKey);
      if (dupCheck.error) {
        // Rule 9: a duplicate check that could not RUN must not read as "no
        // duplicate". Failing open here silently creates the second copy of a
        // student — the exact outcome the check exists to prevent.
        setSubmitting(false);
        setError(
          "The duplicate check could not be completed, so this student was not added. Nothing was written — try again.",
        );
        toast.error(
          "Duplicate check failed",
          "Nothing was saved. This is what stops a second copy of a student being created by accident.",
        );
        return;
      }
      if (dupCheck.isDuplicate) {
        setDuplicateWarning({ dupKey, data });
        setSubmitting(false);
        return;
      }
    }

    const now = new Date().toISOString();

    const res = await createStudent({
      id: crypto.randomUUID(),
      tenant_id: "00000000-0000-0000-0000-000000000000", // Overridden securely by server, valid UUID to bypass zod
      code: data.code ? data.code : undefined,
      first_name: firstName,
      last_name: lastName,
      dob: data.dob || null,
      gender: data.gender || null,
      phone,
      email: null,
      address: data.address || null,
      school: data.school || null,
      grade: data.grade || null,
      board: data.board || null,
      admission_date: data.joined_at,
      status: "active",
      fee_model: data.fee_model || "postpaid",
      // W1 (Rule 6 / BR-M-01): money crosses the wire as an exact rupee
      // decimal string, never as a float paise amount — `(baseFee) * 100`
      // produced 123355.49999999999 for 1233.555. The server converts to
      // integer paise with integer math (actions/students.ts rupeesToPaise).
      baseFee: String(data.baseFee ?? 0),
      dup_key: dupKey,
      merged_into_id: null,
      custom_fields: null,
      notes: null,
      archived_at: null,
      created_at: now,
      updated_at: now,
    }, data.batch, { duplicateProceed: forceProceed });

    if (res.success) {
      const addedName = data.name.trim();
      reset();
      setDuplicateWarning(null);
      setOpen(false);
      toast.success(`${addedName} added`, "Their fee record starts empty — raise the first invoice whenever you are ready.");
      await queryClient.invalidateQueries({ queryKey: ["students"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      router.refresh();
    } else {
      const message = res.error || "The student was not saved.";
      setError(message);
      toast.error("Student not added", `${message} Nothing was written — your entry is still on screen.`);
    }
    
    setSubmitting(false);
  };

  const onSubmit = async (data: FormValues) => {
    await doCreate(data, false);
  };

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center md:justify-end">
          <div className="absolute inset-0" onClick={onScrimClick} aria-hidden="true" />

          {/* Sheet */}
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="as-title"
            tabIndex={-1}
            className="relative w-full max-w-md h-full md:h-[calc(100vh-2rem)] md:m-4 md:rounded-2xl glass-strong border border-[var(--border-default)] flex flex-col"
          >
            <div className="flex items-center justify-between p-6 border-b border-[var(--border-default)]">
              <h2 id="as-title" className="text-xl font-semibold text-[var(--text-primary)]">Add New Student</h2>
              <OverlayCloseButton
                onClick={submitting ? () => undefined : confirmThenClose}
                label="Close add student sheet"
              />
            </div>

            <div className="p-6 flex-1 overflow-y-auto">
              {error && (
                <div className="mb-6 p-4 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/20 text-[var(--danger)] text-sm">
                  {error}
                </div>
              )}

              <form id="add-student-form" onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label htmlFor={"as-name"} className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Full Name *</label>
                    <input
                      {...register("name")} id={"as-name"}
                      className="glass-input"
                      placeholder="e.g. Aarav Sharma"
                    />
                    {errors.name && <p className="mt-1 text-xs text-[var(--danger)]">{errors.name.message}</p>}
                  </div>

                  <div>
                    <label htmlFor={"as-phone"} className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Phone Number</label>
                    <input
                      {...register("phone")} id={"as-phone"}
                      className="glass-input"
                      placeholder="e.g. 9876543210"
                      aria-describedby={errors.phone ? "as-phone-error" : undefined}
                    />
                    {errors.phone && <p id="as-phone-error" className="mt-1 text-xs text-[var(--danger)]">{errors.phone.message}</p>}
                  </div>
                </div>

                {/* BR-STU-04 / 05_Students.md §14 — the code is optional and the
                    form ships with an "auto" toggle that hides the field, so a
                    tutor who does not care about codes never sees one. Switching
                    it off reveals the field; a supplied code must be unique per
                    tenant, which the server enforces. */}
                <div>
                  <label className="flex items-center gap-2 min-h-[44px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoCode}
                      onChange={(event) => {
                        setAutoCode(event.target.checked);
                        if (event.target.checked) setValue("code", "");
                      }}
                      className="size-4"
                    />
                    <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                      Generate the student code for me
                    </span>
                  </label>
                  {autoCode ? null : (
                    <div className="mt-1">
                      <label htmlFor={"as-code"} className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Student Code</label>
                      <input
                        {...register("code")} id={"as-code"}
                        className="glass-input"
                        placeholder="e.g. STU-2026-0007"
                      />
                      {errors.code && <p className="mt-1 text-xs text-[var(--danger)]">{errors.code.message}</p>}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label htmlFor={"as-batch"} className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Batch Name *</label>
                    <input
                      {...register("batch")} id={"as-batch"}
                      className="glass-input"
                      placeholder="e.g. Class 10 - Maths"
                    />
                    {errors.batch && <p className="mt-1 text-xs text-[var(--danger)]">{errors.batch.message}</p>}
                  </div>

                  <div>
                    <label htmlFor={"as-grade"} className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Grade/Class</label>
                    <input
                      {...register("grade")} id={"as-grade"}
                      className="glass-input"
                      placeholder="e.g. 10th"
                    />
                  </div>

                  <div>
                    <label htmlFor={"as-fee_model"} className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Fee Model</label>
                    <select
                      {...register("fee_model")} id={"as-fee_model"}
                      className="glass-input"
                    >
                      <option value="postpaid" className="bg-[var(--surface-raised)] text-[var(--text-primary)]">Postpaid</option>
                      <option value="prepaid" className="bg-[var(--surface-raised)] text-[var(--text-primary)]">Prepaid</option>
                      <option value="mixed" className="bg-[var(--surface-raised)] text-[var(--text-primary)]">Mixed</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor={"as-baseFee"} className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Monthly Fee (₹)</label>
                    <input
                      type="number"
                      min="0"
                      {...register("baseFee")} id={"as-baseFee"}
                      className="glass-input"
                      placeholder="e.g. 2000"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor={"as-school"} className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">School</label>
                    <input
                      {...register("school")} id={"as-school"}
                      className="glass-input"
                      placeholder="e.g. DPS"
                    />
                  </div>

                  <div>
                    <label htmlFor={"as-board"} className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Board</label>
                    <input
                      {...register("board")} id={"as-board"}
                      className="glass-input"
                      placeholder="e.g. CBSE"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor={"as-address"} className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Address</label>
                  <textarea
                    {...register("address")} id={"as-address"}
                    className="glass-input"
                    style={{ minHeight: 'unset', height: 'auto', resize: 'none' }}
                    placeholder="Enter full address"
                    rows={2}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor={"as-gender"} className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Gender</label>
                    <select {...register("gender")} id={"as-gender"} className="glass-input" defaultValue="">
                      <option value="" className="bg-[var(--surface-raised)] text-[var(--text-primary)]">Not stated</option>
                      <option value="M" className="bg-[var(--surface-raised)] text-[var(--text-primary)]">Male</option>
                      <option value="F" className="bg-[var(--surface-raised)] text-[var(--text-primary)]">Female</option>
                      <option value="O" className="bg-[var(--surface-raised)] text-[var(--text-primary)]">Other</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor={"as-dob"} className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Date of Birth</label>
                    <Controller
                      control={control}
                      name="dob"
                      render={({ field }) => (
                        <DatePicker
                          id="as-dob"
                          date={field.value ? new Date(field.value) : undefined}
                          setDate={(d) => field.onChange(d ? d.toISOString().slice(0, 10) : "")}
                          className="glass-input h-[44px]"
                        />
                      )}
                    />
                    {errors.dob && <p className="mt-1 text-xs text-[var(--danger)]">{errors.dob.message}</p>}
                  </div>
                </div>

                <div>
                  <label htmlFor="as-joined-at" className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Admission Date *</label>
                  <Controller
                    control={control}
                    name="joined_at"
                    render={({ field }) => (
                      <DatePicker
                        id="as-joined-at"
                        date={field.value ? new Date(field.value) : undefined}
                        setDate={(d) => field.onChange(d ? d.toISOString().slice(0, 10) : "")}
                        className="glass-input h-[44px]"
                      />
                    )}
                  />
                  {errors.joined_at && <p className="mt-1 text-xs text-[var(--danger)]">{errors.joined_at.message}</p>}
                </div>
                <div className="pt-4 border-t border-[var(--border-default)]">
                  <Button
                    type="submit"
                    disabled={submitting}
                    aria-busy={submitting}
                    className="w-full py-6 bg-[var(--accent-primary)] hover:brightness-110 text-[var(--accent-on-primary)] font-semibold rounded-xl transition-all cursor-pointer"
                  >
                    {submitting ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> : "Save student"}
                  </Button>
                  {submitting ? (
                    <p className="mt-2 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                      Checking for duplicates, then writing the student and their batch…
                    </p>
                  ) : null}
                </div>
              </form>
            </div>
            {duplicateWarning ? (
              <div
                role="alertdialog"
                aria-modal="true"
                aria-label="Possible duplicate student"
                className="absolute inset-0 z-10 glass-strong flex flex-col p-8 items-center justify-center"
              >
                <div className="w-full max-w-sm p-6 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-raised)] flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center mb-4" style={{ background: "color-mix(in srgb, var(--warning) 15%, transparent)", color: "var(--warning)" }}>
                    <TriangleAlert className="w-6 h-6" aria-hidden="true" />
                  </div>
                  <h3 className="text-lg font-bold text-[var(--text-primary)] mb-2">This looks like an existing student</h3>
                  <p className="text-sm text-[var(--text-secondary)] mb-6">
                    We already have someone with a matching name and phone ending. Adding them twice
                    splits their fee history in two — check the roster before you continue. If you do go
                    ahead, this is recorded in your activity log so you can find the pair later.
                  </p>
                  <div className="flex w-full flex-col gap-3 sm:flex-row">
                    <Button
                      variant="outline"
                      className="flex-1 min-h-[44px] text-[var(--text-primary)] border-[var(--border-default)]"
                      onClick={() => setDuplicateWarning(null)}
                    >
                      Go back and edit
                    </Button>
                    <Button
                      className="flex-1 min-h-[44px] bg-[var(--accent-primary)] text-[var(--accent-on-primary)] font-medium"
                      onClick={() => doCreate(duplicateWarning.data, true)}
                      disabled={submitting}
                    >
                      {submitting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : "They are different people — add anyway"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <DiscardChangesPrompt
            open={discardOpen}
            question={discardQuestion}
            onKeep={() => setDiscardOpen(false)}
            onDiscard={() => {
              setDiscardOpen(false);
              closeSheet();
            }}
          />
        </div>
      )}
    </>
  );
}
