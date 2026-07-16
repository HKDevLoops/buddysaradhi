import { z } from "zod";

export const StudentSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  code: z.string().nullable(),
  first_name: z.string().min(1),
  last_name: z.string().nullable(),
  dob: z.string().nullable(),
  gender: z.enum(['M', 'F', 'O']).nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  school: z.string().nullable(),
  grade: z.string().nullable(),
  board: z.string().nullable(),
  admission_date: z.string(),
  status: z.enum(['active', 'inactive', 'graduated', 'archived']).default('active'),
  fee_model: z.enum(['postpaid', 'prepaid', 'mixed']).default('postpaid'),
  baseFeePaise: z.number().int().nonnegative().optional().default(0),
  dup_key: z.string(),
  merged_into_id: z.string().uuid().nullable(),
  custom_fields: z.string().nullable(),
  notes: z.string().nullable(),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Student = z.infer<typeof StudentSchema>;

export const StudentListRowSchema = z.object({
  id: z.string().uuid(),
  code: z.string().nullable(),
  name: z.string(), // concatenated first_name last_name
  grade: z.string().nullable(),
  batch: z.string().nullable(),
  fee_model: z.enum(['postpaid', 'prepaid', 'mixed']),
  balance_due: z.number().int(), // formatted from paise
  status: z.enum(['active', 'inactive', 'graduated', 'archived']),
});

export type StudentListRow = z.infer<typeof StudentListRowSchema>;
