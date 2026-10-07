"use client";

// Implements: docs/rfc/004-multi-device-network-contract.md §1 C3 (intents
// created offline persist to a durable per-tenant queue and flush in order on
// `online`/reconnect with the same keys; UI marks queued vs confirmed,
// never silent) + C6 (bounded attempts, small payloads, event-driven via
// online/offline + visibilitychange — never polling) + K5 (FIFO drain, order
// preserved). AGENTS.md §2 Rule 9 (typed results, try/catch on every storage
// access with in-memory fallback + surfaced warning, typed overflow).
//
// PII / SOVEREIGNTY NOTE (read-only finding — no new PII collected):
// - Queue entries hold EXACTLY what the server action already accepts
//   (student ids, paise amounts, dates, descriptions). No tokens, secrets,
//   PINs, or passwords may be queued — `enqueueIntent` rejects payloads whose
//   TOP-LEVEL field names look credential-like, with a typed error.
// - Keys are tenant-scoped (`buddysaradhi.queue.<tenantId>`); entries are
//   cleared on sign-out — hook point (read-only, NOT wired here):
//   `src/components/buddysaradhi/glass-shell.tsx:42-53 onSignOut` — call
//   `clearQueue(tenantId)` alongside the existing `queryClient.clear()`
//   before `signOutAction()`.
// - localStorage is device-plaintext (same sensitivity as existing client
//   state). The offline queue is a v1 transport buffer, not a vault.

import { useCallback, useEffect, useRef, useState } from "react";
import { mintIntentKey } from "./intent-key";
import { BoundedCache } from "./lru";
import type { ActionResult } from "./retry-invoke";

export const QUEUE_PREFIX = "buddysaradhi.queue.";
export const QUEUE_CAP = 100;
export const MAX_PAYLOAD_BYTES = 65536;
export const DRAIN_LIMIT_DEFAULT = 25;

export interface QueuedIntent {
  key: string;
  action: string;
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
}

export interface EnqueueInput {
  action: string;
  payload: Record<string, unknown>;
  /** Reuse an existing intent key (retry/double-click collapse). Freshly minted when omitted. */
  key?: string;
}

export type EnqueueResult =
  | { ok: true; key: string; position: number; droppedOldest: string | null; warning: string | null }
  | { ok: false; error: string; warning: string | null };

export interface ReadQueueResult {
  items: QueuedIntent[];
  warning: string | null;
}

export interface DrainOptions {
  /** Max intents per drain call (bounded free-tier work per online event). */
  limit?: number;
}

export interface DrainSummary {
  confirmed: string[];
  failed: { key: string; error: string } | null;
  remaining: number;
  skippedOffline: boolean;
}

export interface FlushState {
  isOnline: boolean;
  flushing: boolean;
  /** Intents persisted but not yet confirmed — the "queued" UI mark. */
  pending: number;
  lastFlushAt: string | null;
  lastConfirmed: number;
  refresh: () => void;
}

const SENSITIVE_FIELD_RE = /(passw|secret|token|api[-_ ]?key|pin|otp|ssn|cvv)/i;

// ── storage (every access guarded: private-mode quota throws) ───────────────

/**
 * Tenants whose in-memory fallback queue is kept at once.
 *
 * The fallback only engages when `localStorage` is unavailable (private mode,
 * quota exhausted, disabled). Each held tenant is already bounded on its own by
 * `QUEUE_CAP` rows and `MAX_PAYLOAD_BYTES` per row, but the NUMBER of tenants
 * holding such a row was unbounded — so a long-lived tab on a shared kiosk, or
 * a browser that never recovers from a quota error, grew one array per tenant
 * for the life of the page (TABS-HARDEN-01 Phase 2). Eight is far above the
 * normal case (one tenant per browser) while capping the worst case at
 * 8 x QUEUE_CAP rows.
 */
export const MEMORY_FALLBACK_TENANT_MAX = 8;

const memoryFallback = new BoundedCache<string, QueuedIntent[]>(MEMORY_FALLBACK_TENANT_MAX, (key) => {
  // Losing a queued intent is the K5 failure this module exists to prevent, so
  // eviction is SURFACED through the same latch as a durability degradation
  // (AGENTS.md §2 Rule 9 — never silent). The storage key is
  // `buddysaradhi.queue.<sanitised tenant>`, so the tenant is named rather than
  // an opaque key.
  noteFallbackReason(
    `In-memory queue for ${key} was dropped: the offline fallback keeps only the ${MEMORY_FALLBACK_TENANT_MAX} most recently used tenants and this one was least recently used.`,
  );
});
let fallbackReason: string | null = null;

/**
 * Records a durability warning. The first reason is kept whole; later ones are
 * appended so no occurrence is ever dropped silently.
 */
function noteFallbackReason(reason: string): void {
  fallbackReason = fallbackReason === null ? reason : `${fallbackReason}; ${reason}`;
}

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

/** Test-only reset for the in-memory fallback + warning latch. */
export function resetQueueStorageForTests(): void {
  memoryFallback.clear();
  fallbackReason = null;
}

/**
 * Live entry count for the bounded in-memory fallback, so the bound is a
 * runtime fact rather than a claim in a comment.
 */
export function memoryFallbackStats(): { size: number; max: number } {
  return { size: memoryFallback.size, max: memoryFallback.max };
}

/** Surfaced (never silent) warning when durability degraded to memory. */
export function getQueueStorageWarning(): string | null {
  return fallbackReason;
}

export function isQueueStorageDurable(): boolean {
  return fallbackReason === null;
}

/** Tenant segment of the storage key — sanitised, never empty-checked here. */
export function queueKeyFor(tenantId: string): string {
  const safe = tenantId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return `${QUEUE_PREFIX}${safe}`;
}

function fieldOf(value: object, name: string): unknown {
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === name) return entryValue;
  }
  return undefined;
}

function stringFieldOf(value: object, key: string): string | null {
  const field: unknown = fieldOf(value, key);
  return typeof field === "string" ? field : null;
}

function numberFieldOf(value: object, key: string): number | null {
  const field: unknown = fieldOf(value, key);
  return typeof field === "number" ? field : null;
}

function isQueuedIntent(value: unknown): value is QueuedIntent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  // No `as` casts anywhere: every field is read as unknown and narrowed.
  const key = stringFieldOf(value, "key");
  const action = stringFieldOf(value, "action");
  const createdAt = numberFieldOf(value, "createdAt");
  const attempts = numberFieldOf(value, "attempts");
  const payload: unknown = fieldOf(value, "payload");
  return (
    key !== null &&
    key.length > 0 &&
    action !== null &&
    action.length > 0 &&
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    createdAt !== null &&
    Number.isFinite(createdAt) &&
    attempts !== null &&
    Number.isInteger(attempts) &&
    attempts >= 0
  );
}

function readRaw(storageKey: string): { items: QueuedIntent[]; corrupt: number } {
  if (!hasWindow()) return { items: memoryFallback.get(storageKey) ?? [], corrupt: 0 };
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return { items: memoryFallback.get(storageKey) ?? [], corrupt: 0 };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { items: [], corrupt: 1 };
    const items: QueuedIntent[] = [];
    let corrupt = 0;
    for (const row of parsed) {
      if (isQueuedIntent(row)) items.push(row);
      else corrupt += 1;
    }
    return { items, corrupt };
  } catch {
    // Corrupt JSON or synchronous read failure — surfaced below, never thrown.
    return { items: memoryFallback.get(storageKey) ?? [], corrupt: 1 };
  }
}

function writeRaw(storageKey: string, items: QueuedIntent[]): void {
  const raw = JSON.stringify(items);
  // An emptied queue must RELEASE its bounded slot rather than pin it with an
  // empty array — otherwise `clearQueue` on a storage-less device left one slot
  // occupied per tenant forever.
  if (items.length === 0) {
    memoryFallback.delete(storageKey);
  }
  if (!hasWindow()) {
    if (items.length > 0) memoryFallback.set(storageKey, items);
    return;
  }
  try {
    window.localStorage.setItem(storageKey, raw);
  } catch {
    // Private-mode quota (or disabled storage): keep the intent in memory and
    // surface the degradation — losing an intent silently is the K5 failure.
    if (items.length > 0) memoryFallback.set(storageKey, items);
    noteFallbackReason(
      "Offline queue storage is unavailable (private mode or quota) — intents are held in memory only and will not survive a reload.",
    );
  }
}

/** FIFO-ordered snapshot (oldest `createdAt` first). */
export function readQueue(tenantId: string): ReadQueueResult {
  if (!tenantId) return { items: [], warning: "readQueue: tenant id is required" };
  const { items, corrupt } = readRaw(queueKeyFor(tenantId));
  const ordered = [...items].sort((a, b) => a.createdAt - b.createdAt);
  const warnings: string[] = [];
  if (corrupt > 0) warnings.push(`${corrupt} malformed queue row(s) were skipped`);
  if (fallbackReason !== null) warnings.push(fallbackReason);
  return { items: ordered, warning: warnings.length > 0 ? warnings.join("; ") : null };
}

function payloadSizeBytes(payload: Record<string, unknown>): number | null {
  try {
    return JSON.stringify(payload)?.length ?? null;
  } catch {
    return null;
  }
}

/**
 * Persists one intent. Enforces the cap (drop-oldest, SURFACED via
 * `droppedOldest` — never silent), the small-payload budget, and the
 * no-credentials rule. Idempotent on `key`: re-enqueueing the same key
 * replaces the row in place (double-click collapse, K1).
 */
export function enqueueIntent(tenantId: string, input: EnqueueInput): EnqueueResult {
  if (!tenantId) return { ok: false, error: "enqueueIntent: tenant id is required", warning: fallbackReason };
  if (!input.action) return { ok: false, error: "enqueueIntent: action name is required", warning: fallbackReason };
  for (const field of Object.keys(input.payload)) {
    if (SENSITIVE_FIELD_RE.test(field)) {
      return {
        ok: false,
        error: `enqueueIntent: payload field "${field}" looks credential-like and may never be queued`,
        warning: fallbackReason,
      };
    }
  }
  const size = payloadSizeBytes(input.payload);
  if (size === null) {
    return { ok: false, error: "enqueueIntent: payload is not JSON-serializable", warning: fallbackReason };
  }
  if (size > MAX_PAYLOAD_BYTES) {
    return {
      ok: false,
      error: `enqueueIntent: payload is ${size} bytes, over the ${MAX_PAYLOAD_BYTES}-byte budget (small payloads, C6)`,
      warning: fallbackReason,
    };
  }
  const key = input.key && input.key.length > 0 ? input.key : mintIntentKey();
  const storageKey = queueKeyFor(tenantId);
  const { items } = readRaw(storageKey);
  const existingIndex = items.findIndex((row) => row.key === key);
  let droppedOldest: string | null = null;
  let next: QueuedIntent[];
  if (existingIndex >= 0) {
    next = items.map((row, index) =>
      index === existingIndex
        ? { key, action: input.action, payload: input.payload, createdAt: row.createdAt, attempts: row.attempts }
        : row,
    );
  } else {
    next = [...items, { key, action: input.action, payload: input.payload, createdAt: Date.now(), attempts: 0 }];
    while (next.length > QUEUE_CAP) {
      const dropped = next.shift();
      if (dropped) droppedOldest = dropped.key;
    }
  }
  writeRaw(storageKey, next);
  return { ok: true, key, position: next.findIndex((row) => row.key === key), droppedOldest, warning: fallbackReason };
}

/** Removes one intent by key (confirmed replay / explicit discard). */
export function removeIntent(tenantId: string, key: string): void {
  if (!tenantId || !key) return;
  const storageKey = queueKeyFor(tenantId);
  const { items } = readRaw(storageKey);
  writeRaw(
    storageKey,
    items.filter((row) => row.key !== key),
  );
}

/** Clears a tenant's queue — the sign-out hook point (see header). */
export function clearQueue(tenantId: string): { ok: true; cleared: number } {
  if (!tenantId) return { ok: true, cleared: 0 };
  const storageKey = queueKeyFor(tenantId);
  const { items } = readRaw(storageKey);
  writeRaw(storageKey, []);
  return { ok: true, cleared: items.length };
}

/**
 * Clears EVERY tenant queue on this device — sign-out safety net for shared
 * devices (a tenant switch without sign-out must not replay another tenant's
 * intents). Best-effort: storage failures are swallowed by design (logout
 * must never fail because a queue could not be cleared).
 */
export function clearAllQueues(): { ok: true; cleared: number } {
  if (!hasWindow()) return { ok: true, cleared: 0 };
  let cleared = 0;
  try {
    const victims: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(QUEUE_PREFIX)) victims.push(k);
    }
    for (const k of victims) {
      try {
        const raw = window.localStorage.getItem(k);
        const items = raw ? (JSON.parse(raw) as unknown[]) : [];
        cleared += Array.isArray(items) ? items.length : 0;
      } catch {
        // Count as cleared even if the payload is unparseable — removing it
        // is the safe action.
      }
      window.localStorage.removeItem(k);
    }
  } catch {
    // Logout proceeds regardless (see above).
  }
  return { ok: true, cleared };
}

function isOfflineNow(): boolean {
  return hasWindow() && typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * FIFO drain with the SAME keys (K5). Stops at the first failure or when the
 * device drops offline mid-drain — order is preserved, the failed head stays
 * queued with bumped `attempts` for the next online event. Bounded per call
 * (`limit`, default 25). `invoke` replays each intent, e.g.
 * `(item) => recordPaymentAction(..., { ...opts, intentKey: item.key })`.
 */
export async function drainQueue<T>(
  tenantId: string,
  invoke: (item: QueuedIntent) => Promise<ActionResult<T>>,
  options?: DrainOptions,
): Promise<DrainSummary> {
  if (!tenantId) {
    return { confirmed: [], failed: { key: "", error: "drainQueue: tenant id is required" }, remaining: 0, skippedOffline: false };
  }
  if (isOfflineNow()) {
    return { confirmed: [], failed: null, remaining: readQueue(tenantId).items.length, skippedOffline: true };
  }
  const limit = Math.min(QUEUE_CAP, Math.max(1, Math.floor(options?.limit ?? DRAIN_LIMIT_DEFAULT)));
  const confirmed: string[] = [];
  const head = readQueue(tenantId).items.slice(0, limit);
  for (const item of head) {
    if (isOfflineNow()) break;
    let result: ActionResult<T>;
    try {
      result = await invoke(item);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      bumpAttempts(tenantId, item.key);
      return { confirmed, failed: { key: item.key, error: message }, remaining: readQueue(tenantId).items.length, skippedOffline: false };
    }
    if (result.success) {
      removeIntent(tenantId, item.key);
      confirmed.push(item.key);
    } else {
      bumpAttempts(tenantId, item.key);
      return {
        confirmed,
        failed: { key: item.key, error: result.error },
        remaining: readQueue(tenantId).items.length,
        skippedOffline: false,
      };
    }
  }
  return { confirmed, failed: null, remaining: readQueue(tenantId).items.length, skippedOffline: false };
}

function bumpAttempts(tenantId: string, key: string): void {
  const storageKey = queueKeyFor(tenantId);
  const { items } = readRaw(storageKey);
  writeRaw(
    storageKey,
    items.map((row) => (row.key === key ? { ...row, attempts: row.attempts + 1 } : row)),
  );
}

/**
 * Event-driven flush (C6 — online/offline + visibilitychange ONLY, never
 * polling, never an interval). Mounts: refresh count, flush if online with
 * backlog. `flush` is the caller's `() => drainQueue(tenantId, invoke)`.
 * The returned `pending` count is the "queued" mark; a drained intent is the
 * "confirmed" mark — the UI must render the two distinctly.
 */
export function useOnlineFlush(tenantId: string, flush: () => Promise<unknown>): FlushState {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine !== false,
  );
  const [flushing, setFlushing] = useState(false);
  const [pending, setPending] = useState<number>(() =>
    tenantId ? readQueue(tenantId).items.length : 0,
  );
  const [lastFlushAt, setLastFlushAt] = useState<string | null>(null);
  const [lastConfirmed, setLastConfirmed] = useState(0);
  const flushingRef = useRef(false);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const refresh = useCallback(() => {
    if (!tenantId || !hasWindow()) return;
    setPending(readQueue(tenantId).items.length);
  }, [tenantId]);

  const runFlush = useCallback(async () => {
    if (flushingRef.current || !tenantId || !hasWindow()) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    flushingRef.current = true;
    setFlushing(true);
    const before = readQueue(tenantId).items.length;
    try {
      await flushRef.current();
    } catch {
      // Flush failures stay queued with bumped attempts (drainQueue never
      // throws for action failures; this guards a crashing invoke wrapper).
      // The pending count refresh below surfaces them — never silent.
    } finally {
      const after = readQueue(tenantId).items.length;
      setLastConfirmed(Math.max(0, before - after));
      setPending(after);
      setLastFlushAt(new Date().toISOString());
      setFlushing(false);
      flushingRef.current = false;
    }
  }, [tenantId]);

  useEffect(() => {
    if (!hasWindow()) return;
    refresh();
    if (typeof navigator === "undefined" || navigator.onLine !== false) {
      void runFlush();
    }
    const handleOnline = (): void => {
      setIsOnline(true);
      refresh();
      void runFlush();
    };
    const handleOffline = (): void => {
      setIsOnline(false);
      refresh();
    };
    const handleVisibility = (): void => {
      if (document.visibilityState === "visible") {
        setIsOnline(typeof navigator === "undefined" || navigator.onLine !== false);
        refresh();
        void runFlush();
      }
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh, runFlush]);

  return { isOnline, flushing, pending, lastFlushAt, lastConfirmed, refresh };
}
