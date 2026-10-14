// Implements: 10_Security.md §8 (no secret, credential, PIN, email or card number
// in a log line) + AGENTS.md §2 Rule 9 (the typed logger is the only console
// surface, and it must not be able to leak by accident).
//
// `apps/web/src/lib/logger.ts` has ONE sink: the `console.*` line, which goes
// to Vercel's log retention (server) or the dev console (browser). There used
// to be a second sink — a POST to `/api/v1/audit-log` — but no such route ever
// existed, so every fan-out was a guaranteed 404 and the transport was deleted
// rather than pointed at a table it was never designed for. These tests assert
// two things: the redaction choke point (`build()`, so no call site can opt
// out) and the absence of any network call (a `fetch` from this module is a
// regression — the stub below throws if one is attempted).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditAction, log } from './logger';

const TENANT_UUID = '018f0000-0000-7000-8000-000000000001';
const OPAQUE_UUID = '9c33d0a9-1d44-4f7c-9a52-6b1e8b2f5e7a';
const VISA_16 = '4111111111111111';
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig';
const E2E_SECRET = 'Sup3rSecret-E2E-Value-9000';

let consoleCalls: unknown[][] = [];

beforeEach(() => {
  consoleCalls = [];
  for (const level of ['info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      consoleCalls.push(args);
    });
  }
  // The logger performs no network calls. If one is ever attempted, fail
  // loudly here rather than letting a doomed POST leave the process.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('logger must not call fetch (no transport exists)');
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
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

describe("the web logger redacts its single sink (browser build)", () => {
  it("a bearer token in context never reaches the console line", () => {
    log.audit('sync_attempt', 'sync failed', { authorization: `Bearer ${JWT}` });

    const printed = printedText();
    expect(printed).not.toContain(JWT);
    expect(printed).not.toContain('eyJhbGciOi');
  });

  it("an E2E_PASSWORD value never reaches the console line", () => {
    // The value is deliberately credential-SHAPED: no `password:` prefix in front
    // of it, so a value-only redactor would let it through. Only the key gate
    // catches this - which is why the logger redacts on key name as well.
    log.audit('e2e_probe', 'probe', { E2E_PASSWORD: E2E_SECRET });
    auditAction('e2e_probe_two', { E2E_PASSWORD: E2E_SECRET, note: 'harmless' });

    const printed = printedText();
    expect(printed).not.toContain(E2E_SECRET);
    expect(printed).toContain('harmless');
  });

  it("an email in context - the live `instituteEmail` regression - is redacted", () => {
    log.error('settings_update_auth_email_failed', 'Auth rejected the change', {
      instituteEmail: 'kabir@example.com',
    });

    expect(printedText()).not.toContain('kabir@example.com');
  });

  it("a PIN, a PAN, an SSN and a mobile in context are all redacted", () => {
    log.audit('security_event', 'anomaly', {
      pin: '135790',
      card: VISA_16,
      ssn: '123-45-6789',
      parentPhone: '9876543210',
    });

    const printed = printedText();
    expect(printed).not.toContain('135790');
    expect(printed).not.toContain(VISA_16);
    expect(printed).not.toContain('123-45-6789');
    expect(printed).not.toContain('9876543210');
  });

  it("a bare UUID under a non-correlation key is dropped", () => {
    log.audit('provision_attempt', 'provisioning', { opaqueHandle: OPAQUE_UUID });

    expect(printedText()).not.toContain(OPAQUE_UUID);
  });

  it("a secret pasted into the MESSAGE string is redacted, not only the context", () => {
    log.error('login_failed', `auth rejected for kabir@example.com with token: ${JWT}`);

    const printed = printedText();
    expect(printed).not.toContain('kabir@example.com');
    expect(printed).not.toContain('eyJhbGciOi');
  });

  it("legitimate context survives intact", () => {
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

    expect(printedText()).toContain('/api/v1/settings');
  });

  it("no network call is attempted for any verb", () => {
    // The fetch stub throws on any call, so reaching this line proves no POST
    // was attempted. There is deliberately no audit route to aim at: none ever
    // existed, and the transport was deleted rather than pointed at a table it
    // was never designed for.
    log.audit('lock', 'locked', { sessionId: TENANT_UUID });
    log.warn('w', 'm');
    log.error('e', 'm');
    log.info('i', 'm');
  });

  it("a cyclic context does not turn a log call into the crash (Rule 9)", () => {
    const cyclic: Record<string, unknown> = { field: 'instituteEmail' };
    cyclic.self = cyclic;
    expect(() => log.audit('cycle', 'cyclic context', cyclic)).not.toThrow();
  });
});

describe("the web logger redacts the server-side sink too", () => {
  it("warn prints a redacted line and attempts no POST", async () => {
    // The server branch of `emit` is a different code path from the browser
    // one, so it is asserted separately rather than assumed to share the choke
    // point. The module reads `typeof window` at import time, so this needs a
    // FRESH module instance taken after `window` is stubbed away.
    vi.resetModules();
    vi.stubGlobal('window', undefined);
    const { log: serverLog } = await import('./logger');

    serverLog.warn('settings_update_failed', 'gateway rejected the write', {
      field: 'instituteEmail',
      E2E_PASSWORD: E2E_SECRET,
      studentId: OPAQUE_UUID,
      retries: 2,
    });

    const printed = printedText();
    expect(printed).not.toContain(E2E_SECRET);
    // The KEY still identifies what failed - that is the whole point of the
    // settings.ts fix: `field` carries the signal, the value never appears.
    expect(printed).toContain('instituteEmail');
  }, 20_000);
});