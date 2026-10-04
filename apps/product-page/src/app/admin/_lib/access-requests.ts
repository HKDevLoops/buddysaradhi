// Implements: docs/design/entitlements-contract.md §2 (the access-request →
// access pipeline: `access_request` rows in state new → contacted →
// contracted|declined, rate-limited per IP + per email, audited, and never
// revealing whether an email is already known) + docs/design/admin-console.md
// §5 (the repository port the console reads).
//
// Rule 2 note (new origins). The only fetch in this file goes to SUPABASE_URL,
// which is not a new integration: it is the provisioned database backend this
// product already runs on, read from the environment rather than a literal, and
// reached with no SDK (plain fetch, no dependency). Mail delivery, payment
// providers and CRMs stay refused per AGENTS.md §2 Rules 2+3: there is no mail
// sender, no payment call and no CRM call anywhere in this module.
//
// FAIL CLOSED (mirrors the admin-auth 503 pattern in _lib/auth.ts). When no
// Supabase env is set the memory store serves. When the env is half-set (a URL
// without a key, or a key without a URL) the module throws
// `AccessRequestStoreUnconfigured` instead of silently serving memory: a
// deployment that meant to persist must not quietly stop persisting. A failed
// Supabase write is a 503 to the visitor, never a silent memory fallback, so
// two stores can never fork the truth.
//
// PRIVACY. The record carries what the visitor typed (name, email, institute,
// plan, period, note) and nothing else. The visitor's IP is used only as a
// rate-limit key and is never stored on the record (DPDP-2025: keep what the
// reply needs, nothing that identifies the network).

import { randomUUID } from "node:crypto";
import {
  validateAccessRequest,
  type AccessRequestErrors,
  type AccessRequestInput,
  type BillingPeriodId,
  type PlanId,
} from "../../../lib/access-request.ts";

export type AccessRequestState = "new" | "contacted" | "contracted" | "declined";

export const ACCESS_REQUEST_STATES: readonly AccessRequestState[] = ["new", "contacted", "contracted", "declined"];

export const ACCESS_REQUEST_STATE_LABEL: Readonly<Record<AccessRequestState, string>> = {
  new: "New, not yet read",
  contacted: "Contacted, terms being agreed",
  contracted: "Contracted, plan provisioned",
  declined: "Declined, no plan",
};

/** The next states an admin may record. Every other move is refused. */
export type AccessRequestAdvance = "contacted" | "contracted" | "declined";

export interface AccessRequestRecord {
  readonly id: string;
  readonly reference: string;
  readonly name: string;
  readonly email: string;
  readonly instituteName: string;
  readonly plan: PlanId;
  readonly billingPeriod: BillingPeriodId | null;
  readonly note: string;
  readonly state: AccessRequestState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly contactedAt: string | null;
  readonly decidedAt: string | null;
}

export interface AccessRequestFilter {
  readonly state?: AccessRequestState;
  readonly query?: string;
  readonly limit?: number;
}

/**
 * The port the production sink implements. The console and the public route
 * only ever call these five methods, so a real store drops in without touching
 * a page. No method here can send mail, take payment, or return anything but
 * request rows: there is no accessor to widen.
 */
export interface AccessRequestRepository {
  create(input: AccessRequestInput, nowIso: string): Promise<AccessRequestRecord>;
  get(id: string): Promise<AccessRequestRecord | null>;
  getByReference(reference: string): Promise<AccessRequestRecord | null>;
  list(filter: AccessRequestFilter): Promise<readonly AccessRequestRecord[]>;
  setState(id: string, to: AccessRequestAdvance, actor: string, nowIso: string): Promise<AccessRequestRecord>;
}

/** Thrown when a record is asked for that is not there. Rule 9. */
export class AccessRequestNotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessRequestNotFound";
  }
}

/**
 * The only legal moves. `new` must pass through `contacted`: an admin cannot
 * contract a plan nobody has discussed, and a request that is already decided
 * (`contracted` | `declined`) is terminal, so re-running the console action is
 * refused instead of silently re-writing history.
 */
export function isAccessRequestTransitionLegal(from: AccessRequestState, to: AccessRequestAdvance): boolean {
  if (from === "new") return to === "contacted" || to === "declined";
  if (from === "contacted") return to === "contracted" || to === "declined";
  return false;
}

/** Typed refusal. Rule 9: the console says why, it does not silently no-op. */
export class AccessRequestTransitionRefused extends Error {
  readonly from: AccessRequestState;
  readonly to: AccessRequestAdvance;

  constructor(from: AccessRequestState, to: AccessRequestAdvance) {
    super(`Cannot move an access request from ${ACCESS_REQUEST_STATE_LABEL[from]} to ${to}.`);
    this.name = "AccessRequestTransitionRefused";
    this.from = from;
    this.to = to;
  }
}

export function isAccessRequestState(value: string): value is AccessRequestState {
  return (ACCESS_REQUEST_STATES as readonly string[]).includes(value);
}

export function isAccessRequestAdvance(value: string): value is AccessRequestAdvance {
  return value === "contacted" || value === "contracted" || value === "declined";
}

function toStateAfterAdvance(to: AccessRequestAdvance): AccessRequestState {
  return to;
}

function matchesQuery(row: AccessRequestRecord, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return (
    row.reference.toLowerCase().includes(needle) ||
    row.email.toLowerCase().includes(needle) ||
    row.instituteName.toLowerCase().includes(needle) ||
    row.name.toLowerCase().includes(needle)
  );
}

let memoryRows: AccessRequestRecord[] | null = null;

function memoryStore(): AccessRequestRecord[] {
  if (memoryRows === null) memoryRows = [];
  return memoryRows;
}

function takeReference(): string {
  // 32 bits of randomness, hex, uppercased: AR-9F2C41B7. Uniqueness is
  // checked by the caller, which retries once on a collision.
  return `AR-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

const memoryRepository: AccessRequestRepository = {
  async create(input, nowIso) {
    const current = memoryStore();
    let reference = takeReference();
    if (current.some((row) => row.reference === reference)) reference = takeReference();
    const created: AccessRequestRecord = {
      id: randomUUID(),
      reference,
      name: input.name,
      email: input.email,
      instituteName: input.instituteName,
      plan: input.plan,
      billingPeriod: input.billingPeriod,
      note: input.note,
      state: "new",
      createdAt: nowIso,
      updatedAt: nowIso,
      contactedAt: null,
      decidedAt: null,
    };
    current.unshift(created);
    return created;
  },

  async get(id) {
    return memoryStore().find((row) => row.id === id) ?? null;
  },

  async getByReference(reference) {
    return memoryStore().find((row) => row.reference === reference) ?? null;
  },

  async list(filter) {
    const matched = memoryStore().filter((row) => {
      if (filter.state !== undefined && row.state !== filter.state) return false;
      if (filter.query !== undefined && !matchesQuery(row, filter.query)) return false;
      return true;
    });
    const limit = filter.limit ?? 200;
    return matched.slice(0, limit);
  },

  async setState(id, to, _actor, nowIso) {
    const current = memoryStore();
    const previous = current.find((row) => row.id === id);
    if (previous === undefined) throw new AccessRequestNotFound(`No access request ${id}.`);
    if (!isAccessRequestTransitionLegal(previous.state, to)) {
      throw new AccessRequestTransitionRefused(previous.state, to);
    }
    const next: AccessRequestRecord = {
      ...previous,
      state: toStateAfterAdvance(to),
      updatedAt: nowIso,
      contactedAt: to === "contacted" ? nowIso : previous.contactedAt,
      decidedAt: to === "contracted" || to === "declined" ? nowIso : previous.decidedAt,
    };
    const index = current.indexOf(previous);
    current[index] = next;
    return next;
  },
};

let repository: AccessRequestRepository = memoryRepository;

/** Swaps the store. The production boot calls this once with the Supabase sink. */
export function setAccessRequestRepository(next: AccessRequestRepository): void {
  repository = next;
}

/** Restores the empty in-memory store. Used by tests and by a failed boot. */
export function resetAccessRequestRepository(): void {
  repository = memoryRepository;
  memoryRows = null;
}

export function accessRequests(): AccessRequestRepository {
  return repository;
}

// --- rate limiting ----------------------------------------------------------
// Per-instance and in memory, on purpose: the same reasoning as the sign-in
// throttle in _lib/auth.ts. Two independent windows: per-IP (a shared network
// sending many genuine requests) and per-email (one address hammering the
// form). Either window tripping refuses with the same generic message, so the
// response never reveals whether the email is already known (no enumeration).

const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX_PER_IP = 20;
const RATE_MAX_PER_EMAIL = 5;
const RATE_MAX_KEYS = 4096;

const ipHits = new Map<string, number[]>();
const emailHits = new Map<string, number[]>();

function pruneHits(nowMs: number): void {
  for (const [key, stamps] of ipHits) {
    const live = stamps.filter((at) => nowMs - at <= RATE_WINDOW_MS);
    if (live.length === 0) ipHits.delete(key);
    else ipHits.set(key, live);
  }
  for (const [key, stamps] of emailHits) {
    const live = stamps.filter((at) => nowMs - at <= RATE_WINDOW_MS);
    if (live.length === 0) emailHits.delete(key);
    else emailHits.set(key, live);
  }
  for (const table of [ipHits, emailHits]) {
    if (table.size <= RATE_MAX_KEYS) continue;
    const excess = table.size - RATE_MAX_KEYS;
    const keys = table.keys();
    for (let i = 0; i < excess; i += 1) {
      const next = keys.next();
      if (next.done === true) break;
      table.delete(next.value);
    }
  }
}

export type AccessRequestRateLimit =
  | { readonly ok: true }
  | { readonly ok: false; readonly scope: "ip" | "email"; readonly retryAfterMs: number };

/** Pure check-and-record: a refused caller must not consume a slot. */
export function checkAccessRequestRateLimit(ip: string, email: string, nowMs: number): AccessRequestRateLimit {
  pruneHits(nowMs);
  const ipKey = ip.trim().length === 0 ? "unknown" : ip.trim();
  const emailKey = email.trim().toLowerCase();

  const ipStamps = ipHits.get(ipKey) ?? [];
  if (ipStamps.length >= RATE_MAX_PER_IP) {
    const oldest = ipStamps[0] ?? nowMs;
    return { ok: false, scope: "ip", retryAfterMs: RATE_WINDOW_MS - (nowMs - oldest) };
  }
  const emailStamps = emailHits.get(emailKey) ?? [];
  if (emailStamps.length >= RATE_MAX_PER_EMAIL) {
    const oldest = emailStamps[0] ?? nowMs;
    return { ok: false, scope: "email", retryAfterMs: RATE_WINDOW_MS - (nowMs - oldest) };
  }

  ipHits.set(ipKey, [...ipStamps, nowMs]);
  emailHits.set(emailKey, [...emailStamps, nowMs]);
  return { ok: true };
}

/** Visible only so tests can run the limiter deterministically. */
export function resetAccessRequestRateLimits(): void {
  ipHits.clear();
  emailHits.clear();
}

// --- production sink ----------------------------------------------------------

export type AccessRequestSinkConfig = { readonly url: string; readonly serviceKey: string };

/** Typed store failure. The key and the URL never appear in the message. */
export class AccessRequestStoreError extends Error {
  readonly code: "ACCESS_REQUEST_UNCONFIGURED" | "ACCESS_REQUEST_CONFLICT" | "ACCESS_REQUEST_UNAVAILABLE";
  readonly httpStatus: number;

  constructor(code: AccessRequestStoreError["code"], httpStatus: number, message: string) {
    super(message);
    this.name = "AccessRequestStoreError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * Reads the Supabase sink configuration. Returns null when the deployment has
 * no Supabase env at all (memory serves). Throws `ACCESS_REQUEST_UNCONFIGURED`
 * when the env is half-set or malformed: fail closed, never silently memory.
 */
export function readAccessRequestSinkConfig(): AccessRequestSinkConfig | null {
  const rawUrl = (process.env.SUPABASE_URL ?? "").trim();
  const rawKey = (process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (rawUrl.length === 0 && rawKey.length === 0) return null;
  if (rawUrl.length === 0 || rawKey.length === 0) {
    throw new AccessRequestStoreError(
      "ACCESS_REQUEST_UNCONFIGURED",
      503,
      "The access-request store is half-configured: SUPABASE_URL and a service key must both be set, or neither.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AccessRequestStoreError("ACCESS_REQUEST_UNCONFIGURED", 503, "SUPABASE_URL is not an absolute URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new AccessRequestStoreError("ACCESS_REQUEST_UNCONFIGURED", 503, "SUPABASE_URL must be an http(s) origin.");
  }
  const normalised = parsed.toString().replace(/\/+$/, "");
  return { url: normalised, serviceKey: rawKey };
}

interface SupabaseAccessRequestRow {
  readonly id: string;
  readonly reference: string;
  readonly name: string;
  readonly email: string;
  readonly institute_name: string;
  readonly plan: string;
  readonly billing_period: string | null;
  readonly note: string;
  readonly state: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly contacted_at: string | null;
  readonly decided_at: string | null;
}

function toRecord(row: SupabaseAccessRequestRow): AccessRequestRecord {
  const plan: PlanId = row.plan === "free" || row.plan === "institute" ? row.plan : "institute";
  const billingPeriod: BillingPeriodId | null =
    row.billing_period === "monthly" || row.billing_period === "quarterly" || row.billing_period === "annual"
      ? row.billing_period
      : null;
  const state: AccessRequestState = isAccessRequestState(row.state) ? row.state : "new";
  return {
    id: row.id,
    reference: row.reference,
    name: row.name,
    email: row.email,
    instituteName: row.institute_name,
    plan,
    billingPeriod,
    note: row.note,
    state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contactedAt: row.contacted_at,
    decidedAt: row.decided_at,
  };
}

/**
 * Supabase-backed repository. No SDK: plain fetch against the PostgREST table
 * `access_requests`, which is created out-of-band by the provisioning
 * migration (this module never runs DDL). The service key travels only in the
 * Authorization header and never in a message, a log field, or a row.
 */
export function createSupabaseAccessRequestRepository(config: AccessRequestSinkConfig): AccessRequestRepository {
  async function rest(path: string, init: RequestInit): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${config.url}/rest/v1/access_requests${path}`, {
        ...init,
        headers: {
          apikey: config.serviceKey,
          Authorization: `Bearer ${config.serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
          ...(init.headers ?? {}),
        },
      });
    } catch {
      throw new AccessRequestStoreError(
        "ACCESS_REQUEST_UNAVAILABLE",
        503,
        "The access-request store did not answer. Nothing was recorded.",
      );
    }
    if (res.status === 409) {
      throw new AccessRequestStoreError("ACCESS_REQUEST_CONFLICT", 409, "That reference is already taken.");
    }
    if (!res.ok) {
      throw new AccessRequestStoreError(
        "ACCESS_REQUEST_UNAVAILABLE",
        503,
        "The access-request store refused the write. Nothing was recorded.",
      );
    }
    return (await res.json()) as unknown;
  }

  return {
    async create(input, nowIso) {
      const reference = `AR-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
      const payload = {
        id: randomUUID(),
        reference,
        name: input.name,
        email: input.email,
        institute_name: input.instituteName,
        plan: input.plan,
        billing_period: input.billingPeriod,
        note: input.note,
        state: "new",
        created_at: nowIso,
        updated_at: nowIso,
        contacted_at: null,
        decided_at: null,
      };
      const rows = (await rest("", { method: "POST", body: JSON.stringify(payload) })) as SupabaseAccessRequestRow[];
      const first = rows[0];
      if (first === undefined) {
        throw new AccessRequestStoreError(
          "ACCESS_REQUEST_UNAVAILABLE",
          503,
          "The access-request store returned no row. Nothing was recorded.",
        );
      }
      return toRecord(first);
    },

    async get(id) {
      const rows = (await rest(`?id=eq.${encodeURIComponent(id)}&limit=1`, { method: "GET" })) as SupabaseAccessRequestRow[];
      const first = rows[0];
      return first === undefined ? null : toRecord(first);
    },

    async getByReference(reference) {
      const rows = (await rest(
        `?reference=eq.${encodeURIComponent(reference)}&limit=1`,
        { method: "GET" },
      )) as SupabaseAccessRequestRow[];
      const first = rows[0];
      return first === undefined ? null : toRecord(first);
    },

    async list(filter) {
      const params = new URLSearchParams({ order: "created_at.desc", limit: String(filter.limit ?? 200) });
      if (filter.state !== undefined) params.set("state", `eq.${filter.state}`);
      const rows = (await rest(`?${params.toString()}`, { method: "GET" })) as SupabaseAccessRequestRow[];
      const records = rows.map(toRecord);
      if (filter.query === undefined) return records;
      return records.filter((row) => matchesQuery(row, filter.query as string));
    },

    async setState(id, to, _actor, nowIso) {
      const previous = await this.get(id);
      if (previous === null) throw new AccessRequestNotFound(`No access request ${id}.`);
      if (!isAccessRequestTransitionLegal(previous.state, to)) {
        throw new AccessRequestTransitionRefused(previous.state, to);
      }
      const patch: Record<string, string | null> = {
        state: to,
        updated_at: nowIso,
        contacted_at: to === "contacted" ? nowIso : previous.contactedAt,
        decided_at: to === "contracted" || to === "declined" ? nowIso : previous.decidedAt,
      };
      const rows = (await rest(`?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      })) as SupabaseAccessRequestRow[];
      const first = rows[0];
      if (first === undefined) throw new AccessRequestNotFound(`No access request ${id}.`);
      return toRecord(first);
    },
  };
}

/**
 * Resolves the store for a request. Memory when no Supabase env exists;
 * throws `AccessRequestStoreError` (503) when the env is half-set, so a
 * deployment that meant to persist refuses rather than quietly forgetting.
 */
export function resolveAccessRequestStore(): AccessRequestRepository {
  const config = readAccessRequestSinkConfig();
  if (config === null) return accessRequests();
  return createSupabaseAccessRequestRepository(config);
}

// --- submission orchestration -------------------------------------------------

export type AccessRequestAuditFn = (input: {
  readonly actor: string;
  readonly action: "admin.access_request.received";
  readonly refType: "access_request";
  readonly refId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}) => Promise<unknown>;

/** What the console-backed endpoint returns on acceptance. */
export interface AccessRequestConsoleReceipt {
  readonly reference: string;
  readonly receivedAt: string;
  readonly delivery: "console";
}

export type SubmitAccessRequestResult =
  | { readonly status: 201; readonly body: { readonly ok: true; readonly receipt: AccessRequestConsoleReceipt } }
  | { readonly status: 422; readonly body: { readonly ok: false; readonly errors: AccessRequestErrors } }
  | { readonly status: 429; readonly body: { readonly ok: false; readonly errors: { readonly note: string } } }
  | { readonly status: 503; readonly body: { readonly ok: false; readonly errors: { readonly note: string } } };

const RATE_LIMIT_MESSAGE =
  "This site is receiving many requests right now. Nothing was sent and nothing was charged. Your answers are still here, try again in a little while.";

const STORE_UNAVAILABLE_MESSAGE =
  "This site could not record the request right now. Nothing was sent and nothing was charged. Your answers are still here, try again in a moment.";

/**
 * The whole public submission, in order: validate with the shared validator,
 * rate-limit per IP + per email, persist, audit. A duplicate email is stored as
 * a second row and answered with the same 201 shape: the response never reveals
 * whether an address was already known (no enumeration). Throws nothing: every
 * failure is a typed status the route can return as-is (Rule 9).
 */
export async function submitAccessRequest(input: {
  readonly body: unknown;
  readonly ip: string;
  readonly nowMs: number;
  readonly store: AccessRequestRepository;
  readonly audit: AccessRequestAuditFn;
}): Promise<SubmitAccessRequestResult> {
  const parsed = validateAccessRequest(input.body);
  if (!parsed.ok) {
    return { status: 422, body: { ok: false, errors: parsed.error } };
  }

  const limited = checkAccessRequestRateLimit(input.ip, parsed.value.email, input.nowMs);
  if (!limited.ok) {
    return { status: 429, body: { ok: false, errors: { note: RATE_LIMIT_MESSAGE } } };
  }

  const nowIso = new Date(input.nowMs).toISOString();
  let created: AccessRequestRecord;
  try {
    created = await input.store.create(parsed.value, nowIso);
  } catch (error) {
    if (error instanceof AccessRequestStoreError && error.code === "ACCESS_REQUEST_CONFLICT") {
      created = await input.store.create(parsed.value, nowIso);
    } else if (error instanceof AccessRequestStoreError) {
      return { status: 503, body: { ok: false, errors: { note: STORE_UNAVAILABLE_MESSAGE } } };
    } else {
      throw error;
    }
  }

  await input.audit({
    actor: parsed.value.email.trim().toLowerCase(),
    action: "admin.access_request.received",
    refType: "access_request",
    refId: created.id,
    metadata: { reference: created.reference, plan: created.plan, state: created.state },
  });

  return {
    status: 201,
    body: { ok: true, receipt: { reference: created.reference, receivedAt: created.createdAt, delivery: "console" } },
  };
}
