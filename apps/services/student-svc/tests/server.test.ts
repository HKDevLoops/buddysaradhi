import { describe, expect, it } from 'bun:test';
import { app } from '../src/index';

describe('student-svc /api/v1/students', () => {
  const tutorId = 'test-tutor-id';

  it('should require X-Tutor-Id auth header', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1/students', { method: 'GET' }));
    expect(response.status).toBe(401);
  });

  it('should return a list of students on GET /', async () => {
    const response = await app.handle(
      new Request('http://localhost/api/v1/students', {
        method: 'GET',
        headers: { 'X-Tutor-Id': tutorId }
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.total).toBeTypeOf('number');
    expect(Array.isArray(body.data.students)).toBe(true);
  });

  it('should create a student on POST /', async () => {
    const response = await app.handle(
      new Request('http://localhost/api/v1/students', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tutor-Id': tutorId
        },
        body: JSON.stringify({
          first_name: 'Test',
          last_name: 'Student',
          admission_date: '2023-01-01',
          grade: '10th',
          baseFeePaise: 500000
        })
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.firstName).toBe('Test');
    expect(body.data.code).toBeDefined();
  });
});
