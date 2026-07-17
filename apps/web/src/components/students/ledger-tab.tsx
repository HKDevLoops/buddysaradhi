import { getStudentLedger } from "@/server/queries/ledger";
import { formatINR } from "@buddysaradhi/shared";
import { format } from "date-fns";
import { RecordPaymentButton } from "./record-payment-button";

export async function LedgerTab({ studentId }: { studentId: string }) {
  //  for sandbox
    const { data: entries, error } = await getStudentLedger(studentId);

  if (error) {
    return <div className="text-red-400 p-4">Error loading ledger: {error}</div>;
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center h-[300px] border border-[var(--border-glass)] rounded-xl bg-[var(--bg-surface-inset)] backdrop-blur-md">
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">No Transactions Yet</h3>
        <p className="text-sm text-gray-400 mb-6 max-w-xs">
          Student&apos;s Ledger is currently empty. Record a payment or fee to get started.
        </p>
        <RecordPaymentButton studentId={studentId} studentName="Student" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium text-[var(--text-primary)]">Ledger History</h3>
        <RecordPaymentButton studentId={studentId} studentName="Student" />
      </div>

      <div className="border border-[var(--border-default)] rounded-xl overflow-hidden bg-black/20 backdrop-blur-md">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-gray-400 uppercase bg-[var(--bg-surface-inset)] border-b border-[var(--border-default)]">
            <tr>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3 font-medium">Method</th>
              <th className="px-4 py-3 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {entries.map((entry: any) => (
              <tr key={entry.id} className="hover:bg-[var(--surface-glass)] transition-colors">
                <td className="px-4 py-4 whitespace-nowrap text-gray-300">
                  {format(new Date(entry.created_at || "1970-01-01"), "MMM d, yyyy")}
                </td>
                <td className="px-4 py-4 text-gray-200">
                  <div className="font-medium">{entry.type.replace("_", " ")}</div>
                  {entry.description && (
                    <div className="text-xs text-gray-500 mt-1">{entry.description}</div>
                  )}
                </td>
                <td className="px-4 py-4 text-gray-400">
                  {"-"}
                </td>
                <td className={`px-4 py-4 text-right font-medium whitespace-nowrap ${
                  entry.type === "PAYMENT_RECEIVED" ? "text-emerald-400" : "text-[var(--text-primary)]"
                }`}>
                  {entry.type === "PAYMENT_RECEIVED" ? "+" : ""}{formatINR(entry.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
