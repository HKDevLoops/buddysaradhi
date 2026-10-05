// Implements: 01_Product_Principles.md P5 (offline-first) — persistent-storage
// permission keeps the tutor's local offline records safe from browser eviction
// under disk pressure (Settings → Diagnostics → Device storage).
// AGENTS.md §2 Rule 9: every failure returns a typed result. Nothing here
// throws raw and nothing writes to the console; unexpected throws are mapped
// to static UI-safe messages through the app-errors taxonomy.

import { toAppErrorState, type AppErrorCode } from "./app-errors";
import { log } from "./logger";

/** The persistence state of this device's stored data. */
export type PersistedState = "persisted" | "not-persisted" | "unsupported";

/** The outcome of a completed `navigator.storage.persist()` request. */
export type PersistRequestOutcome = "granted" | "denied";

/**
 * Typed result of asking the browser to keep this device's data.
 * Success carries the browser's answer (`granted` / `denied`).
 * Failure carries a machine-readable `outcome` plus a static, render-safe
 * `message` — raw error text never passes through.
 */
export type StoragePersistResult =
  | { success: true; outcome: PersistRequestOutcome }
  | { success: false; outcome: "unavailable" | "error"; code: AppErrorCode; message: string };

/** Measured local usage in bytes; `quotaBytes` is null when the browser hides it. */
export interface StorageUsage {
  usageBytes: number;
  quotaBytes: number | null;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * True when the `navigator.storage` persist/persisted API is callable.
 * SSR-safe: returns false when `navigator` does not exist.
 */
export function isPersistenceSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    typeof navigator.storage?.persist === "function" &&
    typeof navigator.storage?.persisted === "function"
  );
}

/**
 * Reads whether the browser has marked this device's data persistent.
 * Returns `unsupported` when the API is missing (SSR, old browsers) and
 * `not-persisted` when the state cannot be confirmed — never throws.
 */
export async function persistedState(): Promise<PersistedState> {
  if (!isPersistenceSupported()) return "unsupported";
  try {
    const persisted = await navigator.storage.persisted();
    return persisted ? "persisted" : "not-persisted";
  } catch {
    log.warn(
      "storage_persisted_check_failed",
      "Could not read this device's storage persistence state.",
    );
    return "not-persisted";
  }
}

/**
 * Asks the browser to mark this device's data persistent so offline records
 * are not evicted under disk pressure. Never throws: a missing API resolves
 * to `unavailable`, a browser refusal resolves to `denied`, and an unexpected
 * throw resolves to a classified `error` with a static message.
 */
export async function requestPersistence(): Promise<StoragePersistResult> {
  if (!isPersistenceSupported()) {
    return {
      success: false,
      outcome: "unavailable",
      code: "UNKNOWN",
      message: "This browser does not offer persistent storage. Your data is still saved on this device.",
    };
  }
  try {
    const granted = await navigator.storage.persist();
    return granted
      ? { success: true, outcome: "granted" }
      : { success: true, outcome: "denied" };
  } catch (err) {
    const state = toAppErrorState(err);
    return { success: false, outcome: "error", code: state.code, message: state.message };
  }
}

function toNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

/**
 * Reads `navigator.storage.estimate()` for the diagnostics usage line.
 * Returns null when the API is missing, the read throws, or the browser
 * reports no usable figure — never throws.
 */
export async function estimateStorage(): Promise<StorageUsage | null> {
  if (typeof navigator === "undefined") return null;
  if (typeof navigator.storage?.estimate !== "function") return null;
  try {
    const result = await navigator.storage.estimate();
    const usageBytes = toNonNegativeInt(result.usage);
    if (usageBytes === null) return null;
    return { usageBytes, quotaBytes: toNonNegativeInt(result.quota) };
  } catch {
    log.warn(
      "storage_estimate_failed",
      "Could not read this device's storage usage estimate.",
    );
    return null;
  }
}

/** Formats a byte count for display, e.g. `512 B`, `1.5 KB`, `4.2 MB`. */
export function formatBytes(bytes: number): string {
  const safe = toNonNegativeInt(bytes);
  if (safe === null) return "0 B";
  if (safe < 1024) return `${safe} B`;
  let value = safe / 1024;
  let unit = 1;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = Math.round(value * 10) / 10;
  const label = BYTE_UNITS[unit] ?? "B";
  return `${rounded} ${label}`;
}
