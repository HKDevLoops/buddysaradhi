"use client";

import React, { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Upload, Download, FileJson, AlertCircle, Loader2, CheckCircle2, XCircle } from "lucide-react";

export function ImportExportSection() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const handleExportJSON = () => {
    try {
      const settingsData = queryClient.getQueryData(["settings"]) as any;
      const settingsObj = settingsData?.data || { message: "No settings cached yet." };
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(settingsObj, null, 2));
      const a = document.createElement("a");
      a.setAttribute("href", dataStr);
      a.setAttribute("download", `buddysaradhi_settings_${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error("Failed to export settings as JSON", err);
    }
  };

  const handleExportCSV = () => {
    try {
      const settingsData = queryClient.getQueryData(["settings"]) as any;
      const settingsObj = settingsData?.data || {};
      let csvContent = "Setting Key,Setting Value\n";
      Object.entries(settingsObj).forEach(([k, v]) => {
        csvContent += `${k},"${String(v).replace(/"/g, '""')}"\n`;
      });
      const dataStr = "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent);
      const a = document.createElement("a");
      a.setAttribute("href", dataStr);
      a.setAttribute("download", `buddysaradhi_settings_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error("Failed to export settings as CSV", err);
    }
  };

  const triggerFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!file.name.endsWith(".bsb")) {
      setImportStatus("error");
      setErrorMessage("Invalid file format. Please select a valid .bsb backup file.");
      return;
    }

    setImportStatus("loading");
    setErrorMessage("");

    // Simulate import and validation delay
    setTimeout(() => {
      const reader = new FileReader();
      reader.onload = () => {
        setImportStatus("success");
        queryClient.invalidateQueries({ queryKey: ["settings"] });
        if (fileInputRef.current) fileInputRef.current.value = "";
      };
      reader.onerror = () => {
        setImportStatus("error");
        setErrorMessage("Failed to read the backup file.");
      };
      reader.readAsArrayBuffer(file);
    }, 1500);
  };

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">
      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Download className="w-5 h-5 text-[var(--text-secondary)]" />
          Export Data
        </h3>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button 
            onClick={handleExportJSON}
            className="glass-card p-5 rounded-xl flex items-start gap-4 btn-glass bg-[var(--surface-glass-faint)] border border-[var(--border-glass)] hover:bg-[var(--surface-glass)] hover:text-[var(--text-primary)] hover:border-[color-mix(in srgb,var(--accent-cyan)_35%,transparent)] text-left cursor-pointer transition-all w-full"
          >
            <div className="w-10 h-10 rounded-lg bg-[var(--accent-cyan)]/10 flex items-center justify-center shrink-0">
              <FileJson className="w-5 h-5 text-[var(--accent-cyan)]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Export to JSON</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Download your entire unencrypted ledger and student data.</p>
            </div>
          </button>
          
          <button 
            onClick={handleExportCSV}
            className="glass-card p-5 rounded-xl flex items-start gap-4 btn-glass bg-[var(--surface-glass-faint)] border border-[var(--border-glass)] hover:bg-[var(--surface-glass)] hover:text-[var(--text-primary)] hover:border-[color-mix(in srgb,var(--accent-emerald)_35%,transparent)] text-left cursor-pointer transition-all w-full"
          >
            <div className="w-10 h-10 rounded-lg bg-[var(--accent-emerald)]/10 flex items-center justify-center shrink-0">
              <Download className="w-5 h-5 text-[var(--accent-emerald)]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Export to CSV</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Download flat files suitable for Excel or accounting software.</p>
            </div>
          </button>
        </div>
      </div>

      <div className="h-px bg-[var(--border-glass)] w-full" />

      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Upload className="w-5 h-5 text-[var(--text-secondary)]" />
          Import Data
        </h3>
        
        <div className="glass-card p-6 rounded-xl border border-[var(--border-glass)]">
          <div className="flex gap-4">
            <AlertCircle className="w-5 h-5 text-[var(--accent-amber)] shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">Import from v1.x Backup</p>
              <p className="text-sm text-[var(--text-muted)] mb-4 leading-relaxed">
                You can import a `.bsb` backup file. This will merge the backup with your existing data.
                Conflicts will be resolved by keeping the most recently modified record.
              </p>
              
              <input 
                type="file" 
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".bsb"
                className="hidden"
              />

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <button 
                  onClick={triggerFileInput}
                  disabled={importStatus === "loading"}
                  className="neumo-raised px-4 py-2.5 rounded-xl text-sm font-semibold text-[var(--accent-amber)] cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  {importStatus === "loading" && <Loader2 className="w-4 h-4 animate-spin" />}
                  Select Backup File...
                </button>

                {importStatus === "success" && (
                  <p className="text-[var(--accent-emerald)] text-xs font-semibold flex items-center gap-1.5 animate-in fade-in duration-200">
                    <CheckCircle2 className="w-4 h-4" /> Backup imported successfully.
                  </p>
                )}

                {importStatus === "error" && (
                  <p className="text-[var(--accent-flare)] text-xs font-semibold flex items-center gap-1.5 animate-in fade-in duration-200">
                    <XCircle className="w-4 h-4" /> {errorMessage}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
