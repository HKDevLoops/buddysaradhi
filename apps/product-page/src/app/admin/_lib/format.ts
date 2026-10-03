// Implements: docs/design/overhaul-plan.md §4.2 — display formatting for the
// admin console. Deterministic and locale-pinned: an operator comparing two
// contracts must see the same string every time.
//
// AGENTS.md §2 Rule 6 is satisfied by absence. This product does not process
// payments, so there is no amount, no currency and no paise here. The formatter
// that does handle money (formatINR, integer paise) belongs to the web app and
// has no place in a console that must never show a figure.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** `2026-11-17` -> `17 Nov 2026`. Passes the input through if it is not a date. */
export function formatDate(iso: string): string {
  if (!ISO_DATE.test(iso)) return iso;
  const parsed = Date.parse(`${iso}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return iso;
  const date = new Date(parsed);
  const month = MONTHS[date.getUTCMonth()] ?? "";
  return `${String(date.getUTCDate()).padStart(2, "0")} ${month} ${date.getUTCFullYear()}`;
}

/** Full timestamp for the audit trail, UTC, seconds precision. */
export function formatDateTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  const date = new Date(parsed);
  const time = `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
  return `${formatDate(date.toISOString().slice(0, 10))} ${time} UTC`;
}

/** `1_204_881` -> `1.15 MB`. Unknown sizes render as an explicit dash. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "not computed";
  if (!Number.isFinite(bytes) || bytes < 0) return "not computed";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit] ?? "KB"}`;
}

/** Whole days from today. Negative means past. Used for "expires in" copy. */
export function daysFromToday(iso: string, nowIso: string): number {
  const target = Date.parse(`${iso}T00:00:00.000Z`);
  const today = Date.parse(`${nowIso.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(target) || !Number.isFinite(today)) return 0;
  return Math.round((target - today) / 86_400_000);
}

/** Compact one-line window description, or null when there is no window. */
export function windowSentence(expiresAt: string | null, nowIso: string): string | null {
  if (expiresAt === null) return null;
  const ms = Date.parse(expiresAt) - Date.parse(nowIso);
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "window closed";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return `${hours} hours left`;
  return `${Math.round(hours / 24)} days left`;
}

/** True when the field is a plain `YYYY-MM-DD` the date inputs can accept. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  return Number.isFinite(Date.parse(`${value}T00:00:00.000Z`));
}

// --- notice and error codes carried in the query string ---------------------
// A server action refuses by redirecting with a code, so every page has to turn
// an untrusted query parameter back into typed text. An unknown code is null,
// never a raw echo of whatever arrived in the URL.

import { ADMIN_ERROR_TEXT, ADMIN_NOTICE_TEXT } from "./types";
import type { AdminErrorCode, AdminNoticeCode } from "./types";

export function readNoticeText(value: string | undefined): string | null {
  if (value === undefined || !(value in ADMIN_NOTICE_TEXT)) return null;
  // SAFETY: the membership check above proves the key exists on ADMIN_NOTICE_TEXT,
  // whose keys are exactly AdminNoticeCode.
  return ADMIN_NOTICE_TEXT[value as AdminNoticeCode];
}

export function readErrorCode(value: string | undefined): AdminErrorCode | null {
  if (value === undefined || !(value in ADMIN_ERROR_TEXT)) return null;
  // SAFETY: same membership check as readNoticeText.
  return value as AdminErrorCode;
}

/** One sentence an operator can act on: what broke, then how to fix it. */
export function errorSentence(code: AdminErrorCode, detail: string | null): string {
  const entry = ADMIN_ERROR_TEXT[code];
  return `${entry.title} ${detail === null || detail.length === 0 ? entry.recovery : detail}`;
}