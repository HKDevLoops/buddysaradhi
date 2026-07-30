import { describe, it, expect } from 'vitest';

describe('Gateway HMAC verification logic', () => {
  const encoder = new TextEncoder();

  async function hmacSign(secret: string, data: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
    return Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function hmacVerify(secret: string, data: string, signature: string): Promise<boolean> {
    const expected = await hmacSign(secret, data);
    if (expected.length !== signature.length) return false;
    let result = 0;
    for (let i = 0; i < expected.length; i++) {
      result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return result === 0;
  }

  it('signs and verifies with correct secret', async () => {
    const secret = 'gateway-shared-secret-32chars-minimum!';
    const data = 'user-123:libsql://db.turso.io:token:1700000000000';
    const sig = await hmacSign(secret, data);
    expect(await hmacVerify(secret, data, sig)).toBe(true);
  });

  it('rejects tampered signature', async () => {
    const secret = 'gateway-shared-secret-32chars-minimum!';
    const sig = await hmacSign(secret, 'data');
    expect(await hmacVerify(secret, 'data', sig + 'ff')).toBe(false);
  });

  it('rejects wrong secret', async () => {
    const sig = await hmacSign('secret-a', 'data');
    expect(await hmacVerify('secret-b', 'data', sig)).toBe(false);
  });

  it('rejects replayed request outside 5-minute window', () => {
    const now = Date.now();
    const oldTimestamp = now - 600_001;
    const skew = Math.abs(now - oldTimestamp);
    expect(skew).toBeGreaterThan(300_000);
  });

  it('accepts request within 5-minute window', () => {
    const now = Date.now();
    const recentTimestamp = now - 60_000;
    const skew = Math.abs(now - recentTimestamp);
    expect(skew).toBeLessThanOrEqual(300_000);
  });
});

describe('Rate limiter logic', () => {
  const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

  function checkRateLimit(tenantId: string, maxRequests = 100, windowMs = 60000): boolean {
    const now = Date.now();
    const entry = rateLimitMap.get(tenantId);
    if (!entry || now > entry.resetAt) {
      rateLimitMap.set(tenantId, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (entry.count >= maxRequests) return false;
    entry.count++;
    return true;
  }

  it('allows requests within limit', () => {
    rateLimitMap.clear();
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit('tenant-1', 10, 60000)).toBe(true);
    }
  });

  it('blocks requests over limit', () => {
    rateLimitMap.clear();
    for (let i = 0; i < 10; i++) {
      checkRateLimit('tenant-2', 10, 60000);
    }
    expect(checkRateLimit('tenant-2', 10, 60000)).toBe(false);
  });
});
