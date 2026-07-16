import { PrismaClient } from "@prisma/client";
import { Worker } from "worker_threads";
import * as path from "path";

export interface ReportConfig {
  tenantId: string;
  type: "attendance" | "fees";
  startDate?: string;
  endDate?: string;
}

// Function to run data processing in a worker thread
function runCsvWorker(
  data: any[],
  type: "attendance" | "fees",
): Promise<string> {
  return new Promise((resolve, reject) => {
    // We use a small inline worker to avoid compilation/path issues in various environments
    const workerCode = `
      const { parentPort, workerData } = require('worker_threads');
      const { data, type } = workerData;
      
      let csv = "";
      if (type === "attendance") {
        csv = "Date,Student,Status\\n";
        for (const r of data) {
          const studentName = \`\${r.student.firstName} \${r.student.lastName || ""}\`.trim();
          csv += \`\${r.session.sessionDate},"\${studentName}",\${r.status}\\n\`;
        }
      } else if (type === "fees") {
        csv = "Date,Student,Type,Amount\\n";
        for (const r of data) {
          const studentName = \`\${r.student.firstName} \${r.student.lastName || ""}\`.trim();
          const amountPaise = r.debitPaise > 0 ? r.debitPaise : r.creditPaise;
          const amountINR = (amountPaise / 100).toFixed(2);
          csv += \`\${r.createdAt},"\${studentName}",\${r.type},\${amountINR}\\n\`;
        }
      }
      
      parentPort.postMessage(csv);
    `;

    const worker = new Worker(workerCode, {
      eval: true,
      workerData: { data, type },
    });

    worker.on("message", resolve);
    worker.on("error", reject);
    worker.on("exit", (code: number) => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
}

export async function generateReport(
  db: PrismaClient,
  config: ReportConfig,
): Promise<string> {
  const { tenantId, type, startDate, endDate } = config;

  if (type === "attendance") {
    const records = await db.attendanceRecord.findMany({
      where: {
        tenantId,
        session: {
          sessionDate: {
            ...(startDate ? { gte: startDate } : {}),
            ...(endDate ? { lte: endDate } : {}),
          },
        },
      },
      include: {
        student: true,
        session: true,
      },
    });

    // Process large data in a worker thread
    return await runCsvWorker(records, type);
  }

  if (type === "fees") {
    const entries = await db.ledgerEntry.findMany({
      where: {
        tenantId,
        createdAt: {
          ...(startDate ? { gte: new Date(startDate) } : {}),
          ...(endDate ? { lte: new Date(endDate) } : {}),
        },
      },
      include: {
        student: true,
      },
    });

    // Serialize Dates for worker passing
    const serializedEntries = entries.map((e) => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
    }));

    // Process large data in a worker thread
    return await runCsvWorker(serializedEntries, type);
  }

  return "";
}
