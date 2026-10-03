// Implements: docs/design/overhaul-plan.md §4.2 — the subscription list and the
// admin-managed contract record. Prepaid only, contracted manually, no payment
// processing anywhere in this product.
//
// METADATA ONLY (plan §4.2 and the owner's rule 3): every field on this record
// is contract metadata. Nothing here is read out of a tenant's database, and
// there is no repository method that could return one. `instituteLabel` is the
// label the tenant typed into the access request on the product page, which the
// tenant disclosed to the admin; it is not tenant content and is never sourced
// from the app.
//
// Rule 1: no ledger accessor exists here. Rule 2: no outbound call. Rule 6: no
// money is modelled, so there are no paise types to get wrong.

import type { BillingPeriod, PlanId, SubscriptionStatus } from "./types";
import { PLAN_IDS, BILLING_PERIODS, SUBSCRIPTION_STATUSES, SUBSCRIPTION_STATUS_LABEL } from "./types";

/** Thrown when a repository is asked for a row that is not there. Rule 9. */
export class AdminRecordNotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminRecordNotFound";
  }
}

export interface TenantSubscription {
  readonly tenantId: string;
  readonly contactEmail: string;
  /** The name the tenant gave in the access request. Contract metadata. */
  readonly instituteLabel: string;
  readonly plan: PlanId;
  readonly period: BillingPeriod;
  readonly status: SubscriptionStatus;
  readonly startsOn: string;
  readonly expiresOn: string;
  /** Admin email that contracted this subscription. */
  readonly contractedBy: string;
  /** Free-form operational note written by an admin. Never tenant data. */
  readonly adminNote: string;
}

export interface SubscriptionFilter {
  readonly plan?: PlanId;
  readonly period?: BillingPeriod;
  readonly status?: SubscriptionStatus;
  readonly query?: string;
  /** Only rows whose expiry falls within this many days, or already past. */
  readonly expiringWithinDays?: number;
}

export interface SubscriptionPatch {
  readonly plan?: PlanId;
  readonly period?: BillingPeriod;
  readonly status?: SubscriptionStatus;
  readonly startsOn?: string;
  readonly expiresOn?: string;
  readonly adminNote?: string;
}

/**
 * The port the entitlement backend implements. The console only ever calls these
 * four methods, so a real store drops in without touching a page.
 */
export interface SubscriptionRepository {
  list(filter: SubscriptionFilter, nowIso: string): Promise<readonly TenantSubscription[]>;
  get(tenantId: string): Promise<TenantSubscription | null>;
  apply(tenantId: string, patch: SubscriptionPatch, actor: string): Promise<TenantSubscription>;
}

const DAY_MS = 86_400_000;

function isoDaysFromNow(nowIso: string, days: number): string {
  const base = Date.parse(nowIso);
  if (!Number.isFinite(base)) throw new TypeError(`SEED_DATE_INVALID: ${nowIso}`);
  return new Date(base + days * DAY_MS).toISOString().slice(0, 10);
}

function seedRows(nowIso: string): TenantSubscription[] {
  return [
    {
      tenantId: "t-0001",
      contactEmail: "riya.deshmukh@example.in",
      instituteLabel: "Deshmukh Classes",
      plan: "solo",
      period: "annual",
      status: "active",
      startsOn: isoDaysFromNow(nowIso, -320),
      expiresOn: isoDaysFromNow(nowIso, 45),
      contractedBy: "ops@buddysaradhi.app",
      adminNote: "Annual prepaid, agreed by phone.",
    },
    {
      tenantId: "t-0002",
      contactEmail: "kabir.mehta@example.in",
      instituteLabel: "Mehta Academy",
      plan: "batch",
      period: "quarterly",
      status: "active",
      startsOn: isoDaysFromNow(nowIso, -70),
      expiresOn: isoDaysFromNow(nowIso, 21),
      contractedBy: "ops@buddysaradhi.app",
      adminNote: "Runs three batches on weekdays.",
    },
    {
      tenantId: "t-0003",
      contactEmail: "menon.tuition@example.in",
      instituteLabel: "Menon Tuition",
      plan: "solo",
      period: "monthly",
      status: "past-due",
      startsOn: isoDaysFromNow(nowIso, -70),
      expiresOn: isoDaysFromNow(nowIso, -40),
      contractedBy: "ops@buddysaradhi.app",
      adminNote: "Hard reminder already sent. Awaiting the export window.",
    },
    {
      tenantId: "t-0004",
      contactEmail: "fatima.sheikh@example.in",
      instituteLabel: "Sheikh Learning Circle",
      plan: "batch",
      period: "monthly",
      status: "trialing",
      startsOn: isoDaysFromNow(nowIso, -6),
      expiresOn: isoDaysFromNow(nowIso, 24),
      contractedBy: "ops@buddysaradhi.app",
      adminNote: "First prepaid month collected offline.",
    },
    {
      tenantId: "t-0005",
      contactEmail: "arjun.nair@example.in",
      instituteLabel: "Nair Coaching Point",
      plan: "institute",
      period: "annual",
      status: "active",
      startsOn: isoDaysFromNow(nowIso, -140),
      expiresOn: isoDaysFromNow(nowIso, 225),
      contractedBy: "ops@buddysaradhi.app",
      adminNote: "Largest contract so far, referred by a tutor.",
    },
    {
      tenantId: "t-0006",
      contactEmail: "sunita.rao@example.in",
      instituteLabel: "Rao Maths Hub",
      plan: "solo",
      period: "quarterly",
      status: "cancelled",
      startsOn: isoDaysFromNow(nowIso, -200),
      expiresOn: isoDaysFromNow(nowIso, -109),
      contractedBy: "ops@buddysaradhi.app",
      adminNote: "Moved out of town. Downgraded, archive mailed.",
    },
    {
      tenantId: "t-0007",
      contactEmail: "imran.qureshi@example.in",
      instituteLabel: "Qureshi Institute",
      plan: "institute",
      period: "annual",
      status: "active",
      startsOn: isoDaysFromNow(nowIso, -20),
      expiresOn: isoDaysFromNow(nowIso, 345),
      contractedBy: "ops@buddysaradhi.app",
      adminNote: "Upgraded from batch in September.",
    },
    {
      tenantId: "t-0008",
      contactEmail: "lakshmi.reddy@example.in",
      instituteLabel: "Reddy Junior Academy",
      plan: "solo",
      period: "monthly",
      status: "active",
      startsOn: isoDaysFromNow(nowIso, -12),
      expiresOn: isoDaysFromNow(nowIso, 18),
      contractedBy: "ops@buddysaradhi.app",
      adminNote: "Requested Android as well as web.",
    },
  ];
}

let rows: readonly TenantSubscription[] | null = null;

function store(nowIso: string): readonly TenantSubscription[] {
  if (rows === null) rows = seedRows(nowIso);
  return rows;
}

function daysUntil(isoDate: string, nowIso: string): number {
  const target = Date.parse(`${isoDate}T00:00:00.000Z`);
  const base = Date.parse(`${nowIso.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(target) || !Number.isFinite(base)) return Number.POSITIVE_INFINITY;
  return Math.round((target - base) / DAY_MS);
}

function matchesQuery(row: TenantSubscription, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return (
    row.tenantId.toLowerCase().includes(needle) ||
    row.contactEmail.toLowerCase().includes(needle) ||
    row.instituteLabel.toLowerCase().includes(needle)
  );
}

const memoryRepository: SubscriptionRepository = {
  async list(filter, nowIso) {
    const all = store(nowIso);
    const matched = all.filter((row) => {
      if (filter.plan !== undefined && row.plan !== filter.plan) return false;
      if (filter.period !== undefined && row.period !== filter.period) return false;
      if (filter.status !== undefined && row.status !== filter.status) return false;
      if (filter.query !== undefined && !matchesQuery(row, filter.query)) return false;
      if (filter.expiringWithinDays !== undefined) {
        const remaining = daysUntil(row.expiresOn, nowIso);
        if (remaining > filter.expiringWithinDays) return false;
      }
      return true;
    });
    // Soonest expiry first, then tenant id, so the ordering is stable and the
    // work an admin came to do sits at the top.
    return [...matched].sort((a, b) => {
      const byDate = a.expiresOn.localeCompare(b.expiresOn);
      return byDate !== 0 ? byDate : a.tenantId.localeCompare(b.tenantId);
    });
  },

  async get(tenantId) {
    return store(new Date().toISOString()).find((row) => row.tenantId === tenantId) ?? null;
  },

  async apply(tenantId, patch, actor) {
    const nowIso = new Date().toISOString();
    const current = store(nowIso);
    const previous = current.find((row) => row.tenantId === tenantId);
    if (previous === undefined) throw new AdminRecordNotFound(`No subscription for ${tenantId}.`);
    const next: TenantSubscription = {
      ...previous,
      plan: patch.plan ?? previous.plan,
      period: patch.period ?? previous.period,
      status: patch.status ?? previous.status,
      startsOn: patch.startsOn ?? previous.startsOn,
      expiresOn: patch.expiresOn ?? previous.expiresOn,
      adminNote: patch.adminNote ?? previous.adminNote,
      contractedBy: actor,
    };
    rows = current.map((row) => (row.tenantId === tenantId ? next : row));
    return next;
  },
};

let repository: SubscriptionRepository = memoryRepository;

export function setSubscriptionRepository(next: SubscriptionRepository): void {
  repository = next;
}

export function resetSubscriptionRepository(): void {
  repository = memoryRepository;
  rows = null;
}

export function subscriptions(): SubscriptionRepository {
  return repository;
}

export function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value);
}

export function isBillingPeriod(value: string): value is BillingPeriod {
  return (BILLING_PERIODS as readonly string[]).includes(value);
}

export function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

/** Days left on the contract. Negative means already past the expiry date. */
export function remainingDays(row: TenantSubscription, nowIso: string): number {
  return daysUntil(row.expiresOn, nowIso);
}

/** Human sentence for a status cell, so colour is never the only signal. */
export function subscriptionStatusSentence(row: TenantSubscription, nowIso: string): string {
  const label = SUBSCRIPTION_STATUS_LABEL[row.status];
  const remaining = remainingDays(row, nowIso);
  if (row.status === "cancelled") return `${label}, no access`;
  if (remaining < 0) return `${label}, expired ${Math.abs(remaining)} days ago`;
  if (remaining === 0) return `${label}, expires today`;
  return `${label}, ${remaining} days left`;
}