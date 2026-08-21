"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateAttendancePayloadSchema = exports.StudentAttendanceRowSchema = exports.AttendanceRecordSchema = exports.AttendanceSessionSchema = exports.AttendanceStatusSchema = void 0;
const zod_1 = require("zod");
// 'excused' is the persisted value for the TutorOS "Leave" status (prototype).
// The DB CHECK already permits 'excused'; this only widens the client/server union.
exports.AttendanceStatusSchema = zod_1.z.enum(['present', 'absent', 'late', 'excused']);
exports.AttendanceSessionSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    tenant_id: zod_1.z.string().uuid(),
    session_date: zod_1.z.string(), // YYYY-MM-DD
    batch_id: zod_1.z.string().uuid().nullable(),
    locked_at: zod_1.z.string().nullable(),
    created_at: zod_1.z.string(),
    updated_at: zod_1.z.string(),
});
exports.AttendanceRecordSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    tenant_id: zod_1.z.string().uuid(),
    session_id: zod_1.z.string().uuid(),
    student_id: zod_1.z.string().uuid(),
    status: exports.AttendanceStatusSchema,
    notes: zod_1.z.string().nullable(),
    created_at: zod_1.z.string(),
    updated_at: zod_1.z.string(),
});
exports.StudentAttendanceRowSchema = zod_1.z.object({
    student_id: zod_1.z.string().uuid(),
    name: zod_1.z.string(),
    batch: zod_1.z.string().nullable(),
    status: exports.AttendanceStatusSchema.nullable(),
});
exports.UpdateAttendancePayloadSchema = zod_1.z.object({
    session_date: zod_1.z.string(), // YYYY-MM-DD
    batch_id: zod_1.z.string().uuid().nullable(),
    updates: zod_1.z.array(zod_1.z.object({
        student_id: zod_1.z.string().uuid(),
        status: exports.AttendanceStatusSchema,
    })),
});
