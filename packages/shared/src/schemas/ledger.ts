import { z } from "zod";

export const LedgerEntrySchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  student_id: z.string().uuid(),
  batch_id: z.string().uuid().optional().nullable(),
  invoice_id: z.string().uuid().optional().nullable(),
  type: z.enum([
    "FEE_CHARGED",
    "PAYMENT_RECEIVED",
    "DISCOUNT_GRANTED",
    "REFUND_ISSUED",
    "ADJUSTMENT",
    "WRITEOFF",
    "VOID",
  ]),
  debit_paise: z.number().int().nonnegative(),
  credit_paise: z.number().int().nonnegative(),
  balance_after_paise: z.number().int(),
  description: z.string().optional().nullable(),
  receipt_no: z.string().optional().nullable(),
  payment_method: z.string().optional().nullable(),
  payment_ref: z.string().optional().nullable(),
  prev_hash: z.string().optional().nullable(),
  this_hash: z.string(),
  void_of_id: z.string().uuid().optional().nullable(),
  locked_at: z.string().datetime().optional().nullable(),
  occurred_on: z.string(),
  source: z.string().default("manual"),
  device_id: z.string().optional().nullable(),
  created_by: z.string().optional().nullable(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});

export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
