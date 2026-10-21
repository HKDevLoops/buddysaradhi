import { describe, expect, it } from 'bun:test';
import { app } from '../src/index';

const TUTOR_ID = 'test-tutor-id';

describe('attendance-svc /api/v1/attendance', () => {
  it('should require X-Tutor-Id for GET /', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/attendance?date=2023-01-01', { method: 'GET' })
    );
    expect(res.status).toBe(401);
  });

  it('should require date parameter for GET /', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/attendance', {
        method: 'GET',
        headers: { 'X-Tutor-Id': TUTOR_ID },
      })
    );
    expect(res.status).toBe(400);
  });

  it('should return session and records on GET / with date', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/attendance?date=2023-01-01', {
        method: 'GET',
        headers: { 'X-Tutor-Id': TUTOR_ID },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('session');
    expect(Array.isArray(body.data.records)).toBe(true);
  });

  it('should require X-Tutor-Id for GET /batches', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/attendance/batches', { method: 'GET' })
    );
    expect(res.status).toBe(401);
  });

  it('should return batches array on GET /batches', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/attendance/batches', {
        method: 'GET',
        headers: { 'X-Tutor-Id': TUTOR_ID },
      })
    );
    const body = await res.text();
    console.log(body);
    expect(res.status).toBe(200);
    const json = JSON.parse(body);
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
  });
});
