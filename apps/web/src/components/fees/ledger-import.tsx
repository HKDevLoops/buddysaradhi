"use client";

// Implements: UI/web/06_Fees_and_Payments.md — Import tab (TutorOS)
// CSV preview UI. Parses client-side for preview ONLY.
//
// NOTHING HERE WRITES TO THE LEDGER, and the tab now says so on the control
// itself. The commit button used to be enabled and gradient-styled, and its only
// effect was rendering "Preview ready — connect a fees import action to commit" —
// the most prominent control on this tab admitting in its own aftermath that it
// does nothing. It is now disabled with the reason stated in text next to it
// (reachable by keyboard and screen reader). 09_Backup_and_Import_Export.md §8
// (BR-IMP-04) owns the real import; it does not exist yet.
//
// The amount column is checked with the product's own rupee→paise parser rather
// than `Number(cell)`. A float parse of a money column is the FM-02 smell (and
// accepts `1e3`, `0x1f`, ` 12 `, `Infinity`), and the preview's definition of
// "a valid amount" should be the same one the eventual action enforces:
// whole paise, greater than zero, at most two decimals (BR-M-01, 07 §14).

import { useRef, useState } from "react";
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { rupeesStringToPaise } from "./payment-contract";

interface ParsedRow {
  cells: string[];
  valid: boolean;
  reason?: string;
}

function parseCsv(text: string): { headers: string[]; rows: ParsedRow[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        out.push(cur); cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };

  const headers = splitLine(lines[0]);
  const rows: ParsedRow[] = lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const amountIdx = headers.findIndex((h) => /amount|paid|fee/i.test(h));
    // BR-M-01: the amount column is judged by the SAME paise parser the action
    // will use, not `Number()` — which floats, and accepts `1e3`/`Infinity`.
    const amountOk =
      amountIdx < 0 || (cells[amountIdx] !== undefined && rupeesStringToPaise(cells[amountIdx] ?? "") !== null);
    const shapeOk = cells.length === headers.length;
    const valid = shapeOk && amountOk;
    return {
      cells,
      valid,
      reason: valid
        ? undefined
        : !shapeOk
          ? "Column count does not match the header row"
          : "Amount is not a valid positive rupee figure",
    };
  });
  return { headers, rows };
}

export function LedgerImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const loadFile = (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const { headers, rows } = parseCsv(String(reader.result ?? ""));
      setHeaders(headers);
      setRows(rows);
    };
    reader.readAsText(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) loadFile(file);
  };

  const validCount = rows.filter((r) => r.valid).length;

  return (
    <div className="glass-panel rounded-xl p-6 flex flex-col min-h-[400px]">
      <h2 className="text-lg font-medium" style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
        Import Ledger
      </h2>
      <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
        Upload a CSV of fees &amp; payments. Expected columns: student, type, amount, date.
      </p>

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        aria-label="Upload CSV file"
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
        className={cn(
          "flex flex-col items-center justify-center gap-2 p-8 rounded-xl cursor-pointer transition-colors text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]",
          dragging ? "bg-[var(--surface-raised)]" : "bg-[var(--surface-inset)]"
        )}
        style={{ border: `1px dashed ${dragging ? "var(--info)" : "var(--border-default)"}` }}
      >
        <Upload className="w-7 h-7" style={{ color: "var(--info)" }} />
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {fileName ? fileName : "Drop a CSV here or click to browse"}
        </p>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>Only .csv files · parsed locally, never uploaded</p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }}
        />
      </div>

      {rows.length > 0 && (
        <div className="mt-4 flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-3 mb-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            <span className="chip chip-success"><CheckCircle2 className="w-3 h-3" />{validCount} valid</span>
            {validCount !== rows.length && (
              <span className="chip chip-danger"><AlertTriangle className="w-3 h-3" />{rows.length - validCount} invalid</span>
            )}
          </div>
          <div className="flex-1 overflow-auto no-scrollbar rounded-xl" style={{ border: "1px solid var(--border-default)" }}>
            {rows.length > 50 && (
              <p className="px-4 pt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                Showing first 50 of {rows.length} rows
              </p>
            )}
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 [backdrop-filter:var(--mat-filter)]" style={{ background: "var(--surface-overlay)" }}>
                <tr style={{ color: "var(--text-muted)" }}>
                  {headers.map((h, i) => (
                    <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody style={{ color: "var(--text-primary)" }}>
                {rows.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: "var(--border-default)" }}>
                    {headers.map((_, c) => (
                      <td key={c} className="px-4 py-2.5 whitespace-nowrap">{r.cells[c] ?? "—"}</td>
                    ))}
                    <td className="px-4 py-2.5">
                      {r.valid ? (
                        <span className="chip chip-success"><CheckCircle2 className="w-3 h-3" />OK</span>
                      ) : (
                        <span className="chip chip-danger"><AlertTriangle className="w-3 h-3" />{r.reason}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              disabled
              aria-describedby="ledger-import-unavailable"
              className="btn-glass neumo-raised min-h-[44px] px-5 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: "var(--surface-raised)", border: "1px solid var(--border-default)", color: "var(--text-muted)" }}
            >
              <FileSpreadsheet className="w-4 h-4" /> Import {validCount} rows
            </button>
            {/* There is no fees-import action, so the button used to flip a notice
                that said so — "Preview ready — connect a fees import action to
                commit" — which is an enabled, gradient, most-prominent control on
                a money screen whose only outcome is a message admitting it does
                nothing. A disabled control that states the reason in text is the
                honest version: it cannot be mistaken for something that will
                write to the ledger, and the reason is reachable by keyboard and by
                screen reader (a `title` alone is neither). 09_Backup_and_
                Import_Export.md §8 (BR-IMP-04) owns the real import; it does not
                exist yet. */}
            <p id="ledger-import-unavailable" className="text-xs max-w-[28rem]" style={{ color: "var(--text-muted)" }}>
              Importing into the ledger is not available in this build. Nothing on this tab can write to
              a student&apos;s books — the table above is a read-only preview of the file you picked.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
