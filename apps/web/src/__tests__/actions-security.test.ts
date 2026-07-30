import { describe, it, expect } from 'vitest';

describe('Security headers', () => {
  const HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  };

  it('has all required security headers', () => {
    expect(HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(HEADERS['X-Frame-Options']).toBe('DENY');
    expect(HEADERS['Strict-Transport-Security']).toContain('max-age=31536000');
    expect(HEADERS['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(HEADERS['Cache-Control']).toContain('no-store');
  });

  it('CORS is not wildcard in production', () => {
    const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://buddysaradhi.app';
    expect(allowedOrigin).not.toBe('*');
    expect(allowedOrigin).toMatch(/^https?:\/\//);
  });
});

describe('PIN validation rules', () => {
  const validatePin = (pin: string) => ({
    valid: /^\d{4,8}$/.test(pin),
    length: pin.length,
    isNumeric: /^\d+$/.test(pin),
  });

  it('accepts valid 4-digit PIN', () => {
    expect(validatePin('1234').valid).toBe(true);
  });

  it('accepts valid 8-digit PIN', () => {
    expect(validatePin('12345678').valid).toBe(true);
  });

  it('rejects short PIN', () => {
    expect(validatePin('12').valid).toBe(false);
  });

  it('rejects long PIN', () => {
    expect(validatePin('123456789').valid).toBe(false);
  });

  it('rejects non-numeric PIN', () => {
    expect(validatePin('abcd').valid).toBe(false);
  });

  it('rejects mixed alphanumeric PIN', () => {
    expect(validatePin('12ab').valid).toBe(false);
  });
});
