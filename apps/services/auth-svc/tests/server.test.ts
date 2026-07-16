import { describe, expect, it } from 'bun:test';
import { app } from '../src/index';

const TUTOR_ID = 'test-tutor-id';

describe('auth-svc /api/v1/settings', () => {
  it('should require X-Tutor-Id for GET /', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/settings', { method: 'GET' })
    );
    expect(res.status).toBe(401);
  });

  it('should return null data for non-existent settings', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/settings', {
        method: 'GET',
        headers: { 'X-Tutor-Id': TUTOR_ID },
      })
    );
    const body = await res.text();
    console.log(body);
    expect(res.status).toBe(200);
    const json = JSON.parse(body);
    expect(json.success).toBe(true);
  });

  it('should require X-Tutor-Id for PATCH /', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/settings', { 
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ institute_name: 'Test' })
      })
    );
    expect(res.status).toBe(401);
  });
});
