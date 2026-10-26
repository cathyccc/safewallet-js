import request from 'supertest';
import crypto from 'node:crypto';
import { describe, test, expect, vi } from 'vitest';
import { createApp } from '../../src/app.js';

describe('A10:2025 Mishandling of Exceptional Conditions', () => {
  test('a database failure returns a generic 500 that hides the real cause', async () => {
    const brokenDb = {
      from: () => { throw new Error('connection refused at db.internal:5432 (user=postgres)'); },
    };
    const app = createApp({ supabase: brokenDb });

    // Replace console.error with a silent recorder, so we can check it was called
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app)
      .post('/transfer')
      .set('Authorization', 'Bearer anything')
      .send({ from_account_id: crypto.randomUUID(), to_account_id: crypto.randomUUID(), amount: 5 });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal server error' });
    expect(res.text).not.toMatch(/db\.internal|5432|postgres/);
    expect(log).toHaveBeenCalled();

    log.mockRestore();
  });
});