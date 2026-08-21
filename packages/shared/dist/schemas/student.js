"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StudentListRowSchema = exports.StudentSchema = void 0;
const zod_1 = require("zod");
exports.StudentSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    tenant_id: zod_1.z.string().uuid(),
    code: zod_1.z.string().nullable(),
    first_name: zod_1.z.string().min(1),
    last_name: zod_1.z.string().nullable(),
    dob: zod_1.z.string().nullable(),
    gender: zod_1.z.enum(['M', 'F', 'O']).nullable(),
    phone: zod_1.z.string().nullable(),
    email: zod_1.z.string().nullable(),
    address: zod_1.z.string().nullable(),
    school: zod_1.z.string().nullable(),
    grade: zod_1.z.string().nullable(),
    board: zod_1.z.string().nullable(),
    admission_date: zod_1.z.string(),
    status: zod_1.z.enum(['active', 'inactive', 'graduated', 'archived']).default('active'),
    fee_model: zod_1.z.enum(['postpaid', 'prepaid', 'mixed']).default('postpaid'),
    baseFeePaise: zod_1.z.number().int().nonnegative().optional().default(0),
    dup_key: zod_1.z.string(),
    merged_into_id: zod_1.z.string().uuid().nullable(),
    custom_fields: zod_1.z.string().nullable(),
    notes: zod_1.z.string().nullable(),
    archived_at: zod_1.z.string().nullable(),
    created_at: zod_1.z.string(),
    updated_at: zod_1.z.string(),
});
exports.StudentListRowSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    code: zod_1.z.string().nullable(),
    name: zod_1.z.string(), // concatenated first_name last_name
    grade: zod_1.z.string().nullable(),
    batch: zod_1.z.string().nullable(),
    fee_model: zod_1.z.enum(['postpaid', 'prepaid', 'mixed']),
    balance_due: zod_1.z.number().int(), // formatted from paise
    status: zod_1.z.enum(['active', 'inactive', 'graduated', 'archived']),
});
