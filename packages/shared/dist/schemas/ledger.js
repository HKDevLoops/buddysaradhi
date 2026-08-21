"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LedgerEntrySchema = void 0;
const zod_1 = require("zod");
exports.LedgerEntrySchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    tenant_id: zod_1.z.string().uuid(),
    student_id: zod_1.z.string().uuid(),
    batch_id: zod_1.z.string().uuid().optional().nullable(),
    invoice_id: zod_1.z.string().uuid().optional().nullable(),
    type: zod_1.z.enum([
        "FEE_CHARGED",
        "PAYMENT_RECEIVED",
        "DISCOUNT_GRANTED",
        "REFUND_ISSUED",
        "ADJUSTMENT",
        "WRITEOFF",
        "VOID",
    ]),
    debit_paise: zod_1.z.number().int().nonnegative(),
    credit_paise: zod_1.z.number().int().nonnegative(),
    balance_after_paise: zod_1.z.number().int(),
    description: zod_1.z.string().optional().nullable(),
    receipt_no: zod_1.z.string().optional().nullable(),
    payment_method: zod_1.z.string().optional().nullable(),
    payment_ref: zod_1.z.string().optional().nullable(),
    prev_hash: zod_1.z.string().optional().nullable(),
    this_hash: zod_1.z.string(),
    void_of_id: zod_1.z.string().uuid().optional().nullable(),
    locked_at: zod_1.z.string().datetime().optional().nullable(),
    occurred_on: zod_1.z.string(),
    source: zod_1.z.string().default("manual"),
    device_id: zod_1.z.string().optional().nullable(),
    created_by: zod_1.z.string().optional().nullable(),
    created_at: zod_1.z.string().datetime().optional(),
    updated_at: zod_1.z.string().datetime().optional(),
});
