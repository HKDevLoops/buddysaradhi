"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const student_1 = require("./schemas/student");
(0, vitest_1.describe)("Shared Schemas", () => {
    (0, vitest_1.it)("should enforce integer paise for balance_due", () => {
        const valid = student_1.StudentListRowSchema.safeParse({
            id: "123e4567-e89b-12d3-a456-426614174000",
            code: "STU-01",
            name: "John Doe",
            grade: "10th",
            batch: "Morning",
            fee_model: "postpaid",
            balance_due: 150000,
            status: "active",
        });
        (0, vitest_1.expect)(valid.success).toBe(true);
        const invalid = student_1.StudentListRowSchema.safeParse({
            id: "123e4567-e89b-12d3-a456-426614174000",
            code: "STU-01",
            name: "John Doe",
            grade: "10th",
            batch: "Morning",
            fee_model: "postpaid",
            balance_due: 150000.5, // float!
            status: "active",
        });
        (0, vitest_1.expect)(invalid.success).toBe(false);
    });
});
