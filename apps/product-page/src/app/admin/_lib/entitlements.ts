// Implements: docs/design/overhaul-plan.md §4.2 — "Entitlements + infrastructure
// access: feature flags and backend grants (db provisioned, export allowed,
// storage quota). Infrastructure only."
//
// Owner rule 3 is the whole point of this file: admin switches whether the
// backend will serve a tenant, never what is in the tenant's database. There is
// no accessor on this port that can return a student, a ledger row, or a fee.
//
// Admin-console entitlements and the tenant's own `settings.plan` are the same
// decision seen from two sides. `settings.plan` is server-managed and
// denylisted in the web app, so this console is the only place it is written.

import type { BooleanGrant, FeatureFlag, NumericGrant } from "./types.ts";
import { BOOLEAN_GRANTS, FEATURE_FLAGS } from "./types.ts";
import { AdminRecordNotFound } from "./subscriptions.ts";

export interface InfrastructureGrants {
  readonly dbProvisioned: boolean;
  readonly exportAllowed: boolean;
  readonly backgroundJobsEnabled: boolean;
  readonly storageQuotaMb: number;
  readonly apiRateLimitPerMin: number;
}

export interface TenantEntitlements {
  readonly tenantId: string;
  readonly flags: Readonly<Record<FeatureFlag, boolean>>;
  readonly infrastructure: InfrastructureGrants;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface EntitlementRepository {
  list(nowIso: string): Promise<readonly TenantEntitlements[]>;
  get(tenantId: string): Promise<TenantEntitlements | null>;
  setFlag(tenantId: string, flag: FeatureFlag, enabled: boolean, actor: string): Promise<TenantEntitlements>;
  setGrant(tenantId: string, grant: BooleanGrant | NumericGrant, value: boolean | number, actor: string): Promise<TenantEntitlements>;
}

const ALL_ON: Readonly<Record<FeatureFlag, boolean>> = {
  "web-app": true,
  "android-app": false,
  "ios-app": false,
  "macos-app": false,
  "windows-app": false,
  "priority-support": false,
};

function flags(overrides: Partial<Record<FeatureFlag, boolean>>): Readonly<Record<FeatureFlag, boolean>> {
  return { ...ALL_ON, ...overrides };
}

function grants(overrides: Partial<InfrastructureGrants>): InfrastructureGrants {
  return {
    dbProvisioned: true,
    exportAllowed: true,
    backgroundJobsEnabled: true,
    storageQuotaMb: 2048,
    apiRateLimitPerMin: 600,
    ...overrides,
  };
}

function seedRows(nowIso: string): TenantEntitlements[] {
  const at = (minutesAgo: number): string => new Date(Date.parse(nowIso) - minutesAgo * 60_000).toISOString();
  return [
    {
      tenantId: "t-0001",
      flags: flags({}),
      infrastructure: grants({}),
      updatedAt: at(4200),
      updatedBy: "ops@buddysaradhi.app",
    },
    {
      tenantId: "t-0002",
      flags: flags({ "android-app": true }),
      infrastructure: grants({ storageQuotaMb: 5120 }),
      updatedAt: at(2600),
      updatedBy: "ops@buddysaradhi.app",
    },
    {
      tenantId: "t-0003",
      // Past due: access to background jobs already withdrawn by the engine.
      flags: flags({ "android-app": true }),
      infrastructure: grants({ backgroundJobsEnabled: false, storageQuotaMb: 2048 }),
      updatedAt: at(310),
      updatedBy: "ops@buddysaradhi.app",
    },
    {
      tenantId: "t-0004",
      flags: flags({ "priority-support": true }),
      infrastructure: grants({}),
      updatedAt: at(190),
      updatedBy: "ops@buddysaradhi.app",
    },
    {
      tenantId: "t-0005",
      flags: flags({ "android-app": true, "ios-app": true, "macos-app": true, "windows-app": true, "priority-support": true }),
      infrastructure: grants({ storageQuotaMb: 20480, apiRateLimitPerMin: 2400 }),
      updatedAt: at(880),
      updatedBy: "ops@buddysaradhi.app",
    },
    {
      tenantId: "t-0006",
      // Downgraded to free: single surface, no export.
      flags: flags({}),
      infrastructure: grants({ backgroundJobsEnabled: false, exportAllowed: false, storageQuotaMb: 512 }),
      updatedAt: at(150),
      updatedBy: "ops@buddysaradhi.app",
    },
    {
      tenantId: "t-0007",
      flags: flags({ "android-app": true, "ios-app": true, "priority-support": true }),
      infrastructure: grants({ storageQuotaMb: 20480, apiRateLimitPerMin: 2400 }),
      updatedAt: at(60),
      updatedBy: "ops@buddysaradhi.app",
    },
    {
      tenantId: "t-0008",
      flags: flags({ "android-app": true }),
      infrastructure: grants({ storageQuotaMb: 2048 }),
      updatedAt: at(20),
      updatedBy: "ops@buddysaradhi.app",
    },
  ];
}

let rows: readonly TenantEntitlements[] | null = null;

function store(nowIso: string): readonly TenantEntitlements[] {
  if (rows === null) rows = seedRows(nowIso);
  return rows;
}

function write(next: readonly TenantEntitlements[]): void {
  rows = next;
}

const memoryRepository: EntitlementRepository = {
  async list(nowIso) {
    return [...store(nowIso)].sort((a, b) => a.tenantId.localeCompare(b.tenantId));
  },

  async get(tenantId) {
    return store(new Date().toISOString()).find((row) => row.tenantId === tenantId) ?? null;
  },

  async setFlag(tenantId, flag, enabled, actor) {
    const nowIso = new Date().toISOString();
    const current = store(nowIso);
    const previous = current.find((row) => row.tenantId === tenantId);
    if (previous === undefined) throw new AdminRecordNotFound(`No entitlements for ${tenantId}.`);
    const next: TenantEntitlements = {
      ...previous,
      flags: { ...previous.flags, [flag]: enabled },
      updatedAt: nowIso,
      updatedBy: actor,
    };
    write(current.map((row) => (row.tenantId === tenantId ? next : row)));
    return next;
  },

  async setGrant(tenantId, grant, value, actor) {
    const nowIso = new Date().toISOString();
    const current = store(nowIso);
    const previous = current.find((row) => row.tenantId === tenantId);
    if (previous === undefined) throw new AdminRecordNotFound(`No entitlements for ${tenantId}.`);
    const next: TenantEntitlements = {
      ...previous,
      infrastructure: { ...previous.infrastructure, [grant]: value },
      updatedAt: nowIso,
      updatedBy: actor,
    };
    write(current.map((row) => (row.tenantId === tenantId ? next : row)));
    return next;
  },
};

let repository: EntitlementRepository = memoryRepository;

export function setEntitlementRepository(next: EntitlementRepository): void {
  repository = next;
}

export function resetEntitlementRepository(): void {
  repository = memoryRepository;
  rows = null;
}

export function entitlements(): EntitlementRepository {
  return repository;
}

export function isFeatureFlag(value: string): value is FeatureFlag {
  return (FEATURE_FLAGS as readonly string[]).includes(value);
}

export function isBooleanGrant(value: string): value is BooleanGrant {
  return (BOOLEAN_GRANTS as readonly string[]).includes(value);
}

/** Reads one grant off a row so an action can record the before value. */
export function readGrant(row: TenantEntitlements, grant: BooleanGrant | NumericGrant): boolean | number {
  return row.infrastructure[grant];
}

/** A grant an admin cannot switch off without stranding the tenant's data. */
export function isIrreversibleGrant(grant: BooleanGrant): boolean {
  return grant === "dbProvisioned";
}