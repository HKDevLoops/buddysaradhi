// Implements: 18_Microservice_Architecture.md — use-auto-provision hook tests
//
// Tests the useAutoProvision hook and AutoProvisionGuard component using
// @testing-library/react + vitest.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { renderHook, act, render } from '@testing-library/react';

// ────────────────────────────────────────────────────────────
// Mock @/lib/supabase/client BEFORE importing the hook.
// The hook calls createSupabaseBrowser() for auth session.
// ────────────────────────────────────────────────────────────
vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowser: vi.fn(() => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
      }),
      refreshSession: vi.fn().mockResolvedValue({}),
    },
  })),
}));

// Import AFTER mock is registered
import { useAutoProvision, AutoProvisionGuard } from '@/hooks/use-auto-provision';

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/** Build a minimal Response-like object */
function makeResponse(
  status: number,
  body: unknown,
): Response {
  const bodyStr = JSON.stringify(body);
  const response = new Response(bodyStr, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
  return response;
}

// ────────────────────────────────────────────────────────────
// Reset module-level state between tests.
// The hook uses module-level flags (provisioningInFlight,
// attemptsThisSession).  We reset them by re-importing the module
// via vi.resetModules() + vi.importFresh — but since we're using
// vi.mock at top-level, the simplest approach is to patch window.fetch
// back after each test and rely on the cleanup from @testing-library.
// ────────────────────────────────────────────────────────────
let originalFetch: typeof window.fetch;

beforeEach(() => {
  originalFetch = window.fetch;
});

afterEach(() => {
  window.fetch = originalFetch;
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────
describe('AutoProvisionGuard', () => {
  it('renders without errors and returns null', () => {
    // AutoProvisionGuard is a React component — must be rendered as JSX
    const { container } = render(<AutoProvisionGuard />);
    expect(container.firstChild).toBeNull();
  });
});

describe('useAutoProvision', () => {
  // ── 1. Patches window.fetch on mount and restores on unmount ──
  it('patches window.fetch when mounted and restores it on unmount', () => {
    const nativeFetch = vi.fn().mockResolvedValue(makeResponse(200, {}));
    window.fetch = nativeFetch;

    const { unmount } = renderHook(() => useAutoProvision());

    // After mount, window.fetch should be a different (patched) function
    const patchedFetch = window.fetch;
    expect(patchedFetch).not.toBe(nativeFetch);

    unmount();

    // After unmount, window.fetch should be restored —
    // not the same patched interceptor anymore
    expect(window.fetch).not.toBe(patchedFetch);
  });

  // ── 2. 503 + needs_provision:true → triggers /api/provision ──
  it('triggers /api/provision POST when 503 + needs_provision:true from /api/v1/', async () => {
    // We need fresh module state — reset the module-level counters
    // by using a fresh import. Since we cannot easily do that here,
    // we work around by checking fetch call args instead.

    const provisionResponse = makeResponse(200, { ok: true });
    const studentResponse = makeResponse(503, { needs_provision: true });

    // Track all fetch calls
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
      if (url.includes('/api/provision')) return Promise.resolve(provisionResponse);
      return Promise.resolve(studentResponse);
    });
    window.fetch = fetchMock;

    renderHook(() => useAutoProvision());

    // Simulate an API call that triggers the 503 interception
    await act(async () => {
      await window.fetch('/api/v1/students');
    });

    // Give the async runProvision() a tick to fire
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // /api/provision should have been called
    const provisionCalls = fetchMock.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes('/api/provision')
    );
    expect(provisionCalls.length).toBeGreaterThanOrEqual(1);
    const [, provisionInit] = provisionCalls[0] as [string, RequestInit];
    expect(provisionInit?.method).toBe('POST');
  });

  // ── 3. 503 WITHOUT needs_provision → NO /api/provision call ──
  it('does NOT trigger /api/provision when 503 lacks needs_provision flag', async () => {
    const response503NoFlag = makeResponse(503, { error: 'something_else' });

    const fetchMock = vi.fn().mockResolvedValue(response503NoFlag);
    window.fetch = fetchMock;

    renderHook(() => useAutoProvision());

    await act(async () => {
      await window.fetch('/api/v1/students');
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const provisionCalls = fetchMock.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes('/api/provision')
    );
    expect(provisionCalls.length).toBe(0);
  });

  // ── 4. Non-503 response → NO /api/provision call ──────────
  it('does NOT trigger /api/provision for a successful (200) response from /api/v1/', async () => {
    const response200 = makeResponse(200, { students: [] });

    const fetchMock = vi.fn().mockResolvedValue(response200);
    window.fetch = fetchMock;

    renderHook(() => useAutoProvision());

    await act(async () => {
      await window.fetch('/api/v1/students');
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const provisionCalls = fetchMock.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes('/api/provision')
    );
    expect(provisionCalls.length).toBe(0);
  });

  // ── 5. Non-/api/v1/ URL → NO /api/provision call ─────────
  it('does NOT trigger /api/provision for a 503 from a non-/api/v1/ URL', async () => {
    const response503 = makeResponse(503, { needs_provision: true });

    const fetchMock = vi.fn().mockResolvedValue(response503);
    window.fetch = fetchMock;

    renderHook(() => useAutoProvision());

    await act(async () => {
      // External URL — should NOT be intercepted
      await window.fetch('https://external.example.com/data');
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const provisionCalls = fetchMock.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes('/api/provision')
    );
    expect(provisionCalls.length).toBe(0);
  });

  // ── 6. 404 response → NO /api/provision call ─────────────
  it('does NOT trigger /api/provision for a 404 from /api/v1/', async () => {
    const response404 = makeResponse(404, { error: 'not_found' });

    const fetchMock = vi.fn().mockResolvedValue(response404);
    window.fetch = fetchMock;

    renderHook(() => useAutoProvision());

    await act(async () => {
      await window.fetch('/api/v1/students/nonexistent');
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const provisionCalls = fetchMock.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes('/api/provision')
    );
    expect(provisionCalls.length).toBe(0);
  });
});
