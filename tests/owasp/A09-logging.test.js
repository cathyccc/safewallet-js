import request from 'supertest';
import { describe, vi } from 'vitest';
import { test, expect } from '../support/fixtures.js';

describe('A09:2025 Security Logging and Alerting Failures', () => {
  test("logs a warning when a token is used on someone else's account", async ({ app, alice, bob }) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await request(app)
      .post('/transfer')
      .set('Authorization', `Bearer ${bob.api_token}`)
      .send({ from_account_id: alice.id, to_account_id: bob.id, amount: 50 });

    expect(res.status).toBe(403);
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(bob.api_token);
    warn.mockRestore();
  });

  test('logs a warning when an IP hits the rate limit', async ({ app }) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    for (let i = 0; i < 100; i++) {
      await request(app).post('/transfer').send({});
    }
    expect(warn).not.toHaveBeenCalled();
    
    const blocked = await request(app).post('/transfer').send({});
    expect(blocked.status).toBe(429)
    expect(JSON.stringify(warn.mock.calls)).toContain('rate limit reached');
    warn.mockRestore();
  });
});