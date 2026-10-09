// Implements: 10_Security.md §8 (no secret, credential, PIN, email or card number
// in a log line or an `audit_log` row) + AGENTS.md §2 Rule 9 (the typed logger is
// the only console surface, and it must not be able to leak by accident).
//
// `apps/web/src/lib/logger.ts` has TWO sinks with different lifetimes: the
// `console.*` line goes to Vercel's log retention, and the `/api/v1/audit-log`
// POST is PERSISTED to `audit_log`. Before the redactor landed, `entry.context`
// went to both verbatim, so a call site could put a PIN or a bearer token into a
// persisted table by writing `{ pin: value }` and nothing would stop it. These
// tests assert the choke point — `build()` — so no call site can opt out.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditAction, log } from './logger';

const AUDIT_PATH = '/api/v1/audit-log';
const TENANT_UUID = '018f0000-0000-7000-8000-000000000001';
const OPAQUE_UUID = '9c33d0a9-1d44-4f7c-9a52-6b1e8b2f5e7a';
const VISA_16 = '4111111111111111';
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig';
const E2E_SECRET = 'Sup3rSecret-E2E-Value-9000';

let consoleCalls: unknown[][] = [];
let posts: Array<{ url: string; body: string }> = [];

beforeEach(() => {
  consoleCalls = [];
  posts = [];
  for (const level of ['info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      consoleCalls.push(args);
    });
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      posts.push({
        url: String(input),
        body: typeof init?.body === 'string' ? init.body : '',
      });
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  delete process.env.NEXT_PUBLIC_APP_URL;
});

/** Everything the process would have written to stdout/stderr. */
function printedText(): string {
  return consoleCalls
    .map((args) => {
      try {
        return JSON.stringify(args);
      } catch {
        return String(args);
      }
    })
    .join('\n');
}

/** Every body that would have been POSTed to the audit_log route. */
function postedBodies(): string[] {
  return posts.map((p) => p.body).filter((body) => body.length > 0);
}

describe("the web logger redacts every sink (browser build)", () => {
  it("a bearer token in context never reaches the console line or the audit POST", () => {
    log.audit('sync_attempt', 'sync failed', { authorization: `Bearer ${JWT}` });

    const printed = printedText();
    const posted = postedBodies().join('\n');
    expect(posted.length).toBeGreaterThan(0);
    for (const sink of [printed, posted]) {
      expect(sink).not.toContain(JWT);
      expect(sink).not.toContain('eyJhbGciOi');
    }
  });

  it("an E2E_PASSWORD value never reaches the audit POST", () => {
    // The value is deliberately credential-SHAPED: no `password:` prefix in front
    // of it, so a value-only redactor would let it through. Only the key gate
    // catches this — which is why the logger redacts on key name as well.
    log.audit('e2e_probe', 'probe', { E2E_PASSWORD: E2E_SECRET });
    auditAction('e2e_probe_two', { E2E_PASSWORD: E2E_SECRET, note: 'harmless' });

    const bodies = postedBodies();
    expect(bodies.length).toBeGreaterThan(1);
    for (const body of bodies) {
      expect(body).not.toContain(E2E_SECRET);
    }
    expect(bodies[1]).toContain('harmless');
    expect(printedText()).not.toContain(E2E_SECRET);
  });

  it("an email in context — the live `instituteEmail` regression — is redacted", () => {
    log.error('settings_update_auth_email_failed', 'Auth rejected the change', {
      instituteEmail: 'kabir@example.com',
    });

    for (const sink of [printedText(), postedBodies().join('\n')]) {
      expect(sink).not.toContain('kabir@example.com');
    }
  });

  it("a PIN, a PAN, an SSN and a mobile in context are all redacted", () => {
    log.audit('security_event', 'anomaly', {
      pin: '135790',
      card: VISA_16,
      ssn: '123-45-6789',
      parentPhone: '9876543210',
    });

    for (const sink of [printedText(), postedBodies().join('\n')]) {
      expect(sink).not.toContain('135790');
      expect(sink).not.toContain(VISA_16);
      expect(sink).not.toContain('123-45-6789');
      expect(sink).not.toContain('9876543210');
    }
  });

  it("a bare UUID under a non-correlation key is dropped from both sinks", () => {
    log.audit('provision_attempt', 'provisioning', { opaqueHandle: OPAQUE_UUID });

    for (const sink of [printedText(), postedBodies().join('\n')]) {
      expect(sink).not.toContain(OPAQUE_UUID);
    }
  });

  it("a secret pasted into the MESSAGE string is redacted, not only the context", () => {
    log.error('login_failed', `auth rejected for kabir@example.com with token: ${JWT}`);

    const printed = printedText();
    expect(printed).not.toContain('kabir@example.com');
    expect(printed).not.toContain('eyJhbGciOi');
  });

  it("legitimate context survives both sinks intact", () => {
    const context = {
      studentId: OPAQUE_UUID,
      tenantId: TENANT_UUID,
      amountMinor: 30000,
      cacheHit: true,
      status: 409,
      method: 'PATCH',
      path: '/api/v1/settings',
      field: 'instituteName',
    };
    log.audit('cas_conflict_settings', 'Settings CAS mismatch', context);

    const body = postedBodies()[0];
    expect(body).toBeDefined();
    const parsed = JSON.parse(body ?? '{}') as { context: Record<string, unknown> };
    expect(parsed.context).toEqual(context);
    expect(printedText()).toContain('/api/v1/settings');
  });

  it("the audit POST is still aimed at the audit route", () => {
    log.audit('lock', 'locked', { sessionId: TENANT_UUID });
    expect(posts.length).toBeGreaterThan(0);
    expect(posts[0]?.url).toBe(AUDIT_PATH);
  });

  it("a cyclic context does not turn a log call into the crash (Rule 9)", () => {
    const cyclic: Record<string, unknown> = { field: 'instituteEmail' };
    cyclic.self = cyclic;
    expect(() => log.audit('cycle', 'cyclic context', cyclic)).not.toThrow();
    expect(postedBodies().length).toBeGreaterThan(0);
  });
});

describe("the web logger redacts the server-side fan-out too", () => {
  it("warn POSTs a redacted body to the audit route", async () => {
    // The server branch of `emit` is a different code path from the browser one
    // (it resolves `NEXT_PUBLIC_APP_URL` and always hits `console.*`), so it is
    // asserted separately rather than assumed to share the choke point. The
    // module reads `typeof window` at import time, so this needs a FRESH module
    // instance taken after `window` is stubbed away.
    vi.resetModules();
    vi.stubGlobal('window', undefined);
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.buddysaradhi.app';
    const { log: serverLog } = await import('./logger');

    serverLog.warn('settings_update_failed', 'gateway rejected the write', {
      field: 'instituteEmail',
      E2E_PASSWORD: E2E_SECRET,
      studentId: OPAQUE_UUID,
      retries: 2,
    });

    const bodies = postedBodies();
    expect(bodies.length).toBeGreaterThan(0);
    expect(posts[0]?.url).toBe(`https://app.buddysaradhi.app${AUDIT_PATH}`);

    for (const sink of [printedText(), bodies.join('\n')]) {
      expect(sink).not.toContain(E2E_SECRET);
      // The KEY still identifies what failed — that is the whole point of the
      // settings.ts fix: `field` carries the signal, the value never appears.
      expect(sink).toContain('instituteEmail');
    }
    const parsed = JSON.parse(bodies[0] ?? '{}') as { context: Record<string, unknown> };
    expect(parsed.context.retries).toBe(2);
    expect(parsed.context.studentId).toBe(OPAQUE_UUID);
  }, 20_000);
});