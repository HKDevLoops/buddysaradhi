// Implements: docs/design/overhaul-plan.md §4.2 — "Reminder policy: gentle ->
// 1 hard -> downgrade to free + access removal; each transition audited."
//
// Owner rule 4, verbatim: gentle reminders, then EXACTLY ONE hard reminder,
// then access removed and the account shifted to the free version, then the
// user's data is zipped and mailed with a temporary download window.
//
// The console records the stage and audits the transition. It does NOT enforce
// anything: sending the mail, zipping the database and withdrawing the grant
// are the entitlement engine's jobs, and they need the §8#1 security review.
// The state machine below is the contract that engine implements, expressed
// once so neither side has to re-invent it.

import type { ReminderAdvance, ReminderStage } from "./types";
import { REMINDER_ADVANCE_LABEL, REMINDER_STAGE_LABEL } from "./types";
import { AdminRecordNotFound } from "./subscriptions";

export interface ReminderPolicy {
  /** Days after expiry before the gentle reminder goes out. */
  readonly gentleAfterDays: number;
  /** Days after expiry before the single hard reminder goes out. */
  readonly hardAfterDays: number;
  /** Fixed at one by the domain rule. Exposed so the UI can say so, not tune it. */
  readonly hardReminderCount: 1;
  /** Days after the hard reminder before access is removed. */
  readonly graceDaysBeforeDowngrade: number;
  /** Hours the signed download link stays live after the archive is mailed. */
  readonly exportWindowHours: number;
}

export interface ReminderScheduleRow {
  readonly tenantId: string;
  readonly stage: ReminderStage;
  readonly gentleSentAt: string | null;
  readonly hardSentAt: string | null;
  readonly downgradeScheduledFor: string | null;
  readonly downgradedAt: string | null;
  readonly exportRequestId: string | null;
  readonly updatedBy: string;
}

export interface ReminderRepository {
  list(nowIso: string): Promise<readonly ReminderScheduleRow[]>;
  get(tenantId: string): Promise<ReminderScheduleRow | null>;
  advance(tenantId: string, to: ReminderAdvance, actor: string, nowIso: string): Promise<ReminderScheduleRow>;
}

export const DEFAULT_REMINDER_POLICY: ReminderPolicy = {
  gentleAfterDays: 14,
  hardAfterDays: 21,
  hardReminderCount: 1,
  graceDaysBeforeDowngrade: 7,
  exportWindowHours: 72,
};

const DAY_MS = 86_400_000;

function seedRows(nowIso: string): ReminderScheduleRow[] {
  const base = Date.parse(nowIso);
  const at = (daysAgo: number): string => new Date(base - daysAgo * DAY_MS).toISOString();
  return [
    { tenantId: "t-0001", stage: "none", gentleSentAt: null, hardSentAt: null, downgradeScheduledFor: null, downgradedAt: null, exportRequestId: null, updatedBy: "system" },
    { tenantId: "t-0002", stage: "none", gentleSentAt: null, hardSentAt: null, downgradeScheduledFor: null, downgradedAt: null, exportRequestId: null, updatedBy: "system" },
    {
      tenantId: "t-0003",
      stage: "hard-sent",
      gentleSentAt: at(30),
      hardSentAt: at(9),
      downgradeScheduledFor: at(-2),
      downgradedAt: null,
      exportRequestId: "ex-0041",
      updatedBy: "ops@buddysaradhi.app",
    },
    { tenantId: "t-0004", stage: "none", gentleSentAt: null, hardSentAt: null, downgradeScheduledFor: null, downgradedAt: null, exportRequestId: null, updatedBy: "system" },
    { tenantId: "t-0005", stage: "none", gentleSentAt: null, hardSentAt: null, downgradeScheduledFor: null, downgradedAt: null, exportRequestId: null, updatedBy: "system" },
    {
      tenantId: "t-0006",
      stage: "downgraded",
      gentleSentAt: at(110),
      hardSentAt: at(100),
      downgradeScheduledFor: at(96),
      downgradedAt: at(96),
      exportRequestId: "ex-0040",
      updatedBy: "ops@buddysaradhi.app",
    },
    { tenantId: "t-0007", stage: "none", gentleSentAt: null, hardSentAt: null, downgradeScheduledFor: null, downgradedAt: null, exportRequestId: null, updatedBy: "system" },
    { tenantId: "t-0008", stage: "none", gentleSentAt: null, hardSentAt: null, downgradeScheduledFor: null, downgradedAt: null, exportRequestId: null, updatedBy: "system" },
  ];
}

let rows: readonly ReminderScheduleRow[] | null = null;

function store(nowIso: string): readonly ReminderScheduleRow[] {
  if (rows === null) rows = seedRows(nowIso);
  return rows;
}

const NEXT_STAGE: Readonly<Record<ReminderAdvance, ReminderStage>> = {
  gentle: "gentle-sent",
  hard: "hard-sent",
  downgrade: "downgraded",
};

/**
 * The only legal transitions. `hard` is reachable from `gentle-sent` and never
 * from `downgraded`, so a second hard reminder cannot be recorded. This is the
 * rule the owner stated, encoded once.
 */
export function isAdvanceLegal(from: ReminderStage, to: ReminderAdvance): boolean {
  if (from === "downgraded") return false;
  if (to === "gentle") return from === "none";
  if (to === "hard") return from === "gentle-sent";
  return from === "hard-sent";
}

/** Typed refusal. Rule 9: the console says why, it does not silently no-op. */
export class ReminderTransitionRefused extends Error {
  readonly from: ReminderStage;
  readonly to: ReminderAdvance;

  constructor(from: ReminderStage, to: ReminderAdvance) {
    super(`Cannot move from ${REMINDER_STAGE_LABEL[from]} to ${REMINDER_ADVANCE_LABEL[to]}.`);
    this.name = "ReminderTransitionRefused";
    this.from = from;
    this.to = to;
  }
}

const memoryRepository: ReminderRepository = {
  async list(nowIso) {
    return [...store(nowIso)].sort((a, b) => a.tenantId.localeCompare(b.tenantId));
  },

  async get(tenantId) {
    return store(new Date().toISOString()).find((row) => row.tenantId === tenantId) ?? null;
  },

  async advance(tenantId, to, actor, nowIso) {
    const current = store(nowIso);
    const previous = current.find((row) => row.tenantId === tenantId);
    if (previous === undefined) throw new AdminRecordNotFound(`No reminder schedule for ${tenantId}.`);
    if (!isAdvanceLegal(previous.stage, to)) throw new ReminderTransitionRefused(previous.stage, to);

    const base = Date.parse(nowIso);
    const stage = NEXT_STAGE[to];
    const next: ReminderScheduleRow = {
      ...previous,
      stage,
      gentleSentAt: to === "gentle" ? nowIso : previous.gentleSentAt,
      hardSentAt: to === "hard" ? nowIso : previous.hardSentAt,
      downgradeScheduledFor: to === "hard" ? new Date(base + DEFAULT_REMINDER_POLICY.graceDaysBeforeDowngrade * DAY_MS).toISOString() : previous.downgradeScheduledFor,
      downgradedAt: to === "downgrade" ? nowIso : previous.downgradedAt,
      updatedBy: actor,
    };
    rows = current.map((row) => (row.tenantId === tenantId ? next : row));
    return next;
  },
};

let repository: ReminderRepository = memoryRepository;

export function setReminderRepository(next: ReminderRepository): void {
  repository = next;
}

export function resetReminderRepository(): void {
  repository = memoryRepository;
  rows = null;
}

export function reminders(): ReminderRepository {
  return repository;
}

export function isReminderAdvance(value: string): value is ReminderAdvance {
  return value === "gentle" || value === "hard" || value === "downgrade";
}

export interface ExpiryContext {
  readonly tenantId: string;
  readonly status: string;
  readonly expiresOn: string;
}

export interface ReminderDue {
  readonly tenantId: string;
  readonly stage: ReminderStage;
  readonly daysPastExpiry: number;
  readonly nextAdvance: ReminderAdvance | null;
  readonly reason: string;
}

/**
 * Which reminder a tenant owes, from the expiry date and the stage alone. Pure,
 * so the engine can call it from its scheduler and get the same answer the
 * console renders.
 */
export function reminderDue(expiry: ExpiryContext, stage: ReminderStage, nowIso: string): ReminderDue {
  const expiryAt = Date.parse(`${expiry.expiresOn}T00:00:00.000Z`);
  const today = Date.parse(`${nowIso.slice(0, 10)}T00:00:00.000Z`);
  const daysPastExpiry = Number.isFinite(expiryAt) && Number.isFinite(today) ? Math.round((today - expiryAt) / DAY_MS) : 0;

  const terminal = stage === "downgraded" || expiry.status === "cancelled" || expiry.status === "trialing";
  if (terminal) {
    return { tenantId: expiry.tenantId, stage, daysPastExpiry, nextAdvance: null, reason: "Not on the reminder ladder" };
  }
  if (daysPastExpiry < DEFAULT_REMINDER_POLICY.gentleAfterDays) {
    return {
      tenantId: expiry.tenantId,
      stage,
      daysPastExpiry,
      nextAdvance: null,
      reason: `Not due. The gentle reminder is ${DEFAULT_REMINDER_POLICY.gentleAfterDays} days after expiry`,
    };
  }
  if (stage === "none") {
    return { tenantId: expiry.tenantId, stage, daysPastExpiry, nextAdvance: "gentle", reason: "Past the gentle reminder window" };
  }
  if (stage === "gentle-sent" && daysPastExpiry < DEFAULT_REMINDER_POLICY.hardAfterDays) {
    const wait = DEFAULT_REMINDER_POLICY.hardAfterDays - daysPastExpiry;
    return {
      tenantId: expiry.tenantId,
      stage,
      daysPastExpiry,
      nextAdvance: null,
      reason: `Waiting on the hard reminder for ${wait} more day${wait === 1 ? "" : "s"}`,
    };
  }
  if (stage === "gentle-sent") {
    return { tenantId: expiry.tenantId, stage, daysPastExpiry, nextAdvance: "hard", reason: "Past the hard reminder window, one hard reminder is allowed" };
  }
  if (stage === "hard-sent") {
    return {
      tenantId: expiry.tenantId,
      stage,
      daysPastExpiry,
      nextAdvance: "downgrade",
      reason: `Hard reminder sent. Downgrade is due after ${DEFAULT_REMINDER_POLICY.graceDaysBeforeDowngrade} days of grace`,
    };
  }
  return { tenantId: expiry.tenantId, stage, daysPastExpiry, nextAdvance: null, reason: "No further step" };
}