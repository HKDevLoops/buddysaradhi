import { describe, expect, it } from 'bun:test';
import { app } from '../src/index';

const TUTOR_ID = 'test-tutor-id';

describe('ledger-svc /api/v1/ledger', () => {
  it('should require X-Tutor-Id for GET /', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/ledger', { method: 'GET' })
    );
    expect(res.status).toBe(401);
  });

  it('should return ledger entries list on GET / with auth', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/ledger', {
        method: 'GET',
        headers: { 'X-Tutor-Id': TUTOR_ID },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('should require X-Tutor-Id for GET /fees', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/ledger/fees', { method: 'GET' })
    );
    expect(res.status).toBe(401);
  });

  it('should return active students with balances on GET /fees', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/ledger/fees', {
        method: 'GET',
        headers: { 'X-Tutor-Id': TUTOR_ID },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('should require studentId for GET /invoices', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/ledger/invoices', {
        method: 'GET',
        headers: { 'X-Tutor-Id': TUTOR_ID },
      })
    );
    expect(res.status).toBe(400);
  });

  it('should return invoices array when studentId given', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/ledger/invoices?studentId=nonexistent-student', {
        method: 'GET',
        headers: { 'X-Tutor-Id': TUTOR_ID },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('should require X-Tutor-Id for GET /balance', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/ledger/balance?studentId=x', { method: 'GET' })
    );
    expect(res.status).toBe(401);
  });

  it('should require studentId for GET /balance', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/ledger/balance', {
        method: 'GET',
        headers: { 'X-Tutor-Id': TUTOR_ID },
      })
    );
    expect(res.status).toBe(400);
  });

  it('should return balance paise for a student on GET /balance', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/ledger/balance?studentId=nonexistent', {
        method: 'GET',
        headers: { 'X-Tutor-Id': TUTOR_ID },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('balancePaise');
    expect(typeof body.data.balancePaise).toBe('number');
  });
});
