// Implements: docs/design/overhaul-plan.md §4.2 — "Export requests: the
// zip-and-mail flow. Admin sees metadata only (filename, size, SHA-256,
// expiry, state). Delivery is a signed, expiring link; the artefact is never
// stored in the app and never rendered in the UI."
//
// This module is the hard boundary for owner rule 3. Nothing in this file can
// hold a download URL, a signed token, a byte of the archive, or any tenant
// content. The interface returns metadata and nothing else, so a future
// implementation cannot widen it by accident: there is no accessor to widen.

import type { ExportRequestState } from "./types.ts";
import { EXPORT_REQUEST_STATES, EXPORT_STATE_LABEL } from "./types.ts";
import { AdminRecordNotFound } from "./subscriptions.ts";

export interface ExportRequestMetadata {
  readonly id: string;
  readonly tenantId: string;
  readonly filename: string;
  /** Unknown until the engine has packed the archive. */
  readonly sizeBytes: number | null;
  /** Unknown until the engine has packed the archive. */
  readonly sha256: string | null;
  readonly requestedAt: string;
  /** When the temporary download window closes. Null while still queued. */
  readonly linkExpiresAt: string | null;
  readonly state: ExportRequestState;
  readonly windowHours: number;
  readonly requestedBy: string;
}

export interface ExportRepository {
  list(nowIso: string): Promise<readonly ExportRequestMetadata[]>;
  get(id: string): Promise<ExportRequestMetadata | null>;
  request(tenantId: string, windowHours: number, actor: string, nowIso: string): Promise<ExportRequestMetadata>;
  advance(id: string, to: ExportRequestState, actor: string, nowIso: string): Promise<ExportRequestMetadata>;
  revoke(id: string, actor: string, nowIso: string): Promise<ExportRequestMetadata>;
}

/**
 * The only legal metadata moves (entitlements-contract.md §3). The ladder is
 * forward-only: `queued → packaging → mailed → downloaded → expired`, with
 * `expired` reachable from any live state (revoke, or the hourly sweep closing
 * the window). `expired` is terminal. Artefact bytes never travel this path:
 * the size and digest stay whatever the packaging engine wrote, and a console
 * advance never invents them.
 */
export function isExportTransitionLegal(from: ExportRequestState, to: ExportRequestState): boolean {
  if (from === to) return false;
  if (to === "expired") return from !== "expired";
  if (from === "queued") return to === "packaging";
  if (from === "packaging") return to === "mailed";
  if (from === "mailed") return to === "downloaded";
  return false;
}

/** Typed refusal. Rule 9: the console says why, it does not silently no-op. */
export class ExportTransitionRefused extends Error {
  readonly from: ExportRequestState;
  readonly to: ExportRequestState;

  constructor(from: ExportRequestState, to: ExportRequestState) {
    super(`Cannot move an export request from ${EXPORT_STATE_LABEL[from]} to ${EXPORT_STATE_LABEL[to]}.`);
    this.name = "ExportTransitionRefused";
    this.from = from;
    this.to = to;
  }
}

function isoHoursFromNow(nowIso: string, hours: number): string {
  const base = Date.parse(nowIso);
  if (!Number.isFinite(base)) throw new TypeError(`NOW_ISO_INVALID: ${nowIso}`);
  return new Date(base + hours * 3_600_000).toISOString();
}

function isoHoursAgo(nowIso: string, hours: number): string {
  const base = Date.parse(nowIso);
  if (!Number.isFinite(base)) throw new TypeError(`NOW_ISO_INVALID: ${nowIso}`);
  return new Date(base - hours * 3_600_000).toISOString();
}

function seedRows(nowIso: string): ExportRequestMetadata[] {
  return [
    {
      id: "ex-0041",
      tenantId: "t-0003",
      filename: "t-0003-buddysaradhi-archive.zip",
      sizeBytes: 4_182_733,
      sha256: "9f2c41b7ad5e0c63f18a7bd44e9027c15b6f8d3ea41c07b95e2f6a8d10c3b47e29",
      requestedAt: isoHoursAgo(nowIso, 30),
      linkExpiresAt: isoHoursFromNow(nowIso, 42),
      state: "mailed",
      windowHours: 72,
      requestedBy: "engine",
    },
    {
      id: "ex-0040",
      tenantId: "t-0006",
      filename: "t-0006-buddysaradhi-archive.zip",
      sizeBytes: 1_204_881,
      sha256: "3d81ab5f0c27e94b6ad1f8025e3c7b40d95a1f6c28b7e04d93a5c1f82b60e7d3a",
      requestedAt: isoHoursAgo(nowIso, 96),
      linkExpiresAt: isoHoursAgo(nowIso, 24),
      state: "expired",
      windowHours: 72,
      requestedBy: "engine",
    },
    {
      id: "ex-0042",
      tenantId: "t-0002",
      filename: "t-0002-buddysaradhi-archive.zip",
      sizeBytes: null,
      sha256: null,
      requestedAt: isoHoursAgo(nowIso, 1),
      linkExpiresAt: null,
      state: "queued",
      windowHours: 72,
      requestedBy: "ops@buddysaradhi.app",
    },
  ];
}

let rows: readonly ExportRequestMetadata[] | null = null;
let sequence = 42;

function store(nowIso: string): readonly ExportRequestMetadata[] {
  if (rows === null) rows = seedRows(nowIso);
  return rows;
}

function write(next: readonly ExportRequestMetadata[]): void {
  rows = next;
}

const memoryRepository: ExportRepository = {
  async list(nowIso) {
    return [...store(nowIso)].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  },

  async get(id) {
    return store(new Date().toISOString()).find((row) => row.id === id) ?? null;
  },

  async request(tenantId, windowHours, actor, nowIso) {
    const current = store(nowIso);
    sequence += 1;
    const id = `ex-${String(sequence).padStart(4, "0")}`;
    const created: ExportRequestMetadata = {
      id,
      tenantId,
      filename: `${tenantId}-buddysaradhi-archive.zip`,
      sizeBytes: null,
      sha256: null,
      requestedAt: nowIso,
      linkExpiresAt: null,
      state: "queued",
      windowHours,
      requestedBy: actor,
    };
    write([created, ...current]);
    return created;
  },

  async revoke(id, _actor, nowIso) {
    const current = store(nowIso);
    const previous = current.find((row) => row.id === id);
    if (previous === undefined) throw new AdminRecordNotFound(`No export request ${id}.`);
    const next: ExportRequestMetadata = { ...previous, state: "expired", linkExpiresAt: nowIso };
    write(current.map((row) => (row.id === id ? next : row)));
    return next;
  },

  async advance(id, to, _actor, nowIso) {
    const current = store(nowIso);
    const previous = current.find((row) => row.id === id);
    if (previous === undefined) throw new AdminRecordNotFound(`No export request ${id}.`);
    if (!isExportTransitionLegal(previous.state, to)) {
      throw new ExportTransitionRefused(previous.state, to);
    }
    // The console moves metadata only. Mailing starts the download window;
    // expiring closes it now. Size and digest are the packaging engine's
    // fields: a console advance carries them over untouched, never computed.
    const linkExpiresAt =
      to === "mailed"
        ? isoHoursFromNow(nowIso, previous.windowHours)
        : to === "expired"
          ? nowIso
          : previous.linkExpiresAt;
    const next: ExportRequestMetadata = { ...previous, state: to, linkExpiresAt };
    write(current.map((row) => (row.id === id ? next : row)));
    return next;
  },
};

let repository: ExportRepository = memoryRepository;

export function setExportRepository(next: ExportRepository): void {
  repository = next;
}

export function resetExportRepository(): void {
  repository = memoryRepository;
  rows = null;
  sequence = 42;
}

export function exportRequests(): ExportRepository {
  return repository;
}

export function isExportRequestState(value: string): value is ExportRequestState {
  return (EXPORT_REQUEST_STATES as readonly string[]).includes(value);
}

/** Requests whose download window is still open, newest first. */
export function pendingExports(rowsIn: readonly ExportRequestMetadata[]): readonly ExportRequestMetadata[] {
  return rowsIn.filter((row) => row.state === "queued" || row.state === "packaging" || row.state === "mailed");
}

/** One line an admin can act on. The label is the signal, not the dot. */
export function exportStateSentence(row: ExportRequestMetadata, nowIso: string): string {
  const label = EXPORT_STATE_LABEL[row.state];
  if (row.state === "queued" || row.state === "packaging") return `${label}, digest not computed yet`;
  if (row.linkExpiresAt === null) return label;
  const msLeft = Date.parse(row.linkExpiresAt) - Date.parse(nowIso);
  if (row.state === "expired") return `${label}, window closed`;
  if (msLeft <= 0) return `${label}, window closed`;
  const hoursLeft = Math.round(msLeft / 3_600_000);
  if (hoursLeft < 48) return `${label}, ${hoursLeft} hours left`;
  return `${label}, ${Math.round(hoursLeft / 24)} days left`;
}