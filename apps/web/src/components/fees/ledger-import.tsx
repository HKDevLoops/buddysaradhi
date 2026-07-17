"use client";

// Implements: UI/web/06_Fees_and_Payments.md — Import tab (TutorOS)
// CSV import UI. Parses client-side for preview; final import action is out of
// scope for this UI pass (no server action added) — surfaced transparently.

import { useRef, useState } from "react";
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

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
    const valid = cells.length === headers.length && (amountIdx < 0 || !isNaN(Number(cells[amountIdx])));
    return { cells, valid, reason: valid ? undefined : "Missing field or invalid amount" };
  });
  return { headers, rows };
}

export function LedgerImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [imported, setImported] = useState(false);

  const loadFile = (file: File) => {
    setFileName(file.name);
    setImported(false);
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
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
        className={cn(
          "flex flex-col items-center justify-center gap-2 p-8 rounded-xl cursor-pointer transition-colors text-center",
          dragging ? "bg-[var(--surface-glass)]" : "bg-[var(--surface-glass-faint)]"
        )}
        style={{ border: `1px dashed ${dragging ? "var(--accent-cyan)" : "var(--border-glass)"}` }}
      >
        <Upload className="w-7 h-7" style={{ color: "var(--accent-cyan)" }} />
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
          <div className="flex-1 overflow-auto no-scrollbar rounded-xl" style={{ border: "1px solid var(--border-glass)" }}>
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 backdrop-blur-md" style={{ background: "var(--surface-glass-strong)" }}>
                <tr style={{ color: "var(--text-muted)" }}>
                  {headers.map((h, i) => (
                    <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody style={{ color: "var(--text-primary)" }}>
                {rows.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: "var(--border-glass)" }}>
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
              onClick={() => setImported(true)}
              disabled={validCount === 0}
              className="btn-glass neumo-raised px-5 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-all disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan))", color: "var(--text-on-accent)", border: "none" }}
            >
              <FileSpreadsheet className="w-4 h-4" /> Import {validCount} rows
            </button>
            {imported && (
              <span className="flex items-center gap-2 text-sm" style={{ color: "var(--accent-info)" }}>
                <Info className="w-4 h-4" /> Preview ready — connect a fees import action to commit.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
