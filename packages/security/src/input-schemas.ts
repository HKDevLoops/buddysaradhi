// Implements: 10_Security.md §11 Input Validation & Injection Defence
//
// Common Zod schemas for forms that accept tutor-controlled text. The schema
// is the single source of truth; UI registry mirrors enumerate over these.

import { z } from "zod";

export const StudentName = z.string().min(1).max(120).trim();
export const PhoneNumber = z.string().regex(/^\+?[0-9 ()-]{6,20}$/u, "Phone must be 6-20 digits, optional leading +");
export const PaiseMinor = z.number().int().nonnegative();
export const PositivePaiseMinor = z.number().int().positive();
export const NoteText = z.string().max(2000);
export const InvoiceDescription = z.string().max(280);
export const DateIso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), { message: "Invalid date" });

export const PinInput = z.string().regex(/^\d{6}$/u, "PIN must be 6 digits");
export const PanicPinInput = z.string().regex(/^\d{6}$/u, "Panic PIN must be 6 digits");

export const TypedConfirm = z.string().refine(
  (s) => /^[A-Z0-9]+$/u.test(s) && s.length >= 4 && s.length <= 32,
  "Typed confirmation must be 4-32 uppercase letters/digits"
);
