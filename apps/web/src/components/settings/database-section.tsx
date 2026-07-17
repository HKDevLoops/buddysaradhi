"use client";

import { useState } from "react";
import { Database, Key, CheckCircle2, Loader2, Info } from "lucide-react";

export function DatabaseSection() {
  const [connectionString, setConnectionString] = useState("");
  const [status, setStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");

  // Mock only — no real network call. Mirrors the existing BFF mock behaviour.
  const testConnection = () => {
    if (connectionString.trim().length < 8) {
      setStatus("error");
      return;
    }
    setStatus("testing");
    window.setTimeout(() => setStatus("ok"), 900);
  };

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h2 className="text-lg font-medium text-[var(--text-primary)] mb-2 flex items-center gap-2">
          <Database className="w-5 h-5 text-[var(--accent-cyan)]" />
          Database Connection
        </h2>
        <p className="text-sm text-[var(--text-muted)] leading-relaxed">
          BuddySaradhi stores everything on this device by default. Advanced users may point it at a sync database. This connection is mocked in this build.
        </p>
      </div>

      <div className="bg-[var(--accent-cyan)]/10 border border-[var(--accent-cyan)]/20 rounded-xl p-4 flex gap-4">
        <Info className="w-5 h-5 text-[var(--accent-cyan)] shrink-0 mt-0.5" />
        <div className="text-sm text-[var(--accent-cyan)]/90">
          <p className="font-medium mb-1">Demo only</p>
          <p>No credentials are transmitted or stored. This field is a visual mock of the production sync connection.</p>
        </div>
      </div>

      <div className="space-y-6">
        <div>
          <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Connection String</label>
          <div className="relative">
            <Key className="w-4 h-4 text-[var(--text-muted)] absolute left-4 top-3.5 pointer-events-none" />
            <input
              type="password"
              value={connectionString}
              onChange={(e) => {
                setConnectionString(e.target.value);
                if (status !== "idle") setStatus("idle");
              }}
              placeholder="libsql://your-db.turso.io"
              aria-label="Database connection string"
              className="neumo-inset w-full pl-11 pr-4 py-3 text-sm text-[var(--text-primary)] rounded-xl outline-none transition font-mono focus:border-[var(--accent-cyan)]"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={testConnection}
          disabled={status === "testing"}
          className="neumo-raised py-3 px-6 rounded-xl text-sm font-bold text-[var(--accent-cyan)] shadow-[0_0_14px_rgba(0,240,255,0.22)] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none flex items-center justify-center gap-2 cursor-pointer"
        >
          {status === "testing" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
          Test Connection
        </button>

        {status === "ok" && (
          <div className="flex items-center gap-2 text-sm text-[var(--accent-emerald)]">
            <CheckCircle2 className="w-4 h-4" />
            Connection successful (mock).
          </div>
        )}
        {status === "error" && (
          <p className="text-sm text-[var(--accent-flare)]">Enter a connection string of at least 8 characters to test.</p>
        )}
      </div>
    </div>
  );
}
