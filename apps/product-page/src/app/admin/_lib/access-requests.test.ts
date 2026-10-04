// Implements: docs/design/entitlements-contract.md §2 (access-request state
// machine, rate limit, no enumeration) + §6.3 (no enumeration) — contract
// tests. Runner: `node --test` (no dependency; see package.json `test`).

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  AccessRequestNotFound,
  AccessRequestStoreError,
  AccessRequestTransitionRefused,
  accessRequests,
  checkAccessRequestRateLimit,
  isAccessRequestTransitionLegal,
  readAccessRequestSinkConfig,
  resetAccessRequestRateLimits,
  resetAccessRequestRepository,
  resolveAccessRequestStore,
  submitAccessRequest,
} from "./access-requests.ts";

const NOW_MS = Date.parse("2026-10-04T12:00:00.000Z");

const BODY = {
  name: "Riya Deshmukh",
  email: "riya.deshmukh@example.in",
  instituteName: "Deshmukh Classes",
  plan: "institute",
  billingPeriod: "annual",
  note: "",
} as const;

interface CapturedAudit {
  readonly actor: string;
  readonly action: string;
  readonly refType: string;
  readonly refId: string;
}

beforeEach(() => {
  resetAccessRequestRepository();
  resetAccessRequestRateLimits();
});

async function submit(body: unknown, ip = "203.0.113.7", nowMs = NOW_MS): Promise<{
  readonly result: Awaited<ReturnType<typeof submitAccessRequest>>;
  readonly audits: CapturedAudit[];
}> {
  const audits: CapturedAudit[] = [];
  const result = await submitAccessRequest({
    body,
    ip,
    nowMs,
    store: accessRequests(),
    audit: async (input) => {
      audits.push({
        actor: input.actor,
        action: input.action,
        refType: input.refType,
        refId: input.refId,
      });
      return undefined;
    },
  });
  return { result, audits };
}

test("legal path new → contacted → contracted stamps ISO dates", async () => {
  const { result, audits } = await submit({ ...BODY });
  assert.equal(result.status, 201);
  assert.equal(result.body.ok, true);
  if (!result.body.ok) return;
  assert.match(result.body.receipt.reference, /^AR-[0-9A-F]{8}$/);
  assert.equal(result.body.receipt.delivery, "console");
  assert.ok(Number.isFinite(Date.parse(result.body.receipt.receivedAt)));

  const stored = await accessRequests().getByReference(result.body.receipt.reference);
  assert.ok(stored !== null);
  assert.equal(stored.state, "new");
  assert.equal(stored.contactedAt, null);

  const contacted = await accessRequests().setState(stored.id, "contacted", "ops@test", new Date(NOW_MS).toISOString());
  assert.equal(contacted.state, "contacted");
  assert.ok(Number.isFinite(Date.parse(contacted.contactedAt as string)));

  const contracted = await accessRequests().setState(stored.id, "contracted", "ops@test", new Date(NOW_MS).toISOString());
  assert.equal(contracted.state, "contracted");
  assert.ok(Number.isFinite(Date.parse(contracted.decidedAt as string)));

  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.action, "admin.access_request.received");
});

test("new → declined is legal; decided rows are terminal", async () => {
  const { result } = await submit({ ...BODY, email: "decline@example.in" });
  assert.equal(result.status, 201);
  if (!result.body.ok) return;
  const stored = await accessRequests().getByReference(result.body.receipt.reference);
  assert.ok(stored !== null);

  const declined = await accessRequests().setState(stored.id, "declined", "ops@test", new Date(NOW_MS).toISOString());
  assert.equal(declined.state, "declined");

  await assert.rejects(
    accessRequests().setState(stored.id, "contacted", "ops@test", new Date(NOW_MS).toISOString()),
    (error: unknown) => error instanceof AccessRequestTransitionRefused,
  );
});

test("illegal transitions are refused, never silently kept", async () => {
  assert.equal(isAccessRequestTransitionLegal("new", "contacted"), true);
  assert.equal(isAccessRequestTransitionLegal("new", "declined"), true);
  assert.equal(isAccessRequestTransitionLegal("new", "contracted"), false);
  assert.equal(isAccessRequestTransitionLegal("contacted", "contracted"), true);
  assert.equal(isAccessRequestTransitionLegal("contacted", "declined"), true);
  assert.equal(isAccessRequestTransitionLegal("contacted", "contacted"), false);
  assert.equal(isAccessRequestTransitionLegal("contracted", "declined"), false);
  assert.equal(isAccessRequestTransitionLegal("declined", "contacted"), false);

  const { result } = await submit({ ...BODY, email: "refused@example.in" });
  assert.equal(result.status, 201);
  if (!result.body.ok) return;
  const stored = await accessRequests().getByReference(result.body.receipt.reference);
  assert.ok(stored !== null);
  await assert.rejects(
    accessRequests().setState(stored.id, "contracted", "ops@test", new Date(NOW_MS).toISOString()),
    (error: unknown) => error instanceof AccessRequestTransitionRefused,
  );
  await assert.rejects(
    accessRequests().setState("missing-id", "contacted", "ops@test", new Date(NOW_MS).toISOString()),
    (error: unknown) => error instanceof AccessRequestNotFound,
  );
});

test("rate limit trips per email, then per IP, with a typed refusal", () => {
  for (let i = 0; i < 5; i += 1) {
    assert.equal(checkAccessRequestRateLimit("203.0.113.9", "limited@example.in", NOW_MS + i).ok, true);
  }
  const sixth = checkAccessRequestRateLimit("203.0.113.9", "limited@example.in", NOW_MS + 5);
  assert.equal(sixth.ok, false);
  if (sixth.ok) return;
  assert.equal(sixth.scope, "email");

  // A fresh address on a fresh IP is unaffected by another address's window.
  assert.equal(checkAccessRequestRateLimit("203.0.113.10", "fresh@example.in", NOW_MS).ok, true);

  for (let i = 0; i < 20; i += 1) {
    assert.equal(checkAccessRequestRateLimit("203.0.113.11", `user${i}@example.in`, NOW_MS + i).ok, true);
  }
  const over = checkAccessRequestRateLimit("203.0.113.11", "user21@example.in", NOW_MS + 20);
  assert.equal(over.ok, false);
  if (over.ok) return;
  assert.equal(over.scope, "ip");
});

test("the route answers 429 with a generic note that names no address", async () => {
  for (let i = 0; i < 5; i += 1) {
    const attempt = await submit({ ...BODY, email: "throttled@example.in" }, "203.0.113.12", NOW_MS + i);
    assert.equal(attempt.result.status, 201);
  }
  const { result, audits } = await submit({ ...BODY, email: "throttled@example.in" }, "203.0.113.12", NOW_MS + 5);
  assert.equal(result.status, 429);
  assert.equal(result.body.ok, false);
  if (result.body.ok) return;
  assert.ok(!result.body.errors.note.includes("throttled@example.in"));
  assert.equal(audits.length, 0);
});

test("no enumeration: a duplicate email is a second 201 row, same shape", async () => {
  const first = await submit({ ...BODY });
  const second = await submit({ ...BODY });
  assert.equal(first.result.status, 201);
  assert.equal(second.result.status, 201);
  assert.equal(first.result.body.ok, true);
  assert.equal(second.result.body.ok, true);
  if (!first.result.body.ok || !second.result.body.ok) return;
  assert.notEqual(first.result.body.receipt.reference, second.result.body.receipt.reference);

  const rows = await accessRequests().list({});
  assert.equal(rows.filter((row) => row.email === BODY.email).length, 2);
  assert.equal(first.audits.length + second.audits.length, 2);
});

test("invalid input is a 422 with field errors, and writes nothing", async () => {
  const { result, audits } = await submit({ ...BODY, email: "not-an-email", plan: "corner-shop" });
  assert.equal(result.status, 422);
  assert.equal(result.body.ok, false);
  if (result.body.ok) return;
  assert.ok(typeof result.body.errors.email === "string");
  assert.ok(typeof result.body.errors.plan === "string");
  assert.equal(audits.length, 0);
  assert.equal((await accessRequests().list({})).length, 0);
});

test("a half-configured Supabase env fails closed instead of silently memory", () => {
  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_SERVICE_KEY;
  const savedRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal(readAccessRequestSinkConfig(), null);
    assert.equal(resolveAccessRequestStore(), accessRequests());

    process.env.SUPABASE_URL = "https://example.supabase.co";
    assert.throws(
      () => readAccessRequestSinkConfig(),
      (error: unknown) =>
        error instanceof AccessRequestStoreError && error.code === "ACCESS_REQUEST_UNCONFIGURED",
    );
    assert.throws(() => resolveAccessRequestStore(), AccessRequestStoreError);
  } finally {
    if (savedUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = savedKey;
    if (savedRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = savedRole;
  }
});
