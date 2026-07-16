import { z } from "zod";

// 'excused' is the persisted value for the TutorOS "Leave" status (prototype).
// The DB CHECK already permits 'excused'; this only widens the client/server union.
export const AttendanceStatusSchema = z.enum(['present', 'absent', 'late', 'excused']);
export type AttendanceStatus = z.infer<typeof AttendanceStatusSchema>;

export const AttendanceSessionSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  session_date: z.string(), // YYYY-MM-DD
  batch_id: z.string().uuid().nullable(),
  locked_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type AttendanceSession = z.infer<typeof AttendanceSessionSchema>;

export const AttendanceRecordSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  session_id: z.string().uuid(),
  student_id: z.string().uuid(),
  status: AttendanceStatusSchema,
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type AttendanceRecord = z.infer<typeof AttendanceRecordSchema>;

export const StudentAttendanceRowSchema = z.object({
  student_id: z.string().uuid(),
  name: z.string(),
  batch: z.string().nullable(),
  status: AttendanceStatusSchema.nullable(),
});
export type StudentAttendanceRow = z.infer<typeof StudentAttendanceRowSchema>;

export const UpdateAttendancePayloadSchema = z.object({
  session_date: z.string(), // YYYY-MM-DD
  batch_id: z.string().uuid().nullable(),
  updates: z.array(z.object({
    student_id: z.string().uuid(),
    status: AttendanceStatusSchema,
  })),
});
export type UpdateAttendancePayload = z.infer<typeof UpdateAttendancePayloadSchema>;
