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

const FormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  batch: z.string().min(1, "Batch is required"),
  phone: z.string().optional(),
  joined_at: z.string().min(1, "Admission Date is required"),
  grade: z.string().optional(),
  school: z.string().optional(),
  board: z.string().optional(),
  gender: z.enum(["M", "F", "O"]).optional(),
  dob: z.string().optional(),
  address: z.string().optional(),
  fee_model: z.enum(["postpaid", "prepaid", "mixed"]).default("postpaid"),
  baseFee: z.coerce.number().nonnegative().optional().default(0),
});

type FormValues = z.infer<typeof FormSchema>;

export function AddStudentSheet() {
  const { addSheetOpen: open, closeAddSheet } = useStudentsStore();
  const setOpen = (open: boolean) => {
    if (!open) closeAddSheet();
  };
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{ dupKey: string; data: FormValues } | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();

  const closeSheet = () => {
    setDuplicateWarning(null);
    setError(null);
    reset();
    setOpen(false);
  };

  const { register, control, handleSubmit, formState: { errors, isDirty }, reset } = useForm<FormValues>({
    resolver: zodResolver(FormSchema as any),
    defaultValues: {
      name: "",
      batch: "",
      phone: "",
      joined_at: new Date().toISOString(),
      grade: "",
      school: "",
      board: "",
      gender: undefined,
      dob: "",
      address: "",
      fee_model: "postpaid",
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
    
    const parts = data.name.trim().split(" ");
    const firstName = parts[0];
    const lastName = parts.length > 1 ? parts.slice(1).join(" ") : undefined;
    const phoneLast4 = data.phone ? data.phone.slice(-4) : "";
    const dupKey = (firstName + (lastName || "") + phoneLast4).toLowerCase().replace(/[^a-z0-9]/g, '');

    // tenant_id is handled entirely on the server via authenticated session
    if (!forceProceed) {
      const dupCheck = await checkDuplicateStudentAction(dupKey);
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
      first_name: firstName,
      last_name: lastName || null,
      dob: data.dob || null,
      gender: data.gender || null,
      phone: data.phone || null,
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
    }, data.batch);

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
            aria-label="Add new student"
            tabIndex={-1}
            className="relative w-full max-w-md h-full md:h-[calc(100vh-2rem)] md:m-4 md:rounded-2xl glass-strong border border-[var(--border-default)] flex flex-col"
          >
            <div className="flex items-center justify-between p-6 border-b border-[var(--border-default)]">
              <h2 className="text-xl font-semibold text-[var(--text-primary)]">Add New Student</h2>
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
                    />
                  </div>
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

                <div>
                  <label htmlFor="as-joined-at" className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Admission Date *</label>
                  <Controller
                    control={control}
                    name="joined_at"
                    render={({ field }) => (
                      <DatePicker
                        id="as-joined-at"
                        date={field.value ? new Date(field.value) : undefined}
                        setDate={(d) => field.onChange(d?.toISOString() || "")}
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
                    splits their fee history in two — check the roster before you continue.
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
