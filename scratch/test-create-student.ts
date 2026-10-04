import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface CreateStudentInput {
  name: string;
  phone: string;
  batch: string;
  joined_at: string;
  fee_model: string;
  baseFee: number;
}

interface StudentsActions {
  createStudent: (input: CreateStudentInput, batchName: string) => Promise<unknown>;
}

const { createStudent } = require("./apps/web/src/server/actions/students.ts") as StudentsActions;

async function main(): Promise<void> {
  console.log("Testing createStudent action...");
  const res: unknown = await createStudent(
    {
      name: "Test Student",
      phone: "9988776655",
      batch: "Mathematics",
      joined_at: new Date().toISOString(),
      fee_model: "postpaid",
      baseFee: 1500,
    },
    "Mathematics",
  );
  console.log("createStudent result:", JSON.stringify(res, null, 2));
}

main().catch(console.error);
