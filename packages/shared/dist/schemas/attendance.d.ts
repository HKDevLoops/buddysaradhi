import { z } from "zod";
export declare const AttendanceStatusSchema: z.ZodEnum<["present", "absent", "late", "excused"]>;
export type AttendanceStatus = z.infer<typeof AttendanceStatusSchema>;
export declare const AttendanceSessionSchema: z.ZodObject<{
    id: z.ZodString;
    tenant_id: z.ZodString;
    session_date: z.ZodString;
    batch_id: z.ZodNullable<z.ZodString>;
    locked_at: z.ZodNullable<z.ZodString>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    tenant_id: string;
    session_date: string;
    batch_id: string | null;
    locked_at: string | null;
    created_at: string;
    updated_at: string;
}, {
    id: string;
    tenant_id: string;
    session_date: string;
    batch_id: string | null;
    locked_at: string | null;
    created_at: string;
    updated_at: string;
}>;
export type AttendanceSession = z.infer<typeof AttendanceSessionSchema>;
export declare const AttendanceRecordSchema: z.ZodObject<{
    id: z.ZodString;
    tenant_id: z.ZodString;
    session_id: z.ZodString;
    student_id: z.ZodString;
    status: z.ZodEnum<["present", "absent", "late", "excused"]>;
    notes: z.ZodNullable<z.ZodString>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    tenant_id: string;
    session_id: string;
    student_id: string;
    status: "absent" | "excused" | "late" | "present";
    notes: string | null;
    created_at: string;
    updated_at: string;
}, {
    id: string;
    tenant_id: string;
    session_id: string;
    student_id: string;
    status: "absent" | "excused" | "late" | "present";
    notes: string | null;
    created_at: string;
    updated_at: string;
}>;
export type AttendanceRecord = z.infer<typeof AttendanceRecordSchema>;
export declare const StudentAttendanceRowSchema: z.ZodObject<{
    student_id: z.ZodString;
    name: z.ZodString;
    batch: z.ZodNullable<z.ZodString>;
    status: z.ZodNullable<z.ZodEnum<["present", "absent", "late", "excused"]>>;
}, "strip", z.ZodTypeAny, {
    student_id: string;
    name: string;
    batch: string | null;
    status: "absent" | "excused" | "late" | "present" | null;
}, {
    student_id: string;
    name: string;
    batch: string | null;
    status: "absent" | "excused" | "late" | "present" | null;
}>;
export type StudentAttendanceRow = z.infer<typeof StudentAttendanceRowSchema>;
export declare const UpdateAttendancePayloadSchema: z.ZodObject<{
    session_date: z.ZodString;
    batch_id: z.ZodNullable<z.ZodString>;
    updates: z.ZodArray<z.ZodObject<{
        student_id: z.ZodString;
        status: z.ZodEnum<["present", "absent", "late", "excused"]>;
    }, "strip", z.ZodTypeAny, {
        student_id: string;
        status: "absent" | "excused" | "late" | "present";
    }, {
        student_id: string;
        status: "absent" | "excused" | "late" | "present";
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    session_date: string;
    batch_id: string | null;
    updates: {
        student_id: string;
        status: "absent" | "excused" | "late" | "present";
    }[];
}, {
    session_date: string;
    batch_id: string | null;
    updates: {
        student_id: string;
        status: "absent" | "excused" | "late" | "present";
    }[];
}>;
export type UpdateAttendancePayload = z.infer<typeof UpdateAttendancePayloadSchema>;
