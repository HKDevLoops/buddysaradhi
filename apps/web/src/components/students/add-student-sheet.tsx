"use client";

import React, { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createStudent, checkDuplicateStudentAction } from "@/server/actions/students";
import { useRouter } from "next/navigation";
import { X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { z } from "zod";
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

  const { register, control, handleSubmit, formState: { errors }, reset } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
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
      baseFeePaise: (data.baseFee || 0) * 100,
      dup_key: dupKey,
      merged_into_id: null,
      custom_fields: null,
      notes: null,
      archived_at: null,
      created_at: now,
      updated_at: now,
    }, data.batch);

    if (res.success) {
      reset();
      setOpen(false);
      setDuplicateWarning(null);
      router.refresh();
    } else {
      setError(res.error || "Failed to create student");
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
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
            onClick={() => !submitting && setOpen(false)}
          />

          {/* Sheet */}
          <div className="relative w-full max-w-md h-full md:h-[calc(100vh-2rem)] md:m-4 md:rounded-2xl glass-strong border border-[var(--border-default)] shadow-2xl flex flex-col animate-in slide-in-from-right-full md:slide-in-from-right-8 duration-300">
            <div className="flex items-center justify-between p-6 border-b border-[var(--border-default)]">
              <h2 className="text-xl font-semibold text-[var(--text-primary)]">Add New Student</h2>
              <button 
                onClick={() => !submitting && setOpen(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 flex-1 overflow-y-auto">
              {error && (
                <div className="mb-6 p-4 rounded-lg bg-[var(--accent-flare)]/10 border border-[var(--accent-flare)]/20 text-[var(--accent-flare)] text-sm">
                  {error}
                </div>
              )}

              <form id="add-student-form" onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Full Name *</label>
                    <input
                      {...register("name")}
                      className="glass-input"
                      placeholder="e.g. Aarav Sharma"
                    />
                    {errors.name && <p className="mt-1 text-xs text-[var(--accent-flare)]">{errors.name.message}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Phone Number</label>
                    <input
                      {...register("phone")}
                      className="glass-input"
                      placeholder="e.g. 9876543210"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Batch Name *</label>
                    <input
                      {...register("batch")}
                      className="glass-input"
                      placeholder="e.g. Class 10 - Maths"
                    />
                    {errors.batch && <p className="mt-1 text-xs text-[var(--accent-flare)]">{errors.batch.message}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Grade/Class</label>
                    <input
                      {...register("grade")}
                      className="glass-input"
                      placeholder="e.g. 10th"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Fee Model</label>
                    <select
                      {...register("fee_model")}
                      className="glass-input"
                    >
                      <option value="postpaid" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Postpaid</option>
                      <option value="prepaid" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Prepaid</option>
                      <option value="mixed" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Mixed</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Monthly Fee (₹)</label>
                    <input
                      type="number"
                      min="0"
                      {...register("baseFee")}
                      className="glass-input"
                      placeholder="e.g. 2000"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">School</label>
                    <input
                      {...register("school")}
                      className="glass-input"
                      placeholder="e.g. DPS"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Board</label>
                    <input
                      {...register("board")}
                      className="glass-input"
                      placeholder="e.g. CBSE"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Address</label>
                  <textarea
                    {...register("address")}
                    className="glass-input"
                    style={{ minHeight: 'unset', height: 'auto', resize: 'none' }}
                    placeholder="Enter full address"
                    rows={2}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Admission Date *</label>
                  <Controller
                    control={control}
                    name="joined_at"
                    render={({ field }) => (
                      <DatePicker
                        date={field.value ? new Date(field.value) : undefined}
                        setDate={(d) => field.onChange(d?.toISOString() || "")}
                        className="glass-input h-[44px]"
                      />
                    )}
                  />
                  {errors.joined_at && <p className="mt-1 text-xs text-[var(--accent-flare)]">{errors.joined_at.message}</p>}
                </div>
              </form>
            </div>

            <div className="p-6 border-t border-[var(--border-default)] bg-[var(--bg-surface-raised)]/50 mt-auto">
              <Button
                form="add-student-form"
                type="submit"
                disabled={submitting}
                className="w-full py-6 bg-[var(--accent-emerald)] hover:bg-[var(--accent-emerald)]/90 text-[var(--text-on-accent)] font-semibold rounded-xl transition-all"
              >
                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : "Save Student"}
              </Button>
            </div>
            {duplicateWarning ? (
              <div className="absolute inset-0 z-10 glass-strong flex flex-col p-8 items-center justify-center animate-in fade-in duration-200">
                <div className="w-full max-w-sm glass-panel p-6 rounded-xl border-l-4 border-l-[var(--accent-flare)] shadow-2xl flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-[var(--accent-flare)]/20 text-[var(--accent-flare)] flex items-center justify-center mb-4">
                    <X className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold text-[var(--text-primary)] mb-2">Duplicate Detected</h3>
                  <p className="text-sm text-[var(--text-secondary)] mb-6">
                    A student with similar details already exists. What would you like to do?
                  </p>
                  <div className="flex w-full gap-3">
                    <Button 
                      variant="ghost" 
                      className="flex-1 text-[var(--text-primary)] hover:bg-[var(--surface-glass-strong)] border border-[var(--border-default)]"
                      onClick={() => setDuplicateWarning(null)}
                    >
                      Cancel
                    </Button>
                    <Button 
                      className="flex-1 bg-[var(--accent-cyan)] text-[var(--text-on-accent)] hover:bg-[var(--accent-cyan)]/90 font-medium"
                      onClick={() => doCreate(duplicateWarning.data, true)}
                      disabled={submitting}
                    >
                      {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Proceed Anyway"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
